-- Recipe System 2.0: one catalog for system and household recipes.
create extension if not exists pg_trgm;

alter table public.recipes
  add column if not exists recipe_type text not null default 'user',
  add column if not exists cuisine text,
  add column if not exists category text,
  add column if not exists image_url text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists external_id text,
  add column if not exists normalized_name text,
  add column if not exists canonical_group_id uuid,
  add column if not exists is_primary_variant boolean not null default true;

update public.recipes set recipe_type='user' where recipe_type is null;
update public.recipes set normalized_name=replace(lower(trim(name)), 'ё', 'е') where normalized_name is null;
alter table public.recipes drop constraint if exists recipes_recipe_type_check;
alter table public.recipes add constraint recipes_recipe_type_check check (recipe_type in ('system','user'));
alter table public.recipes drop constraint if exists recipes_system_ownership_check;
alter table public.recipes add constraint recipes_system_ownership_check check (
  (recipe_type='system' and household_id is null and source_name is not null and external_id is not null)
  or (recipe_type='user' and household_id is not null and created_by is not null)
) not valid;
alter table public.recipes drop constraint if exists recipes_difficulty_check;
update public.recipes set difficulty=case difficulty when 'Легко' then 'easy' when 'Средне' then 'medium' when 'Сложно' then 'hard' else difficulty end;
alter table public.recipes add constraint recipes_difficulty_check check (difficulty is null or difficulty in ('easy','medium','hard'));
create unique index if not exists recipes_source_external_unique on public.recipes(source_name,external_id) where recipe_type='system';
create index if not exists recipes_scope_idx on public.recipes(recipe_type,household_id,is_primary_variant);
create index if not exists recipes_cuisine_idx on public.recipes(cuisine);
create index if not exists recipes_category_idx on public.recipes(category);
create index if not exists recipes_normalized_name_trgm_idx on public.recipes using gin(normalized_name gin_trgm_ops);
create index if not exists recipes_canonical_group_idx on public.recipes(canonical_group_id);

create table if not exists public.ingredients_catalog (
  id uuid primary key default gen_random_uuid(), canonical_name text not null,
  normalized_name text not null unique, category text, default_unit text,
  aliases text[] not null default '{}', popularity integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ingredients_catalog_name_trgm_idx on public.ingredients_catalog using gin(normalized_name gin_trgm_ops);
create index if not exists ingredients_catalog_aliases_idx on public.ingredients_catalog using gin(aliases);

alter table public.recipe_ingredients
  add column if not exists ingredient_id uuid references public.ingredients_catalog(id) on delete set null,
  add column if not exists display_name text,
  add column if not exists sort_order integer not null default 0;
update public.recipe_ingredients set display_name=name where display_name is null;
create index if not exists recipe_ingredients_catalog_idx on public.recipe_ingredients(ingredient_id);

alter table public.products add column if not exists ingredient_id uuid references public.ingredients_catalog(id) on delete set null;
alter table public.shopping_items add column if not exists ingredient_id uuid references public.ingredients_catalog(id) on delete set null;
create index if not exists products_ingredient_idx on public.products(household_id,ingredient_id);
create index if not exists shopping_ingredient_idx on public.shopping_items(household_id,ingredient_id);

create table if not exists public.recipe_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,recipe_id)
);
alter table public.recipe_favorites enable row level security;
drop policy if exists "favorites are private" on public.recipe_favorites;
create policy "favorites are private" on public.recipe_favorites for all to authenticated
  using (user_id=auth.uid()) with check (user_id=auth.uid());

