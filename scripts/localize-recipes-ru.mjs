import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(url, key, { auth: { persistSession: false } });
const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const REQUEST_DELAY_MS = 1400;
const RATE_LIMIT_DELAYS_MS = [60_000, 120_000, 240_000, 360_000, 600_000];
const TRANSIENT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const INGREDIENT_BATCH_SIZE = 12;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cache = new Map();

class TranslateHttpError extends Error {
  constructor(status, retryAfterMs = null) {
    super(`Translate HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function translate(text) {
  const value = (text ?? "").trim();
  if (!value) return null;
  if (cache.has(value)) return cache.get(value);

  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let response;
      try {
        response = await fetch(TRANSLATE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ client: "gtx", sl: "en", tl: "ru", dt: "t", q: value }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) throw new TranslateHttpError(response.status, retryAfterMs(response));
      const data = await response.json();
      const translated = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] ?? "").join("").trim() : "";
      if (!translated) throw new Error("Пустой перевод");

      cache.set(value, translated);
      await delay(REQUEST_DELAY_MS);
      return translated;
    } catch (error) {
      lastError = error;
      if (attempt >= 5) break;

      const status = error instanceof TranslateHttpError ? error.status : null;
      const isRateLimit = status === 429 || status === 403;
      const isTransient = isRateLimit || status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504 || error?.name === "AbortError";
      if (!isTransient) break;

      const schedule = isRateLimit ? RATE_LIMIT_DELAYS_MS : TRANSIENT_DELAYS_MS;
      const waitMs = Math.max(error instanceof TranslateHttpError && error.retryAfterMs ? error.retryAfterMs : 0, schedule[Math.min(attempt, schedule.length - 1)]);
      console.warn(`Перевод временно ограничен${status ? ` (HTTP ${status})` : ""}. Ждём ${Math.ceil(waitMs / 1000)} сек. и продолжаем...`);
      await delay(waitMs);
    }
  }
  throw lastError;
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

let recipeUpdated = 0;
let ingredientUpdated = 0;
let failed = 0;

console.log(`Локализация: ${recipes.length} рецептов, ${catalog.length} ингредиентов`);
console.log(`Уже переведено: рецептов ${recipes.filter((x) => x.name_ru).length}/${recipes.length}, ингредиентов ${catalog.filter((x) => x.display_name_ru).length}/${catalog.length}`);

// First sync already translated catalog rows to recipe_ingredients without calling translator.
for (const item of catalog.filter((x) => x.display_name_ru)) {
  const { error } = await db.from("recipe_ingredients").update({ name_ru: item.display_name_ru }).eq("ingredient_id", item.id);
  if (error) {
    failed++;
    console.error(`Синхронизация ${item.canonical_name}:`, error.message);
  }
}

// Translate missing ingredient display names in batches to dramatically reduce external requests.
const missingCatalog = catalog.filter((x) => !x.display_name_ru);
for (let start = 0; start < missingCatalog.length; start += INGREDIENT_BATCH_SIZE) {
  const batch = missingCatalog.slice(start, start + INGREDIENT_BATCH_SIZE);
  const token = `<<<WTC_SPLIT_${Date.now()}_${start}>>>`;
  const source = batch.map((item) => item.canonical_name).join(`\n${token}\n`);
  try {
    const translated = await translate(source);
    const parts = translated.split(token).map((x) => x.trim());
    if (parts.length !== batch.length || parts.some((x) => !x)) {
      // Fallback to individual translation only for this batch if the separator was altered.
      for (const item of batch) {
        try {
          const displayName = await translate(item.canonical_name);
          const { error: catalogError } = await db.from("ingredients_catalog").update({ display_name_ru: displayName }).eq("id", item.id);
          if (catalogError) throw catalogError;
          const { error: rowsError } = await db.from("recipe_ingredients").update({ name_ru: displayName }).eq("ingredient_id", item.id);
          if (rowsError) throw rowsError;
          ingredientUpdated++;
        } catch (error) {
          failed++;
          console.error(`Ингредиент ${item.canonical_name}:`, error instanceof Error ? error.message : error);
        }
      }
    } else {
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const displayName = parts[i];
        const { error: catalogError } = await db.from("ingredients_catalog").update({ display_name_ru: displayName }).eq("id", item.id);
        if (catalogError) throw catalogError;
        const { error: rowsError } = await db.from("recipe_ingredients").update({ name_ru: displayName }).eq("ingredient_id", item.id);
        if (rowsError) throw rowsError;
        ingredientUpdated++;
      }
    }
  } catch (error) {
    // Do not turn a single rate limit into hundreds of immediate failures.
    console.error(`Пакет ингредиентов ${start + 1}-${Math.min(start + batch.length, missingCatalog.length)}:`, error instanceof Error ? error.message : error);
    failed += batch.length;
  }
  console.log(`Ингредиенты ${Math.min(start + batch.length, missingCatalog.length)}/${missingCatalog.length} оставшихся: updated=${ingredientUpdated}, failed=${failed}`);
}

// Each recipe is translated with one external request instead of up to three.
for (let index = 0; index < recipes.length; index++) {
  const recipe = recipes[index];
  const needsName = !recipe.name_ru;
  const needsDescription = Boolean(recipe.description && !recipe.description_ru);
  const needsInstructions = Boolean(recipe.instructions && !recipe.instructions_ru);
  if (!needsName && !needsDescription && !needsInstructions) continue;

  try {
    const fields = [];
    if (needsName) fields.push(["name_ru", recipe.name]);
    if (needsDescription) fields.push(["description_ru", recipe.description]);
    if (needsInstructions) fields.push(["instructions_ru", recipe.instructions]);

    const token = `<<<WTC_FIELD_${recipe.id.replaceAll("-", "_")}>>>`;
    const translated = await translate(fields.map(([, text]) => text).join(`\n${token}\n`));
    let parts = translated.split(token).map((x) => x.trim());

    if (parts.length !== fields.length || parts.some((x) => !x)) {
      parts = [];
      for (const [, text] of fields) parts.push(await translate(text));
    }

    const patch = Object.fromEntries(fields.map(([field], i) => [field, parts[i]]));
    const { error } = await db.from("recipes").update(patch).eq("id", recipe.id);
    if (error) throw error;
    recipeUpdated++;
  } catch (error) {
    failed++;
    console.error(`Рецепт ${recipe.name}:`, error instanceof Error ? error.message : error);
  }

  if ((index + 1) % 25 === 0) console.log(`Рецепты ${index + 1}/${recipes.length}: updated=${recipeUpdated}, failed=${failed}`);
}

console.log(`Готово: recipes_updated=${recipeUpdated}, ingredients_updated=${ingredientUpdated}, failed=${failed}`);
if (failed > 0) process.exitCode = 1;
