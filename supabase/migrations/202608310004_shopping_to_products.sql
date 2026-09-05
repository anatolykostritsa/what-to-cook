alter table public.shopping_items
  add column if not exists category text,
  add column if not exists transferred_at timestamptz;

create or replace function public.transfer_shopping_item_to_products(
  p_shopping_item_id uuid,
  p_quantity numeric,
  p_unit text,
  p_category text,
  p_expiry_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid(); v_item public.shopping_items; v_product public.products;
  v_unit text := nullif(trim(p_unit), ''); v_product_id uuid; v_quantity numeric := p_quantity;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_quantity is not null and v_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_item from public.shopping_items where id = p_shopping_item_id for update;
  if not found then raise exception 'Shopping item not found'; end if;
  if not exists (select 1 from public.household_members where household_id = v_item.household_id and user_id = v_user_id) then raise exception 'Access denied'; end if;
  if v_item.transferred_at is not null then raise exception 'Item already added to products'; end if;

  select * into v_product from public.products
  where household_id = v_item.household_id
    and replace(lower(trim(name)), 'ё', 'е') = replace(lower(trim(v_item.name)), 'ё', 'е')
    and (case when unit = 'кг' then 'г' when unit = 'л' then 'мл' when unit = 'шт.' then 'шт' else coalesce(unit, '') end)
      = (case when v_unit = 'кг' then 'г' when v_unit = 'л' then 'мл' when v_unit = 'шт.' then 'шт' else coalesce(v_unit, '') end)
  order by expiry_date nulls last limit 1 for update;

  if found and v_product.quantity is not null and v_quantity is not null then
    update public.products set quantity = quantity + v_quantity
      * case when v_unit in ('кг','л') then 1000 else 1 end
      / case when v_product.unit in ('кг','л') then 1000 else 1 end,
      category = coalesce(nullif(trim(p_category), ''), category),
      expiry_date = coalesce(p_expiry_date, expiry_date)
    where id = v_product.id returning id into v_product_id;
  else
    insert into public.products (household_id, name, quantity, unit, category, expiry_date, created_by)
    values (v_item.household_id, v_item.name, v_quantity, v_unit, nullif(trim(p_category), ''), p_expiry_date, v_user_id)
    returning id into v_product_id;
  end if;

  update public.shopping_items set done = true, transferred_at = now(), quantity = coalesce(p_quantity, quantity), unit = coalesce(v_unit, unit), category = coalesce(nullif(trim(p_category), ''), category) where id = v_item.id;
  return v_product_id;
end;
$$;
revoke all on function public.transfer_shopping_item_to_products(uuid,numeric,text,text,date) from public;
grant execute on function public.transfer_shopping_item_to_products(uuid,numeric,text,text,date) to authenticated;
