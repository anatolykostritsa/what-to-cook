import { createClient } from "@supabase/supabase-js";
import {
  ingredientSignature,
  inferCategory,
  inferCuisine,
  normalizeRussianText,
  parseRussianIngredientLine,
  recipeExternalId,
  scoreRecipe,
  stableUuid,
} from "./rurecipes-utils.mjs";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.split("=");
  return [key, value ?? true];
}));
const dryRun = args.has("--dry-run");
const replace = args.has("--replace");
const target = Number(args.get("--target") || 3000);
const candidatePages = Number(args.get("--candidate-pages") || 140);
const pageLength = 100;
const dataset = "epishchik/RuRecipes-93k";
const rowsApi = "https://datasets-server.huggingface.co/rows";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
const db = dryRun ? null : createClient(url, key, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(endpoint) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(700 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function rowsUrl(offset, length) {
  const params = new URLSearchParams({ dataset, config: "default", split: "train", offset: String(offset), length: String(length) });
  return `${rowsApi}?${params}`;
}

async function fetchCandidateRows() {
  const first = await fetchJson(rowsUrl(0, 1));
  const total = Number(first.num_rows_total || first.num_rows || 92144);
  const pages = Math.max(1, Math.min(candidatePages, Math.ceil(total / pageLength)));
  const maxOffset = Math.max(0, total - pageLength);
  const offsets = Array.from({ length: pages }, (_, i) => pages === 1 ? 0 : Math.floor((i * maxOffset) / (pages - 1)));
  const result = [];
  let cursor = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= offsets.length) return;
      const data = await fetchJson(rowsUrl(offsets[index], pageLength));
      for (const entry of data.rows ?? []) if (entry?.row) result.push(entry.row);
      if ((index + 1) % 10 === 0 || index + 1 === offsets.length) console.log(`Загрузка датасета: ${index + 1}/${offsets.length} страниц, кандидатов ${result.length}`);
    }
  });
  await Promise.all(workers);
  return [...new Map(result.map((row) => [row.link, row])).values()];
}

function selectRecipes(rows) {
  const bestByTitle = new Map();
  for (const row of rows) {
    const score = scoreRecipe(row);
    if (!Number.isFinite(score)) continue;
    const titleKey = normalizeRussianText(row.title);
    const previous = bestByTitle.get(titleKey);
    if (!previous || score > previous.score) bestByTitle.set(titleKey, { row, score, category: inferCategory(row.title, row.description) });
  }

  const groups = new Map();
  for (const item of bestByTitle.values()) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  for (const items of groups.values()) items.sort((a, b) => b.score - a.score || String(a.row.title).localeCompare(String(b.row.title), "ru"));

  const selected = [];
  const seen = new Set();
  const categories = [...groups.keys()].sort((a, b) => a === "Другие" ? 1 : b === "Другие" ? -1 : a.localeCompare(b, "ru"));
  let progress = true;
  while (selected.length < target && progress) {
    progress = false;
    for (const category of categories) {
      const list = groups.get(category);
      if (!list?.length || selected.length >= target) continue;
      const item = list.shift();
      const fingerprint = `${normalizeRussianText(item.row.title)}::${item.row.ingredients.map((x) => normalizeRussianText(parseRussianIngredientLine(x)?.name)).filter(Boolean).sort().slice(0, 8).join("|")}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      selected.push(item);
      progress = true;
    }
  }
  if (selected.length < target) {
    const leftovers = [...groups.values()].flat().sort((a, b) => b.score - a.score);
    for (const item of leftovers) {
      if (selected.length >= target) break;
      const fingerprint = `${normalizeRussianText(item.row.title)}::${item.row.ingredients.map((x) => normalizeRussianText(parseRussianIngredientLine(x)?.name)).filter(Boolean).sort().slice(0, 8).join("|")}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      selected.push(item);
    }
  }
  return selected.map((x) => x.row);
}

async function loadIngredientMaps() {
  const exact = new Map();
  const signatures = new Map();
  const { data: catalog, error } = await db.from("ingredients_catalog").select("id,canonical_name,display_name_ru,normalized_name");
  if (error) throw error;
  for (const item of catalog ?? []) {
    for (const name of [item.canonical_name, item.display_name_ru, item.normalized_name]) {
      const key = normalizeRussianText(name);
      if (key) exact.set(key, item.id);
      const sig = ingredientSignature(name);
      if (sig) {
        if (!signatures.has(sig)) signatures.set(sig, item.id);
        else if (signatures.get(sig) !== item.id) signatures.set(sig, null);
      }
    }
  }
  const { data: aliases, error: aliasError } = await db.from("ingredient_aliases").select("ingredient_id,normalized_alias").eq("locale", "ru");
  if (!aliasError) for (const alias of aliases ?? []) if (alias.normalized_alias) exact.set(normalizeRussianText(alias.normalized_alias), alias.ingredient_id);
  return { exact, signatures };
}

