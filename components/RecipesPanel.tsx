"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = { name: string; expiry_date: string | null };
type Recipe = { id: string; name: string; description: string | null; instructions: string | null; prep_time_minutes: number | null; servings: number | null; difficulty: string | null; is_favorite: boolean | null };
type Ingredient = { id: string; recipe_id: string; name: string; quantity: number | null; unit: string | null; optional: boolean | null };
type DraftIngredient = { name: string; quantity: string; unit: string; optional: boolean };
type Props = { householdId: string; userId: string; products: Product[] };

const UNITS = ["шт.", "г", "кг", "мл", "л", "уп.", "пач."];
const DIFFICULTIES = ["Легко", "Средне", "Сложно"];
const EMPTY_INGREDIENT: DraftIngredient = { name: "", quantity: "", unit: "шт.", optional: false };

function normalize(value: string) { return value.toLowerCase().replaceAll("ё", "е").trim(); }
function matches(productName: string, ingredientName: string) {
  const product = normalize(productName); const ingredient = normalize(ingredientName);
  if (product.includes(ingredient) || ingredient.includes(product)) return true;
  const aliases: Record<string, string[]> = { яйца: ["яйцо"], макароны: ["паста", "спагетти", "лапша"], курица: ["куриное филе", "куриная грудка"], помидоры: ["помидор", "томаты", "томат"], сыр: ["моцарелла", "чеддер", "пармезан"], лук: ["репчатый лук"] };
  return (aliases[ingredient] ?? []).some((alias) => product.includes(alias) || alias.includes(product));
}

