"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = { name: string; expiry_date: string | null };
type Recipe = { id: string; name: string; description: string | null; prep_time_minutes: number | null; servings: number | null; difficulty: string | null; is_favorite: boolean | null };
type Ingredient = { id: string; recipe_id: string; name: string; quantity: number | null; unit: string | null; optional: boolean | null };
type DraftIngredient = { name: string; quantity: string; unit: string; optional: boolean };
type Props = { householdId: string; userId: string; products: Product[] };

const UNITS = ["шт.", "г", "кг", "мл", "л", "уп.", "пач."];
const DIFFICULTIES = ["Легко", "Средне", "Сложно"];

function normalize(value: string) { return value.toLowerCase().replaceAll("ё", "е").trim(); }
function matches(productName: string, ingredientName: string) {
  const p = normalize(productName); const i = normalize(ingredientName);
  if (p.includes(i) || i.includes(p)) return true;
  const aliases: Record<string, string[]> = { яйца: ["яйцо"], макароны: ["паста", "спагетти", "лапша"], курица: ["куриное филе", "куриная грудка", "куриные грудки"], помидоры: ["помидор", "томаты", "томат"], сыр: ["моцарелла", "чеддер", "пармезан"], лук: ["репчатый лук"] };
  return (aliases[i] ?? []).some((alias) => p.includes(alias) || alias.includes(p));
}

