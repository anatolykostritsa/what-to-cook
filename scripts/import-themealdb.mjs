import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });
const API = "https://www.themealdb.com/api/json/v1/1";
const sample = process.argv.includes("--sample");

const normalize = (value) => value.normalize("NFKD").toLowerCase().replace(/[^a-zа-яё0-9 ]/gi, " ").replace(/\b(classic|traditional|easy|best|recipe)\b/g, " ").replace(/\s+/g, " ").trim();
const uuidFrom = (value) => { const h=createHash("sha256").update(value).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const parseMeasure = (raw) => { const m=(raw||"").trim().match(/^(\d+(?:[.,]\d+)?)(?:\s*)(g|kg|ml|l)?$/i); return m ? { quantity:Number(m[1].replace(",",".")), unit:m[2]?.toLowerCase() || null } : { quantity:null, unit:(raw||"").trim() || null }; };
async function fetchJson(path) { const response=await fetch(`${API}/${path}`); if(!response.ok) throw new Error(`${response.status} ${path}`); return response.json(); }
async function meals() {
  if (sample) return (await Promise.all(["52771","52772","52774"].map(id=>fetchJson(`lookup.php?i=${id}`)))).flatMap(x=>x.meals||[]);
  const all=[]; for (const letter of "abcdefghijklmnopqrstuvwxyz") { const data=await fetchJson(`search.php?f=${letter}`); all.push(...(data.meals||[])); } return [...new Map(all.map(x=>[x.idMeal,x])).values()];
}

let imported=0;
for (const meal of await meals()) {
  const ingredients=[];
  for(let i=1;i<=20;i++){ const name=(meal[`strIngredient${i}`]||"").trim(); if(!name) continue; const normalized=normalize(name); const measure=parseMeasure(meal[`strMeasure${i}`]);
    const {data:catalog,error:catalogError}=await db.from("ingredients_catalog").upsert({canonical_name:name,normalized_name:normalized,aliases:[normalized],popularity:1},{onConflict:"normalized_name"}).select("id").single(); if(catalogError) throw catalogError;
    ingredients.push({ingredient_id:catalog.id,name,display_name:name,quantity:measure.quantity,unit:measure.unit,optional:false,sort_order:i-1});
  }
  const main=ingredients.slice(0,8).map(x=>normalize(x.name)).sort().join("|");
  const groupKey=[normalize(meal.strMeal),normalize(meal.strArea||""),normalize(meal.strCategory||""),main].join("::");
  const groupId=uuidFrom(groupKey);
  const {data:primary}=await db.from("recipes").select("id").eq("canonical_group_id",groupId).eq("is_primary_variant",true).neq("external_id",meal.idMeal).limit(1).maybeSingle();
  const recipe={recipe_type:"system",household_id:null,created_by:null,name:meal.strMeal,normalized_name:normalize(meal.strMeal),description:null,instructions:meal.strInstructions||null,prep_time_minutes:null,servings:null,difficulty:null,cuisine:meal.strArea||null,category:meal.strCategory||null,image_url:meal.strMealThumb||null,source_name:"TheMealDB",source_url:`https://www.themealdb.com/meal/${meal.idMeal}`,external_id:meal.idMeal,canonical_group_id:groupId,is_primary_variant:!primary};
  const {data:saved,error}=await db.from("recipes").upsert(recipe,{onConflict:"source_name,external_id"}).select("id").single(); if(error) throw error;
  const {error:deleteError}=await db.from("recipe_ingredients").delete().eq("recipe_id",saved.id); if(deleteError) throw deleteError;
  const {error:ingredientError}=await db.from("recipe_ingredients").insert(ingredients.map(x=>({...x,recipe_id:saved.id}))); if(ingredientError) throw ingredientError;
  imported++;
}
console.log(`Импортировано/обновлено рецептов: ${imported}`);
