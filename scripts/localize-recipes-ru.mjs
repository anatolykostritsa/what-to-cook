import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const UPDATE_CONCURRENCY = 8;
const TRANSLATE_BATCH_ITEMS = 24;
const TRANSLATE_BATCH_CHARS = 30_000;

function createArgosClient() {
  const python = process.env.PYTHON_BINARY || "python";
  const helper = path.join(process.cwd(), "scripts", "argos_translate.py");
  const child = spawn(python, [helper], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });

  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let closedError = null;

  lines.on("line", (line) => {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(payload.id);
    if (!request) return;
    pending.delete(payload.id);
    if (payload.error) request.reject(new Error(payload.error));
    else request.resolve(payload.translations ?? []);
  });

  child.on("error", (error) => {
    closedError = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  child.on("exit", (code) => {
    if (code !== 0 && !closedError) closedError = new Error(`Python/Argos завершился с кодом ${code}`);
    if (closedError) {
      for (const request of pending.values()) request.reject(closedError);
      pending.clear();
    }
  });

  async function translateMany(texts) {
    if (!texts.length) return [];
    if (closedError) throw closedError;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, texts })}\n`, "utf8", (error) => {
        if (!error) return;
        pending.delete(id);
        reject(error);
      });
    });
  }

  function close() {
    if (!child.stdin.destroyed) child.stdin.end();
  }

  return { translateMany, close };
}

function makeBatches(entries) {
  const batches = [];
  let current = [];
  let chars = 0;

  for (const entry of entries) {
    const size = entry.text.length;
    if (current.length && (current.length >= TRANSLATE_BATCH_ITEMS || chars + size > TRANSLATE_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(entry);
    chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function fetchAll(table, columns, filters = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 200) {
    let query = db.from(table).select(columns).range(from, from + 199);
    query = filters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 200) break;
  }
  return rows;
}

const recipes = await fetchAll(
  "recipes",
  "id,name,description,instructions,name_ru,description_ru,instructions_ru,recipe_type",
  (query) => query.eq("recipe_type", "system").order("id"),
);
const catalog = await fetchAll(
  "ingredients_catalog",
  "id,canonical_name,display_name_ru,normalized_name",
  (query) => query.order("id"),
);

console.log(`Локализация: ${recipes.length} рецептов, ${catalog.length} ингредиентов`);
console.log(`Уже переведено: рецептов ${recipes.filter((x) => x.name_ru).length}/${recipes.length}, ингредиентов ${catalog.filter((x) => x.display_name_ru).length}/${catalog.length}`);
console.log("Переводчик: локальный Argos Translate (офлайн, без лимитов API)");

let ingredientUpdated = 0;
let recipeUpdated = 0;
let failed = 0;
const argos = createArgosClient();

try {
  const ingredientEntries = catalog
    .filter((item) => !item.display_name_ru)
    .map((item) => ({ id: item.id, text: item.canonical_name }));

  const ingredientTranslations = new Map();
  const ingredientBatches = makeBatches(ingredientEntries);
  for (let i = 0; i < ingredientBatches.length; i++) {
    const batch = ingredientBatches[i];
    try {
      const translated = await argos.translateMany(batch.map((x) => x.text));
      if (translated.length !== batch.length) throw new Error(`Argos вернул ${translated.length} переводов вместо ${batch.length}`);
      batch.forEach((entry, index) => ingredientTranslations.set(entry.id, translated[index].trim()));
    } catch (error) {
      failed += batch.length;
      console.error(`Пакет ингредиентов ${i + 1}/${ingredientBatches.length}:`, error instanceof Error ? error.message : error);
    }
    console.log(`Перевод ингредиентов: пакет ${i + 1}/${ingredientBatches.length}`);
  }

  await mapLimit([...ingredientTranslations.entries()], UPDATE_CONCURRENCY, async ([id, displayName]) => {
    const { error } = await db.from("ingredients_catalog").update({ display_name_ru: displayName }).eq("id", id);
    if (error) {
      failed++;
      console.error(`Не удалось сохранить ингредиент ${id}: ${error.message}`);
      return;
    }
    ingredientUpdated++;
  });

  const refreshedCatalog = await fetchAll(
    "ingredients_catalog",
    "id,canonical_name,display_name_ru",
    (query) => query.not("display_name_ru", "is", null).order("id"),
  );
  await mapLimit(refreshedCatalog, UPDATE_CONCURRENCY, async (item) => {
    const { error } = await db.from("recipe_ingredients").update({ name_ru: item.display_name_ru }).eq("ingredient_id", item.id);
    if (error) {
      failed++;
      console.error(`Не удалось синхронизировать ${item.canonical_name}: ${error.message}`);
    }
  });

  const recipeEntries = [];
  for (const recipe of recipes) {
    if (!recipe.name_ru) recipeEntries.push({ recipeId: recipe.id, field: "name_ru", text: recipe.name });
    if (recipe.description && !recipe.description_ru) recipeEntries.push({ recipeId: recipe.id, field: "description_ru", text: recipe.description });
    if (recipe.instructions && !recipe.instructions_ru) recipeEntries.push({ recipeId: recipe.id, field: "instructions_ru", text: recipe.instructions });
  }

  const recipePatches = new Map();
  const recipeBatches = makeBatches(recipeEntries);
  for (let i = 0; i < recipeBatches.length; i++) {
    const batch = recipeBatches[i];
    try {
      const translated = await argos.translateMany(batch.map((x) => x.text));
      if (translated.length !== batch.length) throw new Error(`Argos вернул ${translated.length} переводов вместо ${batch.length}`);
      batch.forEach((entry, index) => {
        const patch = recipePatches.get(entry.recipeId) ?? {};
        patch[entry.field] = translated[index].trim();
        recipePatches.set(entry.recipeId, patch);
      });
    } catch (error) {
      failed += batch.length;
      console.error(`Пакет рецептов ${i + 1}/${recipeBatches.length}:`, error instanceof Error ? error.message : error);
    }
    if ((i + 1) % 5 === 0 || i + 1 === recipeBatches.length) {
      console.log(`Перевод рецептов: пакет ${i + 1}/${recipeBatches.length}`);
    }
  }

  await mapLimit([...recipePatches.entries()], UPDATE_CONCURRENCY, async ([recipeId, patch]) => {
    const { error } = await db.from("recipes").update(patch).eq("id", recipeId);
    if (error) {
      failed++;
      console.error(`Не удалось сохранить рецепт ${recipeId}: ${error.message}`);
      return;
    }
    recipeUpdated++;
  });
} finally {
  argos.close();
}

console.log(`Готово: recipes_updated=${recipeUpdated}, ingredients_updated=${ingredientUpdated}, failed=${failed}`);
if (failed > 0) process.exitCode = 1;