export default function RecipesPanel({ householdId, userId, products }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [recipes, setRecipes] = useState<Recipe[]>([]); const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState(""); const [onlyAvailable, setOnlyAvailable] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [adding, setAdding] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); const [viewing, setViewing] = useState<Recipe | null>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [instructions, setInstructions] = useState("");
  const [prepTime, setPrepTime] = useState(""); const [servings, setServings] = useState("2"); const [difficulty, setDifficulty] = useState("Легко");
  const [favorite, setFavorite] = useState(false); const [draftIngredients, setDraftIngredients] = useState<DraftIngredient[]>([{ ...EMPTY_INGREDIENT }]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true); setError("");
    const [recipeResult, ingredientResult] = await Promise.all([
      supabase.from("recipes").select("id,name,description,instructions,prep_time_minutes,servings,difficulty,is_favorite").eq("household_id", householdId).order("is_favorite", { ascending: false }).order("name"),
      supabase.from("recipe_ingredients").select("id,recipe_id,name,quantity,unit,optional").order("created_at"),
    ]);
    if (recipeResult.error) setError(recipeResult.error.message); else setRecipes(recipeResult.data ?? []);
    if (ingredientResult.error) setError(ingredientResult.error.message); else setIngredients(ingredientResult.data ?? []);
    if (showLoading) setLoading(false);
  }, [householdId, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const channel = supabase.channel(`recipes-${householdId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipes", filter: `household_id=eq.${householdId}` }, () => void load(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_ingredients" }, () => void load(false)).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [householdId, load, supabase]);

  const scored = useMemo(() => recipes.map((recipe) => { const list = ingredients.filter((item) => item.recipe_id === recipe.id); const required = list.filter((item) => !item.optional); const missing = required.filter((item) => !products.some((product) => matches(product.name, item.name))); return { recipe, ingredients: list, missing, score: required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 100 }; }), [recipes, ingredients, products]);
  const visible = scored.filter(({ recipe, score }) => (!search.trim() || normalize(recipe.name).includes(normalize(search))) && (!onlyAvailable || score === 100)).sort((a, b) => b.score - a.score || Number(Boolean(b.recipe.is_favorite)) - Number(Boolean(a.recipe.is_favorite)));

  function closeEditor() { setEditingId(null); setName(""); setDescription(""); setInstructions(""); setPrepTime(""); setServings("2"); setDifficulty("Легко"); setFavorite(false); setDraftIngredients([{ ...EMPTY_INGREDIENT }]); setError(""); }
  function editRecipe(recipe?: Recipe) {
    if (!recipe) { closeEditor(); setEditingId("new"); return; }
    setEditingId(recipe.id); setName(recipe.name); setDescription(recipe.description ?? ""); setInstructions(recipe.instructions ?? ""); setPrepTime(recipe.prep_time_minutes?.toString() ?? ""); setServings(recipe.servings?.toString() ?? "2"); setDifficulty(recipe.difficulty ?? "Легко"); setFavorite(Boolean(recipe.is_favorite));
    const list = ingredients.filter((item) => item.recipe_id === recipe.id).map((item) => ({ name: item.name, quantity: item.quantity?.toString() ?? "", unit: item.unit ?? "шт.", optional: Boolean(item.optional) })); setDraftIngredients(list.length ? list : [{ ...EMPTY_INGREDIENT }]); setError("");
  }
  function updateIngredient(index: number, patch: Partial<DraftIngredient>) { setDraftIngredients((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item)); }

  async function saveRecipe() {
    const valid = draftIngredients.filter((item) => item.name.trim()); if (!name.trim()) { setError("Введите название рецепта."); return; } if (!valid.length) { setError("Добавьте хотя бы один ингредиент."); return; }
    setSaving(true); setError("");
    try {
      const values = { household_id: householdId, name: name.trim(), description: description.trim() || null, instructions: instructions.trim() || null, prep_time_minutes: prepTime ? Number(prepTime) : null, servings: servings ? Number(servings) : 2, difficulty, is_favorite: favorite };
      let recipeId = editingId;
      if (editingId === "new") { const { data, error: recipeError } = await supabase.from("recipes").insert({ ...values, created_by: userId }).select("id").single(); if (recipeError) throw recipeError; recipeId = data.id; }
      else { const { error: recipeError } = await supabase.from("recipes").update(values).eq("id", editingId!); if (recipeError) throw recipeError; const { error: deleteError } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", editingId!); if (deleteError) throw deleteError; }
      const rows = valid.map((item) => ({ recipe_id: recipeId, name: item.name.trim(), quantity: item.quantity ? Number(item.quantity) : null, unit: item.unit || null, optional: item.optional }));
      const { error: ingredientError } = await supabase.from("recipe_ingredients").insert(rows); if (ingredientError) throw ingredientError;
      closeEditor(); await load(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить рецепт."); } finally { setSaving(false); }
  }
  async function toggleFavorite(recipe: Recipe) { const next = !recipe.is_favorite; setRecipes((current) => current.map((item) => item.id === recipe.id ? { ...item, is_favorite: next } : item)); const { error: updateError } = await supabase.from("recipes").update({ is_favorite: next }).eq("id", recipe.id); if (updateError) { setError(updateError.message); await load(false); } }
  async function deleteRecipe(recipe: Recipe) { if (!window.confirm(`Удалить рецепт «${recipe.name}»?`)) return; setError(""); const { error: ingredientError } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipe.id); if (ingredientError) { setError(ingredientError.message); return; } const { error: recipeError } = await supabase.from("recipes").delete().eq("id", recipe.id); if (recipeError) setError(recipeError.message); else { setRecipes((current) => current.filter((item) => item.id !== recipe.id)); setIngredients((current) => current.filter((item) => item.recipe_id !== recipe.id)); } }
  async function addMissingToShopping(recipeId: string) { const item = scored.find((entry) => entry.recipe.id === recipeId); if (!item?.missing.length) return; setAdding(recipeId); const { error: insertError } = await supabase.rpc("add_or_merge_shopping_items", { p_household_id: householdId, p_items: item.missing.map((ingredient) => ({ name: ingredient.name, quantity: ingredient.quantity, unit: ingredient.unit, recipe_id: recipeId })) }); if (insertError) setError(insertError.message); setAdding(null); }

  if (loading) return <section className="dashboard-card"><div className="empty-state">Загружаем рецепты...</div></section>;
  return <section className="dashboard-card recipes-card">
    <div className="card-heading"><div><span className="card-label">УМНЫЙ ПОДБОР</span><h2>Что приготовить?</h2></div><div className="recipe-heading-actions"><span className="count-badge">{recipes.length}</span><button className="primary-button compact-button" onClick={() => editRecipe()}>+ Рецепт</button></div></div>
    <div className="recipe-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти рецепт..."/><label className="recipe-filter"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)}/> Только из того, что есть</label></div>{error && <div className="form-error">{error}</div>}
    {!recipes.length ? <div className="empty-state">Рецептов пока нет. Создайте первый рецепт — он сразу начнёт участвовать в подборе.</div> : <div className="recipe-grid">{visible.map(({ recipe, ingredients: list, missing, score }) => <article className="recipe-card" key={recipe.id}><div className={`recipe-score ${score === 100 ? "perfect" : ""}`}>{score}%</div><div className="recipe-title-row"><h3>{recipe.name}</h3><button className="favorite-button" onClick={() => toggleFavorite(recipe)} aria-label="Избранное">{recipe.is_favorite ? "★" : "☆"}</button></div>{recipe.description && <p className="recipe-description">{recipe.description}</p>}<div className="recipe-meta">{recipe.prep_time_minutes ? `⏱ ${recipe.prep_time_minutes} мин` : "⏱ Время не указано"}{recipe.servings ? ` · 👥 ${recipe.servings}` : ""}{recipe.difficulty ? ` · ${recipe.difficulty}` : ""}</div><div className="recipe-ingredients">{list.map((ingredient) => { const available = products.some((product) => matches(product.name, ingredient.name)); return <span className={`ingredient ${available ? "available" : ingredient.optional ? "optional" : "missing"}`} key={ingredient.id}>{available ? "✓" : ingredient.optional ? "○" : "+"} {ingredient.name}</span>; })}</div>{score === 100 ? <p className="recipe-perfect">🎉 Всё необходимое уже есть дома</p> : <><p className="recipe-missing">Не хватает: {missing.map((item) => item.name).join(", ")}</p><button className="secondary-button recipe-shopping-button" disabled={adding === recipe.id} onClick={() => addMissingToShopping(recipe.id)}>{adding === recipe.id ? "Добавляем..." : "Добавить недостающее в покупки"}</button></>}<div className="recipe-card-actions"><button className="secondary-button compact-button" onClick={() => setViewing(recipe)}>Открыть</button><button className="icon-button" onClick={() => editRecipe(recipe)} aria-label="Редактировать">✎</button><button className="delete-button" onClick={() => deleteRecipe(recipe)} aria-label="Удалить">×</button></div></article>)}</div>}
    {recipes.length > 0 && !visible.length && <div className="empty-state">По вашему фильтру ничего не найдено.</div>}
    {viewing && <div className="modal-backdrop" onMouseDown={() => setViewing(null)}><div className="edit-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="card-label">РЕЦЕПТ</span><h2>{viewing.name}</h2></div><button className="modal-close" onClick={() => setViewing(null)}>×</button></div>{viewing.description && <p>{viewing.description}</p>}<h3>Ингредиенты</h3><ul>{ingredients.filter((item) => item.recipe_id === viewing.id).map((item) => <li key={item.id}>{item.name}{item.quantity !== null ? ` — ${item.quantity} ${item.unit ?? ""}` : ""}{item.optional ? " (необязательно)" : ""}</li>)}</ul><h3>Как приготовить</h3><p className="recipe-instructions">{viewing.instructions || "Инструкция пока не добавлена."}</p></div></div>}
    {editingId && <div className="modal-backdrop"><div className="edit-modal recipe-creator"><div className="modal-header"><div><span className="card-label">{editingId === "new" ? "НОВЫЙ РЕЦЕПТ" : "РЕЦЕПТ"}</span><h2>{editingId === "new" ? "Создать рецепт" : "Редактировать рецепт"}</h2></div><button className="modal-close" onClick={closeEditor}>×</button></div><div className="recipe-creator-fields"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название"/><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Короткое описание" rows={2}/><div className="product-form-row"><input type="number" min="1" value={prepTime} onChange={(event) => setPrepTime(event.target.value)} placeholder="Время, мин"/><input type="number" min="1" value={servings} onChange={(event) => setServings(event.target.value)} placeholder="Порции"/></div><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Как приготовить" rows={5}/><label className="favorite-toggle"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)}/> Добавить в избранное</label></div><div className="ingredient-builder"><div className="builder-heading"><strong>Ингредиенты</strong><button className="icon-add-button" onClick={() => setDraftIngredients((current) => [...current, { ...EMPTY_INGREDIENT }])}>+ Добавить</button></div>{draftIngredients.map((item, index) => <div className="ingredient-row" key={index}><input value={item.name} onChange={(event) => updateIngredient(index, { name: event.target.value })} placeholder="Ингредиент"/><input className="ingredient-quantity" type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateIngredient(index, { quantity: event.target.value })} placeholder="Кол."/><select value={item.unit} onChange={(event) => updateIngredient(index, { unit: event.target.value })}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select><label title="Необязательный"><input type="checkbox" checked={item.optional} onChange={(event) => updateIngredient(index, { optional: event.target.checked })}/> ○</label>{draftIngredients.length > 1 && <button className="delete-button" onClick={() => setDraftIngredients((current) => current.filter((_, i) => i !== index))}>×</button>}</div>)}</div><div className="modal-actions"><button className="secondary-button" onClick={closeEditor} disabled={saving}>Отмена</button><button className="primary-button" onClick={saveRecipe} disabled={saving}>{saving ? "Сохраняем..." : "Сохранить"}</button></div></div></div>}
  </section>;
}
