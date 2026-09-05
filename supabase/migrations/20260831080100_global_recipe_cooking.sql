-- Allow the same atomic, server-validated cooking flow for catalog recipes.
-- Canonical IDs are authoritative when both sides have one. Legacy/custom rows
-- fall back to the existing normalized-name compatibility rule.
create or replace function public.recipe_product_matches(p_ingredient_id uuid, p_product_id uuid)
returns boolean language sql stable set search_path=public as $$
  select case
    when ingredient.ingredient_id is not null and product.ingredient_id is not null
      then ingredient.ingredient_id = product.ingredient_id
    else
      replace(lower(trim(product.name)), 'ё', 'е') like '%' || replace(lower(trim(ingredient.name)), 'ё', 'е') || '%'
      or replace(lower(trim(ingredient.name)), 'ё', 'е') like '%' || replace(lower(trim(product.name)), 'ё', 'е') || '%'
  end
  from public.recipe_ingredients ingredient
  join public.products product on product.id = p_product_id
  where ingredient.id = p_ingredient_id
$$;
revoke all on function public.recipe_product_matches(uuid,uuid) from public;
grant execute on function public.recipe_product_matches(uuid,uuid) to authenticated;

create or replace function public.cook_recipe(p_recipe_id uuid, p_household_id uuid, p_servings numeric, p_deductions jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user_id uuid := auth.uid(); v_recipe public.recipes; v_ingredient public.recipe_ingredients;
  v_product public.products; v_entry jsonb; v_amount numeric; v_expected numeric; v_submitted numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_recipe from public.recipes where id=p_recipe_id;
  if not found then raise exception 'Recipe not found'; end if;
  if not exists(select 1 from public.household_members where household_id=p_household_id and user_id=v_user_id) then raise exception 'Access denied'; end if;
  if v_recipe.recipe_type='user' and v_recipe.household_id<>p_household_id then raise exception 'Access denied'; end if;
  if coalesce(p_servings,0)<=0 then raise exception 'Servings must be positive'; end if;
  if jsonb_typeof(coalesce(p_deductions,'[]'::jsonb))<>'array' then raise exception 'Invalid deductions'; end if;

  for v_ingredient in select * from public.recipe_ingredients where recipe_id=p_recipe_id loop
    if v_ingredient.quantity is null then
      if not coalesce(v_ingredient.optional,false) then raise exception 'Ingredient quantity is unknown: %',v_ingredient.name; end if;
      v_expected:=0;
    else
      v_expected:=v_ingredient.quantity*p_servings/greatest(coalesce(v_recipe.servings,1),1)
        * case when v_ingredient.unit in ('кг','л') then 1000 else 1 end;
    end if;
    select coalesce(sum((entry->>'quantity')::numeric*case when product.unit in ('кг','л') then 1000 else 1 end),0)
      into v_submitted from jsonb_array_elements(coalesce(p_deductions,'[]'::jsonb)) entry
      join public.products product on product.id=(entry->>'product_id')::uuid
      where (entry->>'ingredient_id')::uuid=v_ingredient.id and product.household_id=p_household_id;
    if (not coalesce(v_ingredient.optional,false) and abs(v_submitted-v_expected)>0.000001)
      or (coalesce(v_ingredient.optional,false) and v_submitted<>0 and abs(v_submitted-v_expected)>0.000001)
    then raise exception 'Invalid deduction for ingredient: %',v_ingredient.name; end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_deductions,'[]'::jsonb)) loop
    v_amount:=(v_entry->>'quantity')::numeric;
    if v_amount<=0 then raise exception 'Deduction must be positive'; end if;
    select * into v_ingredient from public.recipe_ingredients where id=(v_entry->>'ingredient_id')::uuid and recipe_id=p_recipe_id;
    if not found then raise exception 'Ingredient does not belong to recipe'; end if;
    select * into v_product from public.products where id=(v_entry->>'product_id')::uuid and household_id=p_household_id for update;
    if not found or v_product.quantity is null or v_product.quantity<v_amount then raise exception 'Not enough product: %',coalesce(v_product.name,v_ingredient.name); end if;
    if not coalesce(public.recipe_product_matches(v_ingredient.id,v_product.id),false)
      then raise exception 'Product does not match ingredient: %',v_ingredient.name; end if;
    if (case when v_product.unit='кг' then 'г' when v_product.unit='л' then 'мл' when v_product.unit='шт.' then 'шт' else coalesce(v_product.unit,'') end)
      <>(case when v_ingredient.unit='кг' then 'г' when v_ingredient.unit='л' then 'мл' when v_ingredient.unit='шт.' then 'шт' else coalesce(v_ingredient.unit,'') end)
      then raise exception 'Unit mismatch: %',v_ingredient.name; end if;
    update public.products set quantity=quantity-v_amount where id=v_product.id;
  end loop;