async function ensureIngredient(name, maps) {
  const normalized = normalizeRussianText(name);
  const direct = maps.exact.get(normalized);
  if (direct) return direct;
  const sig = ingredientSignature(name);
  const bySignature = maps.signatures.get(sig);
  if (bySignature) return bySignature;

  const { data: resolved, error: resolveError } = await db.rpc("resolve_ingredient_name", { p_query: name });
  if (!resolveError && resolved) {
    maps.exact.set(normalized, resolved);
    return resolved;
  }

  const { data, error } = await db.from("ingredients_catalog").upsert({
    canonical_name: name,
    display_name_ru: name,
    normalized_name: normalized,
    aliases: [normalized],
    popularity: 1,
  }, { onConflict: "normalized_name" }).select("id").single();
  if (error) throw error;
  maps.exact.set(normalized, data.id);
  if (sig && !maps.signatures.has(sig)) maps.signatures.set(sig, data.id);
  return data.id;
}

async function buildPayload(row, maps) {
  const ingredients = [];
  for (let index = 0; index < row.ingredients.length; index++) {
    const parsed = parseRussianIngredientLine(row.ingredients[index]);
    if (!parsed) continue;
    const ingredientId = await ensureIngredient(parsed.name, maps);
    ingredients.push({
      ingredient_id: ingredientId,
      name: parsed.name,
      display_name: parsed.display_name,
      quantity: parsed.quantity,
      unit: parsed.unit,
      optional: parsed.optional,
      sort_order: index,
    });
  }
  const externalId = recipeExternalId(row.link);
  const category = inferCategory(row.title, row.description);
  const cuisine = inferCuisine(row.title, row.description);
  const groupId = stableUuid(`${normalizeRussianText(row.title)}::${ingredients.slice(0, 8).map((x) => normalizeRussianText(x.name)).sort().join("|")}`);
  return {
    recipe: {
      recipe_type: "system",
      household_id: null,
      created_by: null,
      name: String(row.title).trim(),
      normalized_name: normalizeRussianText(row.title),
      description: row.description ? String(row.description).trim() : null,
      instructions: Array.isArray(row.recipe) ? row.recipe.map((x) => String(x).trim()).filter(Boolean).join("\n\n") : null,
      prep_time_minutes: null,
      servings: null,
      difficulty: null,
      cuisine,
      category,
      image_url: row.image_link || null,
      source_name: "RussianFood",
      source_url: row.link,
      external_id: externalId,
      canonical_group_id: groupId,
      is_primary_variant: true,
    },
    ingredients,
  };
}

async function importSelected(rows) {
  const maps = await loadIngredientMaps();
  let imported = 0;
  let updated = 0;
  let failed = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    try {
      const externalId = recipeExternalId(row.link);
      const { data: existing } = await db.from("recipes").select("id").eq("source_name", "RussianFood").eq("external_id", externalId).maybeSingle();
      const payload = await buildPayload(row, maps);
      const { error } = await db.rpc("import_system_recipe", { p_recipe: payload.recipe, p_ingredients: payload.ingredients });
      if (error) throw error;
      if (existing) updated++; else imported++;
    } catch (error) {
      failed++;
      console.error(`Ошибка ${row?.title ?? "?"}:`, error instanceof Error ? error.message : error);
    }
    if ((index + 1) % 50 === 0 || index + 1 === rows.length) console.log(`Импорт ${index + 1}/${rows.length}: imported=${imported}, updated=${updated}, failed=${failed}`);
  }
  return { imported, updated, failed };
}

async function validateAndReplace(expectedMinimum) {
  const { count, error } = await db.from("recipes").select("id", { count: "exact", head: true }).eq("source_name", "RussianFood");
  if (error) throw error;
  if ((count ?? 0) < expectedMinimum) throw new Error(`RussianFood содержит только ${count} рецептов, ожидалось минимум ${expectedMinimum}. TheMealDB не удалён.`);
  const { count: emptyIngredients, error: emptyError } = await db.from("recipes").select("id,recipe_ingredients!left(id)", { count: "exact", head: true }).eq("source_name", "RussianFood").is("recipe_ingredients.id", null);
  if (emptyError) console.warn("Не удалось проверить пустые ингредиенты через API, продолжаем по порогу количества.");
  if (emptyIngredients > 0) throw new Error(`Найдено ${emptyIngredients} RussianFood-рецептов без ингредиентов. TheMealDB не удалён.`);
  const { error: deleteError } = await db.from("recipes").delete().eq("source_name", "TheMealDB");
  if (deleteError) throw deleteError;
  console.log(`TheMealDB удалён после проверки. RussianFood в базе: ${count}.`);
}

try {
  console.log(`RussianFood importer: target=${target}, candidatePages=${candidatePages}, dryRun=${dryRun}, replace=${replace}`);
  const candidates = await fetchCandidateRows();
  console.log(`Уникальных кандидатов: ${candidates.length}`);
  const selected = selectRecipes(candidates);
  const byCategory = Object.groupBy(selected, (row) => inferCategory(row.title, row.description));
  console.log(`Отобрано: ${selected.length}`);
  console.log("Категории:", Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.length])));
  console.log("Примеры:", selected.slice(0, 12).map((x) => x.title));
  if (dryRun) process.exit(0);
  if (selected.length < Math.min(target, 2000)) throw new Error(`Недостаточно качественных рецептов: ${selected.length}`);
  const result = await importSelected(selected);
  console.log(`Итог импорта: selected=${selected.length}, imported=${result.imported}, updated=${result.updated}, failed=${result.failed}`);
  if (result.failed > Math.max(10, Math.floor(selected.length * 0.01))) throw new Error("Слишком много ошибок импорта; TheMealDB оставлен без изменений.");
  if (replace) await validateAndReplace(Math.min(2500, selected.length - result.failed));
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error("Фатальная ошибка:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
