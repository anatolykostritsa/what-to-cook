create or replace function public.remove_empty_product() returns trigger language plpgsql set search_path=public as $$
begin
  if new.quantity = 0 then delete from public.products where id = new.id; return null; end if;
  return new;
end; $$;
drop trigger if exists remove_empty_product_after_update on public.products;
create trigger remove_empty_product_after_update after update of quantity on public.products
for each row when (new.quantity = 0) execute function public.remove_empty_product();

create or replace function public.cook_recipe(p_recipe_id uuid, p_servings numeric, p_deductions jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user_id uuid := auth.uid(); v_recipe public.recipes; v_ingredient public.recipe_ingredients;
  v_product public.products; v_entry jsonb; v_amount numeric; v_expected numeric; v_submitted numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_recipe from public.recipes where id=p_recipe_id;
  if not found then raise exception 'Recipe not found'; end if;
  if not exists(select 1 from public.household_members where household_id=v_recipe.household_id and user_id=v_user_id) then raise exception 'Access denied'; end if;
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
      where (entry->>'ingredient_id')::uuid=v_ingredient.id and product.household_id=v_recipe.household_id;
    if (not coalesce(v_ingredient.optional,false) and abs(v_submitted-v_expected)>0.000001)
      or (coalesce(v_ingredient.optional,false) and v_submitted<>0 and abs(v_submitted-v_expected)>0.000001)
    then raise exception 'Invalid deduction for ingredient: %',v_ingredient.name; end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_deductions,'[]'::jsonb)) loop
    v_amount:=(v_entry->>'quantity')::numeric;
    if v_amount<=0 then raise exception 'Deduction must be positive'; end if;
    select * into v_ingredient from public.recipe_ingredients where id=(v_entry->>'ingredient_id')::uuid and recipe_id=p_recipe_id;
    if not found then raise exception 'Ingredient does not belong to recipe'; end if;
    select * into v_product from public.products where id=(v_entry->>'product_id')::uuid and household_id=v_recipe.household_id for update;
    if not found or v_product.quantity is null or v_product.quantity<v_amount then raise exception 'Not enough product: %',coalesce(v_product.name,v_ingredient.name); end if;
    if not (replace(lower(trim(v_product.name)),'ё','е') like '%'||replace(lower(trim(v_ingredient.name)),'ё','е')||'%'
      or replace(lower(trim(v_ingredient.name)),'ё','е') like '%'||replace(lower(trim(v_product.name)),'ё','е')||'%') then raise exception 'Product does not match ingredient: %',v_ingredient.name; end if;
    if (case when v_product.unit='кг' then 'г' when v_product.unit='л' then 'мл' when v_product.unit='шт.' then 'шт' else coalesce(v_product.unit,'') end)
      <>(case when v_ingredient.unit='кг' then 'г' when v_ingredient.unit='л' then 'мл' when v_ingredient.unit='шт.' then 'шт' else coalesce(v_ingredient.unit,'') end)
      then raise exception 'Unit mismatch: %',v_ingredient.name; end if;
    update public.products set quantity=quantity-v_amount where id=v_product.id;
  end loop;
end; $$;
revoke all on function public.cook_recipe(uuid,numeric,jsonb) from public;
grant execute on function public.cook_recipe(uuid,numeric,jsonb) to authenticated;