export default function RecipesPanel({ householdId, userId, products }: Props) {
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [prepTime, setPrepTime] = useState("");
  const [servings, setServings] = useState("2");
  const [difficulty, setDifficulty] = useState("Легко");
  const [favorite, setFavorite] = useState(false);
  const [draftIngredients, setDraftIngredients] = useState<DraftIngredient[]>([{ name: "", quantity: "", unit: "шт.", optional: false }]);

  async function loadRecipes() {
    setLoading(true); setError("");
    const [recipeResult, ingredientResult] = await Promise.all([
      supabase.from("recipes").select("id, name, description, prep_time_minutes, servings, difficulty, is_favorite").eq("household_id", householdId).order("is_favorite", { ascending: false }).order("name", { ascending: true }),
      supabase.from("recipe_ingredients").select("id, recipe_id, name, quantity, unit, optional").order("created_at", { ascending: true }),
    ]);
    if (recipeResult.error) { setError(recipeResult.error.message); setRecipes([]); } else setRecipes(recipeResult.data ?? []);
    if (ingredientResult.error) setError(ingredientResult.error.message); else setIngredients(ingredientResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadRecipes(); }, [householdId]);

  const scored = useMemo(() => recipes.map((recipe) => {
    const recipeIngredients = ingredients.filter((item) => item.recipe_id === recipe.id);
    const required = recipeIngredients.filter((item) => !item.optional);
    const matched = required.filter((ingredient) => products.some((product) => matches(product.name, ingredient.name)));
    const missing = required.filter((ingredient) => !products.some((product) => matches(product.name, ingredient.name)));
    const score = required.length === 0 ? 100 : Math.round((matched.length / required.length) * 100);
    return { recipe, ingredients: recipeIngredients, missing, score };
  }), [recipes, ingredients, products]);

  const visible = scored.filter(({ recipe, score }) => (!search.trim() || normalize(recipe.name).includes(normalize(search))) && (!onlyAvailable || score === 100)).sort((a, b) => b.score - a.score || Number(Boolean(b.recipe.is_favorite)) - Number(Boolean(a.recipe.is_favorite)));

  function resetCreator() {
    setName(""); setDescription(""); setInstructions(""); setPrepTime(""); setServings("2"); setDifficulty("Легко"); setFavorite(false); setDraftIngredients([{ name: "", quantity: "", unit: "шт.", optional: false }]); setError("");
  }

  async function createRecipe() {
    if (!name.trim()) { setError("Введите название рецепта."); return; }
    const valid = draftIngredients.filter((item) => item.name.trim());
    if (!valid.length) { setError("Добавьте хотя бы один ингредиент."); return; }
    setSaving(true); setError("");
    try {
      const { data: recipe, error: recipeError } = await supabase.from("recipes").insert({ household_id: householdId, name: name.trim(), description: description.trim() || null, instructions: instructions.trim() || null, prep_time_minutes: prepTime ? Number(prepTime) : null, servings: servings ? Number(servings) : 2, difficulty, is_favorite: favorite, created_by: userId }).select("id").single();
      if (recipeError) throw recipeError;
      const rows = valid.map((item) => ({ recipe_id: recipe.id, name: item.name.trim(), quantity: item.quantity ? Number(item.quantity) : null, unit: item.unit || null, optional: item.optional }));
      const { error: ingredientError } = await supabase.from("recipe_ingredients").insert(rows);
      if (ingredientError) { await supabase.from("recipes").delete().eq("id", recipe.id); throw ingredientError; }
      resetCreator(); setShowCreator(false); await loadRecipes();
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось создать рецепт."); }
    finally { setSaving(false); }
  }

  async function addMissingToShopping(recipeId: string) {
    const item = scored.find((entry) => entry.recipe.id === recipeId); if (!item?.missing.length) return;
    setAdding(recipeId); setError("");
    try {
      const { error: insertError } = await supabase.from("shopping_items").insert(item.missing.map((ingredient) => ({ household_id: householdId, name: ingredient.name, quantity: ingredient.quantity, unit: ingredient.unit, done: false, added_from_recipe: recipeId, created_by: userId })));
      if (insertError) throw insertError;
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось добавить продукты в покупки."); }
    finally { setAdding(null); }
  }

  function updateIngredient(index: number, patch: Partial<DraftIngredient>) { setDraftIngredients(current => current.map((item, i) => i === index ? { ...item, ...patch } : item)); }

  if (loading) return <section className="dashboard-card"><div className="empty-state">Загружаем рецепты...</div></section>;

  return <section className="dashboard-card recipes-card">
    <div className="card-heading"><div><span className="card-label">УМНЫЙ ПОДБОР</span><h2>Что приготовить?</h2></div><div className="recipe-heading-actions"><span className="count-badge">{recipes.length}</span><button className="primary-button compact-button" onClick={() => { setShowCreator(true); setError(""); }}>+ Рецепт</button></div></div>
    <div className="recipe-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти рецепт..."/><label className="recipe-filter"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Только из того, что есть</label></div>
    {error && <div className="form-error">{error}</div>}
    {!recipes.length && <div className="empty-state">Рецептов пока нет. Создайте первый рецепт — он сразу начнёт участвовать в подборе.</div>}
    <div className="recipe-grid">
      {visible.map(({ recipe, ingredients: recipeIngredients, missing, score }) => <article className="recipe-card" key={recipe.id}>
        <div className={`recipe-score ${score === 100 ? "perfect" : ""}`}>{score}%</div>
        <div className="recipe-title-row"><h3>{recipe.name}</h3>{recipe.is_favorite && <span title="Избранное">★</span>}</div>
        {recipe.description && <p className="recipe-description">{recipe.description}</p>}
        <div className="recipe-meta">{recipe.prep_time_minutes ? `⏱ ${recipe.prep_time_minutes} мин` : "⏱ Время не указано"}{recipe.servings ? ` · 👥 ${recipe.servings}` : ""}{recipe.difficulty ? ` · ${recipe.difficulty}` : ""}</div>
        <div className="recipe-ingredients">{recipeIngredients.map((ingredient) => { const available = products.some((product) => matches(product.name, ingredient.name)); return <span className={`ingredient ${available ? "available" : ingredient.optional ? "optional" : "missing"}`} key={ingredient.id}>{available ? "✓" : ingredient.optional ? "○" : "+"} {ingredient.name}{ingredient.optional ? " · необязательно" : ""}</span>; })}</div>
        {score === 100 ? <p className="recipe-perfect">🎉 Всё необходимое уже есть дома</p> : missing.length ? <><p className="recipe-missing">Не хватает: {missing.map((item) => item.name).join(", ")}</p><button className="secondary-button recipe-shopping-button" onClick={() => addMissingToShopping(recipe.id)} disabled={adding === recipe.id}>{adding === recipe.id ? "Добавляем..." : "Добавить недостающее в покупки"}</button></> : null}
      </article>)}
    </div>
    {recipes.length > 0 && visible.length === 0 && <div className="empty-state">По вашему фильтру ничего не найдено.</div>}

    {showCreator && <div className="modal-backdrop"><div className="edit-modal recipe-creator"><div className="modal-header"><div><span className="card-label">НОВЫЙ РЕЦЕПТ</span><h2>Создать рецепт</h2></div><button className="modal-close" onClick={() => { setShowCreator(false); resetCreator(); }}>×</button></div><div className="recipe-creator-fields"><input value={name} onChange={e => setName(e.target.value)} placeholder="Название, например: Омлет с сыром"/><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Короткое описание" rows={2}/><div className="product-form-row"><input type="number" min="1" value={prepTime} onChange={e => setPrepTime(e.target.value)} placeholder="Время, мин"/><input type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} placeholder="Порции"/></div><select value={difficulty} onChange={e => setDifficulty(e.target.value)}>{DIFFICULTIES.map(item => <option key={item}>{item}</option>)}</select><textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Как приготовить" rows={4}/><label className="favorite-toggle"><input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)}/> Добавить в избранное</label></div><div className="ingredient-builder"><div className="builder-heading"><strong>Ингредиенты</strong><button className="icon-add-button" onClick={() => setDraftIngredients(current => [...current, { name: "", quantity: "", unit: "шт.", optional: false }])}>+ Добавить</button></div>{draftIngredients.map((item, index) => <div className="ingredient-row" key={index}><input value={item.name} onChange={e => updateIngredient(index, { name: e.target.value })} placeholder="Ингредиент"/><input className="ingredient-quantity" type="number" min="0" step="any" value={item.quantity} onChange={e => updateIngredient(index, { quantity: e.target.value })} placeholder="Кол."/><select value={item.unit} onChange={e => updateIngredient(index, { unit: e.target.value })}>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select><label title="Необязательный"><input type="checkbox" checked={item.optional} onChange={e => updateIngredient(index, { optional: e.target.checked })}/> ○</label>{draftIngredients.length > 1 && <button className="delete-button" onClick={() => setDraftIngredients(current => current.filter((_, i) => i !== index))}>×</button>}</div>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => { setShowCreator(false); resetCreator(); }} disabled={saving}>Отмена</button><button className="primary-button" onClick={createRecipe} disabled={saving}>{saving ? "Сохраняем..." : "Создать рецепт"}</button></div></div></div>}
  </section>;
}
