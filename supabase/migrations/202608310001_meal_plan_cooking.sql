-- Atomic completion of a planned meal. Matching products to ingredients stays in
-- the UI so users can review it; the database owns authorization and inventory integrity.
alter table public.meal_plan
  add column if not exists cooked_at timestamptz,
  add column if not exists cooked_by uuid references auth.users(id);

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
  v_deduction jsonb;
  v_product public.products;
  v_amount numeric;
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

  for v_deduction in select value from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_amount := (v_deduction->>'quantity')::numeric;
    if v_amount <= 0 then raise exception 'Deduction must be positive'; end if;

    select * into v_product
      from public.products
      where id = (v_deduction->>'product_id')::uuid
        and household_id = v_plan.household_id
      for update;
    if not found then raise exception 'Product not found'; end if;
    if v_product.quantity is null then raise exception 'Product quantity is unknown: %', v_product.name; end if;
    if v_product.quantity < v_amount then raise exception 'Not enough product: %', v_product.name; end if;

    update public.products set quantity = quantity - v_amount where id = v_product.id;
  end loop;

  update public.meal_plan
    set cooked_at = now(), cooked_by = v_user_id
    where id = v_plan.id
    returning * into v_plan;
  return v_plan;
end;
$$;

revoke all on function public.cook_meal_plan(uuid, jsonb) from public;
grant execute on function public.cook_meal_plan(uuid, jsonb) to authenticated;
