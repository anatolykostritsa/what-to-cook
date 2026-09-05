-- A single household-safe entry point for recipe/plan generated shopping items.
-- It prevents repeated clicks and concurrent users from creating equivalent rows.
create or replace function public.add_or_merge_shopping_items(
  p_household_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_name text;
  v_unit text;
  v_quantity numeric;
  v_existing_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = v_user_id)
    then raise exception 'Access denied'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Invalid items'; end if;

  -- Serialize automatic list generation per household to close the select/insert race.
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0));

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_name := trim(v_item->>'name');
    if v_name = '' then continue; end if;
    v_unit := case trim(coalesce(v_item->>'unit', ''))
      when 'кг' then 'г' when 'л' then 'мл' when 'шт.' then 'шт' else nullif(trim(v_item->>'unit'), '') end;
    v_quantity := case when v_item->>'quantity' is null then null else (v_item->>'quantity')::numeric end;
    if v_quantity is not null then
      v_quantity := v_quantity * case trim(coalesce(v_item->>'unit', '')) when 'кг' then 1000 when 'л' then 1000 else 1 end;
      if v_quantity <= 0 then continue; end if;
    end if;

    select id into v_existing_id from public.shopping_items
    where household_id = p_household_id and not done
      and replace(lower(trim(name)), 'ё', 'е') = replace(lower(v_name), 'ё', 'е')
      and coalesce(unit, '') = coalesce(v_unit, '')
    order by created_at limit 1 for update;

    if found then
      update public.shopping_items
      set quantity = case
        when quantity is null then v_quantity
        when v_quantity is null then quantity
        else quantity + v_quantity end
      where id = v_existing_id;
    else
      insert into public.shopping_items (household_id, name, quantity, unit, done, added_from_recipe, created_by)
      values (p_household_id, v_name, v_quantity, v_unit, false, nullif(v_item->>'recipe_id', '')::uuid, v_user_id);
    end if;
  end loop;
end;
$$;
revoke all on function public.add_or_merge_shopping_items(uuid, jsonb) from public;
grant execute on function public.add_or_merge_shopping_items(uuid, jsonb) to authenticated;
