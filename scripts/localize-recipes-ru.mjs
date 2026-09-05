import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(url, key, { auth: { persistSession: false } });
const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cache = new Map();

function normalize(value) {
  return (value ?? "").toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

async function translate(text) {
  const value = (text ?? "").trim();
  if (!value) return null;
  if (cache.has(value)) return cache.get(value);
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(TRANSLATE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ client: "gtx", sl: "en", tl: "ru", dt: "t", q: value }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Translate HTTP ${response.status}`);
      const data = await response.json();
      const translated = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] ?? "").join("").trim() : "";
      if (!translated) throw new Error("Пустой перевод");
      cache.set(value, translated);
      await delay(120);
      return translated;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(700 * 2 ** (attempt - 1));
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

for (let index = 0; index < catalog.length; index++) {
  const item = catalog[index];
  if (item.display_name_ru) continue;
  try {
    const displayName = await translate(item.canonical_name);
    const { error } = await db.from("ingredients_catalog").update({ display_name_ru: displayName }).eq("id", item.id);
    if (error) throw error;
    ingredientUpdated++;
  } catch (error) {
    failed++;
    console.error(`Ингредиент ${item.canonical_name}:`, error instanceof Error ? error.message : error);
  }
  if ((index + 1) % 50 === 0) console.log(`Ингредиенты ${index + 1}/${catalog.length}: updated=${ingredientUpdated}, failed=${failed}`);
}

for (let index = 0; index < recipes.length; index++) {
  const recipe = recipes[index];
  if (recipe.name_ru && (!recipe.instructions || recipe.instructions_ru)) continue;
  try {
    const patch = {};
    if (!recipe.name_ru) patch.name_ru = await translate(recipe.name);
    if (recipe.description && !recipe.description_ru) patch.description_ru = await translate(recipe.description);
    if (recipe.instructions && !recipe.instructions_ru) patch.instructions_ru = await translate(recipe.instructions);
    if (Object.keys(patch).length) {
      const { error } = await db.from("recipes").update(patch).eq("id", recipe.id);
      if (error) throw error;
      recipeUpdated++;
    }
  } catch (error) {
    failed++;
    console.error(`Рецепт ${recipe.name}:`, error instanceof Error ? error.message : error);
  }
  if ((index + 1) % 25 === 0) console.log(`Рецепты ${index + 1}/${recipes.length}: updated=${recipeUpdated}, failed=${failed}`);
}

console.log(`Готово: recipes_updated=${recipeUpdated}, ingredients_updated=${ingredientUpdated}, failed=${failed}`);
if (failed > 0) process.exitCode = 1;
