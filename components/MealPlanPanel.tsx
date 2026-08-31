"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Recipe = { id: string; name: string };
type PlanItem = { id: string; recipe_id: string; planned_date: string; meal_type: string; servings: number | null; notes: string | null };

type Props = { householdId: string; userId: string };

const MEALS = [
  { key: "breakfast", label: "Завтрак", icon: "☀️" },
  { key: "lunch", label: "Обед", icon: "🍲" },
  { key: "dinner", label: "Ужин", icon: "🌙" },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export default function MealPlanPanel({ householdId, userId }: Props) {
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [weekStart, setWeekStart] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return isoDate(date);
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${weekStart}T12:00:00`);
    date.setDate(date.getDate() + index);
    return { date: isoDate(date), label: formatDay(date) };
  }), [weekStart]);

  async function load() {
    setLoading(true);
    setError("");
    const end = days[days.length - 1].date;
    const [recipeResult, planResult] = await Promise.all([
      supabase.from("recipes").select("id, name").eq("household_id", householdId).order("name"),
      supabase.from("meal_plan").select("id, recipe_id, planned_date, meal_type, servings, notes").eq("household_id", householdId).gte("planned_date", weekStart).lte("planned_date", end).order("planned_date"),
    ]);
    if (recipeResult.error) setError(recipeResult.error.message); else setRecipes(recipeResult.data ?? []);
    if (planResult.error) setError(planResult.error.message); else setItems(planResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [householdId, weekStart]);

  function getItem(date: string, mealType: string) {
    return items.find((item) => item.planned_date === date && item.meal_type === mealType);
  }

  async function setMeal(date: string, mealType: string, recipeId: string) {
    const key = `${date}:${mealType}`;
    setSaving(key);
    setError("");
    try {
      const existing = getItem(date, mealType);
      if (!recipeId) {
        if (existing) {
          const { error } = await supabase.from("meal_plan").delete().eq("id", existing.id);
          if (error) throw error;
          setItems((current) => current.filter((item) => item.id !== existing.id));
        }
        return;
      }
      if (existing) {
        const { data, error } = await supabase.from("meal_plan").update({ recipe_id: recipeId }).eq("id", existing.id).select("id, recipe_id, planned_date, meal_type, servings, notes").single();
        if (error) throw error;
        setItems((current) => current.map((item) => item.id === existing.id ? data : item));
      } else {
        const { data, error } = await supabase.from("meal_plan").insert({ household_id: householdId, recipe_id: recipeId, planned_date: date, meal_type: mealType, servings: 2, created_by: userId }).select("id, recipe_id, planned_date, meal_type, servings, notes").single();
        if (error) throw error;
        setItems((current) => [...current, data]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить план.");
    } finally {
      setSaving(null);
    }
  }

  function shiftWeek(offset: number) {
    const date = new Date(`${weekStart}T12:00:00`);
    date.setDate(date.getDate() + offset * 7);
    setWeekStart(isoDate(date));
  }

  if (loading) return <section className="dashboard-card"><div className="empty-state">Загружаем план питания...</div></section>;

  return <section className="dashboard-card meal-plan-card">
    <div className="card-heading">
      <div><span className="card-label">ОРГАНИЗАЦИЯ ПИТАНИЯ</span><h2>План на неделю</h2></div>
      <div className="plan-week-actions">
        <button className="secondary-button compact-button" onClick={() => shiftWeek(-1)}>←</button>
        <button className="secondary-button compact-button" onClick={() => { const now = new Date(); const day = now.getDay(); const diff = day === 0 ? -6 : 1 - day; now.setDate(now.getDate() + diff); setWeekStart(isoDate(now)); }}>Сегодня</button>
        <button className="secondary-button compact-button" onClick={() => shiftWeek(1)}>→</button>
      </div>
    </div>
    {error && <div className="form-error">{error}</div>}
    {!recipes.length ? <div className="empty-state">Сначала создайте хотя бы один рецепт — после этого его можно будет добавить в план.</div> : <div className="meal-plan-grid">
      {days.map((day) => <div className="meal-plan-day" key={day.date}>
        <div className="meal-plan-date">{day.label}</div>
        {MEALS.map((meal) => {
          const item = getItem(day.date, meal.key);
          const key = `${day.date}:${meal.key}`;
          return <div className="meal-slot" key={meal.key}>
            <div className="meal-slot-label"><span>{meal.icon}</span>{meal.label}</div>
            <select value={item?.recipe_id ?? ""} onChange={(event) => setMeal(day.date, meal.key, event.target.value)} disabled={saving === key}>
              <option value="">— Не запланировано —</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </div>;
        })}
      </div>)}
    </div>}
  </section>;
}
