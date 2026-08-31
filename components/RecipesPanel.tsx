"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = { name: string; expiry_date: string | null };
type Recipe = {
  id: string;
  name: string;
  description: string | null;
  prep_time_minutes: number | null;
  servings: number | null;
  difficulty: string | null;
  is_favorite: boolean | null;
};
type Ingredient = { id: string; recipe_id: string; name: string; quantity: number | null; unit: string | null; optional: boolean | null };

type Props = { householdId: string; userId: string; products: Product[] };

function normalize(value: string) {
  return value.toLowerCase().replaceAll("ё", "е").trim();
}

function matches(productName: string, ingredientName: string) {
  const p = normalize(productName);
  const i = normalize(ingredientName);
  if (p.includes(i) || i.includes(p)) return true;

  const aliases: Record<string, string[]> = {
    яйца: ["яйцо"],
    макароны: ["паста", "спагетти", "лапша"],
    курица: ["куриное филе", "куриная грудка", "куриные грудки"],
    помидоры: ["помидор", "томаты", "томат"],
    сыр: ["моцарелла", "чеддер", "пармезан"],
    лук: ["репчатый лук"],
  };

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

  async function loadRecipes() {
    setLoading(true);
    setError("");
    const [recipeResult, ingredientResult] = await Promise.all([
      supabase.from("recipes").select("id, name, description, prep_time_minutes, servings, difficulty, is_favorite").eq("household_id", householdId).order("is_favorite", { ascending: false }).order("name", { ascending: true }),
      supabase.from("recipe_ingredients").select("id, recipe_id, name, quantity, unit, optional").order("created_at", { ascending: true }),
    ]);

    if (recipeResult.error) setError(recipeResult.error.message);
    else setRecipes(recipeResult.data ?? []);
    if (ingredientResult.error) setError(ingredientResult.error.message);
    else setIngredients((ingredientResult.data ?? []).filter((item) => recipes.length === 0 || recipes.some((recipe) => recipe.id === item.recipe_id)));
    setLoading(false);
  }

  useEffect(() => {
    loadRecipes();
  }, [householdId]);

  const scored = useMemo(() => {
    return recipes.map((recipe) => {
      const recipeIngredients = ingredients.filter((item) => item.recipe_id === recipe.id);
      const required = recipeIngredients.filter((item) => !item.optional);
      const matched = required.filter((ingredient) => products.some((product) => matches(product.name, ingredient.name)));
      const missing = required.filter((ingredient) => !products.some((product) => matches(product.name, ingredient.name)));
      const score = required.length === 0 ? 100 : Math.round((matched.length / required.length) * 100);
      return { recipe, ingredients: recipeIngredients, missing, score };
    });
  }, [recipes, ingredients, products]);

  const visible = scored
    .filter(({ recipe, score }) => !search.trim() || normalize(recipe.name).includes(normalize(search)))
    .filter(({ score }) => !onlyAvailable || score === 100)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.recipe.is_favorite)) - Number(Boolean(a.recipe.is_favorite)));

  async function addMissingToShopping(recipeId: string) {
    const item = scored.find((entry) => entry.recipe.id === recipeId);
    if (!item || !item.missing.length) return;
    setAdding(recipeId);
    setError("");
    try {
      const rows = item.missing.map((ingredient) => ({
        household_id: householdId,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        done: false,
        added_from_recipe: recipeId,
        created_by: userId,
      }));
      const { error: insertError } = await supabase.from("shopping_items").insert(rows);
      if (insertError) throw insertError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить продукты в покупки.");
    } finally {
      setAdding(null);
    }
  }

  if (loading) return <div className="empty-state">Загружаем рецепты...</div>;

  return (
    <section className="dashboard-card recipes-card">
      <div className="card-heading">
        <div><span className="card-label">УМНЫЙ ПОДБОР</span><h2>Что приготовить?</h2></div>
        <span className="count-badge">{recipes.length}</span>
      </div>

      <div className="recipe-toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти рецепт..." />
        <label className="recipe-filter"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Только из того, что есть</label>
      </div>

      {error && <div className="form-error">{error}</div>}
      {!recipes.length && <div className="empty-state">Рецептов пока нет. Добавим конструктор рецептов следующим этапом.</div>}

      <div className="recipe-grid">
        {visible.map(({ recipe, ingredients: recipeIngredients, missing, score }) => (
          <article className="recipe-card" key={recipe.id}>
            <div className={`recipe-score ${score === 100 ? "perfect" : ""}`}>{score}%</div>
            <div className="recipe-title-row"><h3>{recipe.name}</h3>{recipe.is_favorite && <span title="Избранное">★</span>}</div>
            {recipe.description && <p className="recipe-description">{recipe.description}</p>}
            <div className="recipe-meta">
              {recipe.prep_time_minutes ? `⏱ ${recipe.prep_time_minutes} мин` : "⏱ Время не указано"}
              {recipe.servings ? ` · 👥 ${recipe.servings}` : ""}
              {recipe.difficulty ? ` · ${recipe.difficulty}` : ""}
            </div>
            <div className="recipe-ingredients">
              {recipeIngredients.map((ingredient) => {
                const available = products.some((product) => matches(product.name, ingredient.name));
                return <span className={`ingredient ${available ? "available" : ingredient.optional ? "optional" : "missing"}`} key={ingredient.id}>{available ? "✓" : ingredient.optional ? "○" : "+"} {ingredient.name}</span>;
              })}
            </div>
            {score === 100 ? (
              <p className="recipe-perfect">🎉 Всё необходимое уже есть дома</p>
            ) : missing.length ? (
              <><p className="recipe-missing">Не хватает: {missing.map((item) => item.name).join(", ")}</p><button className="secondary-button recipe-shopping-button" onClick={() => addMissingToShopping(recipe.id)} disabled={adding === recipe.id}>{adding === recipe.id ? "Добавляем..." : "Добавить недостающее в покупки"}</button></>
            ) : null}
          </article>
        ))}
      </div>
      {recipes.length > 0 && visible.length === 0 && <div className="empty-state">По вашему фильтру ничего не найдено.</div>}
    </section>
  );
}
