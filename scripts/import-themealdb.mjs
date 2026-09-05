import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { normalizeImportedIngredient, parseMeasure } from "./themealdb-measures.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(url, key, { auth: { persistSession: false } });
const API = "https://www.themealdb.com/api/json/v1/1";
const sample = process.argv.includes("--sample");
const SAMPLE_IDS = ["52771", "52772", "52774"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeRecipeName = (value) => normalizeImportedIngredient(value).replace(/\b(classic|traditional|easy|best|recipe)\b/g, " ").replace(/\s+/g, " ").trim();
const uuidFrom = (value) => {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function fetchJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API}/${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = 500 * 2 ** (attempt - 1);
        console.warn(`Повтор ${attempt}/${MAX_ATTEMPTS} для ${path} через ${delay} мс`);
        await sleep(delay);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Не удалось загрузить ${path}`);
}

async function fetchMeals() {
  if (sample) {
    const responses = await Promise.all(SAMPLE_IDS.map((id) => fetchJson(`lookup.php?i=${id}`)));
    return responses.flatMap((response) => response.meals ?? []);
  }

  const all = [];
  for (let index = 0; index < LETTERS.length; index++) {
    const letter = LETTERS[index];
    const data = await fetchJson(`search.php?f=${letter}`);
    all.push(...(data.meals ?? []));
    console.log(`Получено ${index + 1}/${LETTERS.length} букв, сырых рецептов: ${all.length}`);
  }
  return [...new Map(all.map((meal) => [meal.idMeal, meal])).values()];
}

async function ensureCanonicalIngredient(name) {
  const normalizedName = normalizeImportedIngredient(name);
  const { data, error } = await db
    .from("ingredients_catalog")
    .upsert(
      {
        canonical_name: name,
        normalized_name: normalizedName,
        aliases: [normalizedName],
        popularity: 1,
      },
      { onConflict: "normalized_name" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, normalizedName };
}

async function buildPayload(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(meal[`strIngredient${i}`] ?? "").trim();
    if (!name) continue;
    const catalog = await ensureCanonicalIngredient(name);
    const measure = parseMeasure(meal[`strMeasure${i}`]);
    ingredients.push({
      ingredient_id: catalog.id,
      name,
      display_name: name,
      quantity: measure.quantity,
      unit: measure.unit,
      optional: measure.qualitative && measure.unit === "optional",
      sort_order: i - 1,
    });
  }

  const main = ingredients.slice(0, 8).map((item) => normalizeImportedIngredient(item.name)).sort().join("|");
  const groupKey = [
    normalizeRecipeName(meal.strMeal),
    normalizeImportedIngredient(meal.strArea ?? ""),
    normalizeImportedIngredient(meal.strCategory ?? ""),
    main,
  ].join("::");
  const groupId = uuidFrom(groupKey);
  const { data: primary, error: primaryError } = await db
    .from("recipes")
    .select("id")
    .eq("canonical_group_id", groupId)
    .eq("is_primary_variant", true)
    .neq("external_id", meal.idMeal)
    .limit(1)
    .maybeSingle();
  if (primaryError) throw primaryError;

  return {
    recipe: {
      recipe_type: "system",
      household_id: null,
      created_by: null,
      name: meal.strMeal,
      normalized_name: normalizeRecipeName(meal.strMeal),
      description: null,
      instructions: meal.strInstructions || null,
      prep_time_minutes: null,
      servings: null,
      difficulty: null,
      cuisine: meal.strArea || null,
      category: meal.strCategory || null,
      image_url: meal.strMealThumb || null,
      source_name: "TheMealDB",
      source_url: `https://www.themealdb.com/meal/${meal.idMeal}`,
      external_id: meal.idMeal,
      canonical_group_id: groupId,
      is_primary_variant: !primary,
    },
    ingredients,
  };
}

async function importMeal(meal) {
  const payload = await buildPayload(meal);
  const { data: existing, error: lookupError } = await db
    .from("recipes")
    .select("id")
    .eq("source_name", "TheMealDB")
    .eq("external_id", meal.idMeal)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const { error } = await db.rpc("import_system_recipe", {
    p_recipe: payload.recipe,
    p_ingredients: payload.ingredients,
  });
  if (error) throw error;
  return existing ? "updated" : "imported";
}

let fetched = 0;
let imported = 0;
let updated = 0;
let failed = 0;

try {
  const meals = await fetchMeals();
  fetched = meals.length;
  console.log(`Уникальных рецептов для обработки: ${fetched}`);

  for (let index = 0; index < meals.length; index++) {
    const meal = meals[index];
    try {
      const result = await importMeal(meal);
      if (result === "updated") updated++;
      else imported++;
    } catch (error) {
      failed++;
      console.error(`Ошибка импорта ${meal?.idMeal ?? "?"} ${meal?.strMeal ?? ""}:`, error instanceof Error ? error.message : error);
    }

    if ((index + 1) % 25 === 0 || index + 1 === meals.length) {
      console.log(`Прогресс ${index + 1}/${meals.length}: imported=${imported}, updated=${updated}, failed=${failed}`);
    }
  }

  console.log(`Итог: fetched=${fetched}, imported=${imported}, updated=${updated}, failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error("Фатальная ошибка импорта:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