-- Atomic create/update. Authorization and ingredient replacement share one transaction.
create or replace function public.save_household_recipe(p_recipe_id uuid, p_household_id uuid, p_recipe jsonb, p_ingredients jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_item jsonb; v_difficulty text:=p_recipe->>'difficulty';
begin
  if v_user is null or not exists(select 1 from household_members where household_id=p_household_id and user_id=v_user) then raise exception 'Access denied'; end if;
  if nullif(trim(p_recipe->>'name'),'') is null then raise exception 'Recipe name is required'; end if;
  if v_difficulty is not null and v_difficulty not in ('easy','medium','hard') then raise exception 'Invalid difficulty'; end if;
  if jsonb_typeof(p_ingredients)<>'array' or jsonb_array_length(p_ingredients)=0 then raise exception 'At least one ingredient is required'; end if;
  if p_recipe_id is null then
    insert into recipes(household_id,created_by,recipe_type,name,normalized_name,description,instructions,prep_time_minutes,servings,difficulty,cuisine,category,image_url)
    values(p_household_id,v_user,'user',trim(p_recipe->>'name'),replace(lower(trim(p_recipe->>'name')),'ё','е'),nullif(trim(p_recipe->>'description'),''),nullif(trim(p_recipe->>'instructions'),''),nullif(p_recipe->>'prep_time_minutes','')::integer,coalesce(nullif(p_recipe->>'servings','')::numeric,2),v_difficulty,nullif(trim(p_recipe->>'cuisine'),''),nullif(trim(p_recipe->>'category'),''),nullif(trim(p_recipe->>'image_url'),'')) returning id into v_id;
  else
    select id into v_id from recipes where id=p_recipe_id and household_id=p_household_id and recipe_type='user' for update;
    if not found then raise exception 'Recipe is read-only or not found'; end if;
    update recipes set name=trim(p_recipe->>'name'),normalized_name=replace(lower(trim(p_recipe->>'name')),'ё','е'),description=nullif(trim(p_recipe->>'description'),''),instructions=nullif(trim(p_recipe->>'instructions'),''),prep_time_minutes=nullif(p_recipe->>'prep_time_minutes','')::integer,servings=coalesce(nullif(p_recipe->>'servings','')::numeric,2),difficulty=v_difficulty,cuisine=nullif(trim(p_recipe->>'cuisine'),''),category=nullif(trim(p_recipe->>'category'),''),image_url=nullif(trim(p_recipe->>'image_url'),'') where id=v_id;
    delete from recipe_ingredients where recipe_id=v_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_ingredients) loop
    if nullif(trim(v_item->>'name'),'') is null then raise exception 'Ingredient name is required'; end if;
    insert into recipe_ingredients(recipe_id,ingredient_id,name,display_name,quantity,unit,optional,sort_order)
    values(v_id,nullif(v_item->>'ingredient_id','')::uuid,trim(v_item->>'name'),trim(v_item->>'name'),nullif(v_item->>'quantity','')::numeric,nullif(trim(v_item->>'unit'),''),coalesce((v_item->>'optional')::boolean,false),coalesce((v_item->>'sort_order')::integer,0));
  end loop;
  return v_id;
end $$;
revoke all on function public.save_household_recipe(uuid,uuid,jsonb,jsonb) from public;
grant execute on function public.save_household_recipe(uuid,uuid,jsonb,jsonb) to authenticated;

-- Catalog lookup is server filtered and ranked by pantry presence and popularity.
create or replace function public.suggest_ingredients(p_household_id uuid,p_query text,p_limit integer default 8)
returns table(id uuid,canonical_name text,default_unit text,category text) language sql stable security definer set search_path=public as $$
 select c.id,c.canonical_name,c.default_unit,c.category from ingredients_catalog c
 where auth.uid() is not null and exists(select 1 from household_members m where m.household_id=p_household_id and m.user_id=auth.uid())
 and (p_query='' or c.normalized_name like replace(lower(trim(p_query)),'ё','е')||'%' or exists(select 1 from unnest(c.aliases) a where a like replace(lower(trim(p_query)),'ё','е')||'%'))
 order by case when c.normalized_name=replace(lower(trim(p_query)),'ё','е') then 0 when c.normalized_name like replace(lower(trim(p_query)),'ё','е')||'%' then 1 else 2 end,
 exists(select 1 from products p where p.household_id=p_household_id and (p.ingredient_id=c.id or replace(lower(trim(p.name)),'ё','е')=c.normalized_name)) desc,c.popularity desc,c.canonical_name limit least(greatest(p_limit,1),20)
$$;
revoke all on function public.suggest_ingredients(uuid,text,integer) from public;
grant execute on function public.suggest_ingredients(uuid,text,integer) to authenticated;

alter table public.ingredients_catalog enable row level security;
drop policy if exists "authenticated read ingredient catalog" on public.ingredients_catalog;
create policy "authenticated read ingredient catalog" on public.ingredients_catalog for select to authenticated using (true);

-- System rows are visible, household rows retain membership isolation. These
-- policies are intentionally command-specific; service_role bypasses RLS for import.
drop policy if exists "read system recipes" on public.recipes;
create policy "read system recipes" on public.recipes for select to authenticated using (recipe_type='system');
drop policy if exists "read system recipe ingredients" on public.recipe_ingredients;
create policy "read system recipe ingredients" on public.recipe_ingredients for select to authenticated using (exists(select 1 from recipes r where r.id=recipe_id and r.recipe_type='system'));

-- Per-user favorites replace the legacy shared flag.
update public.recipes set is_favorite=false where recipe_type='system' and coalesce(is_favorite,false);

-- Existing installations originally required household ownership. System recipes
-- intentionally have neither a household nor an end-user author.
alter table public.recipes alter column household_id drop not null;
alter table public.recipes alter column created_by drop not null;

create or replace function public.protect_system_recipe() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and current_user not in ('postgres','supabase_admin') and
     ((tg_op in ('UPDATE','DELETE') and old.recipe_type='system') or (tg_op='INSERT' and new.recipe_type='system'))
  then raise exception 'System recipes are read-only'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists protect_system_recipe_write on public.recipes;
create trigger protect_system_recipe_write before insert or update or delete on public.recipes
for each row execute function public.protect_system_recipe();