end; $$;
revoke all on function public.cook_recipe(uuid,uuid,numeric,jsonb) from public;
grant execute on function public.cook_recipe(uuid,uuid,numeric,jsonb) to authenticated;
revoke all on function public.cook_recipe(uuid,numeric,jsonb) from public;
drop function if exists public.cook_recipe(uuid,numeric,jsonb);

create or replace function public.cook_meal_plan(
  p_meal_plan_id uuid,
  p_deductions jsonb
)
returns public.meal_plan
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.meal_plan;
  v_recipe_servings numeric;
  v_ingredient public.recipe_ingredients;
  v_deduction jsonb;
  v_product public.products;
  v_amount numeric;
  v_expected numeric;
  v_submitted numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_plan from public.meal_plan where id = p_meal_plan_id for update;
  if not found then raise exception 'Meal plan item not found'; end if;
  if not exists (
    select 1 from public.household_members
    where household_id = v_plan.household_id and user_id = v_user_id
  ) then raise exception 'Access denied'; end if;
  if v_plan.cooked_at is not null then raise exception 'This meal has already been cooked'; end if;
  if jsonb_typeof(coalesce(p_deductions, '[]'::jsonb)) <> 'array' then raise exception 'Invalid deductions'; end if;

  select greatest(coalesce(servings, 1), 1) into v_recipe_servings
  from public.recipes where id = v_plan.recipe_id
    and (recipe_type='system' or (recipe_type='user' and household_id = v_plan.household_id));
  if not found then raise exception 'Recipe not found'; end if;

  -- Required ingredients must have a known quantity and exactly enough matching,
  -- unit-compatible deductions for the planned serving count. Optional ingredients
  -- may be omitted, but cannot be over-reported by a modified client.
  for v_ingredient in
    select * from public.recipe_ingredients
    where recipe_id = v_plan.recipe_id
  loop
    if v_ingredient.quantity is null then
      if not coalesce(v_ingredient.optional, false) then
        raise exception 'Ingredient quantity is unknown: %', v_ingredient.name;
      end if;
      v_expected := 0;
    else
      v_expected := v_ingredient.quantity
        * greatest(coalesce(v_plan.servings, v_recipe_servings), 1) / v_recipe_servings
        * case when v_ingredient.unit in ('кг', 'л') then 1000 else 1 end;
    end if;

    select coalesce(sum(
      (entry->>'quantity')::numeric
      * case when product.unit in ('кг', 'л') then 1000 else 1 end
    ), 0) into v_submitted
    from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) entry
    join public.products product on product.id = (entry->>'product_id')::uuid
    where (entry->>'ingredient_id')::uuid = v_ingredient.id
      and product.household_id = v_plan.household_id;

    if (not coalesce(v_ingredient.optional, false) and abs(v_submitted - v_expected) > 0.000001)
      or (coalesce(v_ingredient.optional, false) and v_submitted <> 0 and abs(v_submitted - v_expected) > 0.000001)
    then
      raise exception 'Invalid deduction for ingredient: %', v_ingredient.name;
    end if;
  end loop;

  for v_deduction in select value from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_amount := (v_deduction->>'quantity')::numeric;
    if v_amount <= 0 then raise exception 'Deduction must be positive'; end if;

    select * into v_ingredient from public.recipe_ingredients
    where id = (v_deduction->>'ingredient_id')::uuid and recipe_id = v_plan.recipe_id;
    if not found then raise exception 'Ingredient does not belong to this recipe'; end if;

    select * into v_product from public.products
    where id = (v_deduction->>'product_id')::uuid and household_id = v_plan.household_id
    for update;
    if not found then raise exception 'Product not found'; end if;
    if not coalesce(public.recipe_product_matches(v_ingredient.id,v_product.id),false)
      then raise exception 'Product does not match ingredient: %', v_ingredient.name; end if;
    if (case when v_product.unit = 'кг' then 'г' when v_product.unit = 'л' then 'мл' when v_product.unit = 'шт.' then 'шт' else coalesce(v_product.unit, '') end)
      <> (case when v_ingredient.unit = 'кг' then 'г' when v_ingredient.unit = 'л' then 'мл' when v_ingredient.unit = 'шт.' then 'шт' else coalesce(v_ingredient.unit, '') end)
    then raise exception 'Product unit does not match ingredient: %', v_ingredient.name; end if;
    if v_product.quantity is null then raise exception 'Product quantity is unknown: %', v_product.name; end if;
    if v_product.quantity < v_amount then raise exception 'Not enough product: %', v_product.name; end if;

    update public.products set quantity = quantity - v_amount where id = v_product.id;
  end loop;

  update public.meal_plan set cooked_at = now(), cooked_by = v_user_id
  where id = v_plan.id returning * into v_plan;
  return v_plan;
end;
$$;

revoke all on function public.cook_meal_plan(uuid, jsonb) from public;
grant execute on function public.cook_meal_plan(uuid, jsonb) to authenticated;
