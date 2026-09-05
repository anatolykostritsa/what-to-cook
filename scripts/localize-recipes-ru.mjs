import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const translatorKey = process.env.AZURE_TRANSLATOR_KEY;
const translatorRegion = process.env.AZURE_TRANSLATOR_REGION;
const translatorEndpoint = (process.env.AZURE_TRANSLATOR_ENDPOINT || "https://api.cognitive.microsofttranslator.com").replace(/\/$/, "");

if (!url || !serviceRoleKey) {
  throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
}
if (!translatorKey || !translatorRegion) {
  throw new Error("Нужны AZURE_TRANSLATOR_KEY и AZURE_TRANSLATOR_REGION. Для массовой локализации используем официальный Azure Translator, а не rate-limited Google endpoint.");
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BATCH_ITEMS = 40;
const MAX_BATCH_CHARS = 35_000;
const UPDATE_CONCURRENCY = 8;

class TranslatorHttpError extends Error {
  constructor(status, retryAfterMs = null, body = "") {
    super(`Azure Translator HTTP ${status}${body ? `: ${body.slice(0, 240)}` : ""}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function getRetryAfterMs(response) {
  const msHeader = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(msHeader) && msHeader > 0) return msHeader * 1000;

  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function translateMany(texts) {
  if (!texts.length) return [];

  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${translatorEndpoint}/translate?api-version=3.0&from=en&to=ru`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Ocp-Apim-Subscription-Key": translatorKey,
          "Ocp-Apim-Subscription-Region": translatorRegion,
        },
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new TranslatorHttpError(response.status, getRetryAfterMs(response), body);
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error(`Azure Translator вернул ${Array.isArray(data) ? data.length : "не массив"} результатов вместо ${texts.length}`);
      }

      return data.map((row, index) => {
        const translated = row?.translations?.[0]?.text?.trim();
        if (!translated) throw new Error(`Пустой перевод элемента ${index + 1}`);
        return translated;
      });
    } catch (error) {
      lastError = error;
      const status = error instanceof TranslatorHttpError ? error.status : null;
      const transient = status === 429 || status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504 || error?.name === "AbortError";
      if (!transient || attempt === 5) break;

      const fallback = [5_000, 15_000, 30_000, 60_000, 120_000][Math.min(attempt, 4)];
      const waitMs = Math.max(error instanceof TranslatorHttpError && error.retryAfterMs ? error.retryAfterMs : 0, fallback);
      console.warn(`Azure Translator временно недоступен${status ? ` (HTTP ${status})` : ""}. Ждём ${Math.ceil(waitMs / 1000)} сек...`);
      await delay(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function makeBatches(entries) {
  const batches = [];
  let current = [];
  let chars = 0;

  for (const entry of entries) {
    const size = entry.text.length;
    if (current.length && (current.length >= MAX_BATCH_ITEMS || chars + size > MAX_BATCH_CHARS)) {
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

let ingredientUpdated = 0;
let recipeUpdated = 0;
let failed = 0;

// 1) Translate only missing canonical ingredient display names.
const ingredientEntries = catalog
  .filter((item) => !item.display_name_ru)
  .map((item) => ({ kind: "ingredient", id: item.id, text: item.canonical_name }));

const ingredientTranslations = new Map();
const ingredientBatches = makeBatches(ingredientEntries);
for (let i = 0; i < ingredientBatches.length; i++) {
  const batch = ingredientBatches[i];
  try {
    const translated = await translateMany(batch.map((x) => x.text));
    batch.forEach((entry, index) => ingredientTranslations.set(entry.id, translated[index]));
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

// Sync all available Russian catalog names to recipe ingredient rows.
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

// 2) Translate all missing recipe fields in efficient Azure batches.
const recipeEntries = [];
for (const recipe of recipes) {
  if (!recipe.name_ru) recipeEntries.push({ kind: "recipe", recipeId: recipe.id, recipeName: recipe.name, field: "name_ru", text: recipe.name });
  if (recipe.description && !recipe.description_ru) recipeEntries.push({ kind: "recipe", recipeId: recipe.id, recipeName: recipe.name, field: "description_ru", text: recipe.description });
  if (recipe.instructions && !recipe.instructions_ru) recipeEntries.push({ kind: "recipe", recipeId: recipe.id, recipeName: recipe.name, field: "instructions_ru", text: recipe.instructions });
}

const recipePatches = new Map();
const recipeBatches = makeBatches(recipeEntries);
for (let i = 0; i < recipeBatches.length; i++) {
  const batch = recipeBatches[i];
  try {
    const translated = await translateMany(batch.map((x) => x.text));
    batch.forEach((entry, index) => {
      const patch = recipePatches.get(entry.recipeId) ?? {};
      patch[entry.field] = translated[index];
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

console.log(`Готово: recipes_updated=${recipeUpdated}, ingredients_updated=${ingredientUpdated}, failed=${failed}`);
if (failed > 0) process.exitCode = 1;
