alter table public.shopping_items add column if not exists ingredient_match_group text;
alter table public.shopping_items add column if not exists ingredient_family_key text;

drop trigger if exists shopping_items_sync_ingredient_match_metadata on public.shopping_items;
create trigger shopping_items_sync_ingredient_match_metadata before insert or update of ingredient_id on public.shopping_items for each row execute function public.sync_ingredient_match_metadata();

update public.products p set ingredient_id=public.resolve_ingredient_name(p.name) where p.ingredient_id is null and public.resolve_ingredient_name(p.name) is not null;
update public.shopping_items s set ingredient_id=public.resolve_ingredient_name(s.name) where s.ingredient_id is null and public.resolve_ingredient_name(s.name) is not null;
update public.recipe_ingredients ri set ingredient_id=public.resolve_ingredient_name(ri.name) where ri.ingredient_id is null and public.resolve_ingredient_name(ri.name) is not null;

create or replace function public.add_or_merge_shopping_items(p_household_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user_id uuid := auth.uid(); v_item jsonb; v_name text; v_unit text; v_quantity numeric;
  v_existing_id uuid; v_ingredient_id uuid; v_match_group text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.household_members where household_id=p_household_id and user_id=v_user_id) then raise exception 'Access denied'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Invalid items'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_name:=trim(v_item->>'name'); if v_name='' then continue; end if;
    v_unit:=case trim(coalesce(v_item->>'unit','')) when 'кг' then 'г' when 'л' then 'мл' when 'шт.' then 'шт' else nullif(trim(v_item->>'unit'),'') end;
    v_quantity:=case when v_item->>'quantity' is null then null else (v_item->>'quantity')::numeric end;
    if v_quantity is not null then v_quantity:=v_quantity*case trim(coalesce(v_item->>'unit','')) when 'кг' then 1000 when 'л' then 1000 else 1 end; if v_quantity<=0 then continue; end if; end if;
    v_ingredient_id:=coalesce(nullif(v_item->>'ingredient_id','')::uuid,public.resolve_ingredient_name(v_name));
    select coalesce(c.match_group,c.normalized_name) into v_match_group from public.ingredients_catalog c where c.id=v_ingredient_id;
    select id into v_existing_id from public.shopping_items
    where household_id=p_household_id and not done
      and ((v_match_group is not null and ingredient_match_group=v_match_group) or (v_match_group is null and public.normalize_ingredient_text(name)=public.normalize_ingredient_text(v_name)))
      and coalesce(unit,'')=coalesce(v_unit,'')
    order by created_at limit 1 for update;
    if found then
      update public.shopping_items set quantity=case when quantity is null then v_quantity when v_quantity is null then quantity else quantity+v_quantity end,
        ingredient_id=coalesce(ingredient_id,v_ingredient_id) where id=v_existing_id;
    else
      insert into public.shopping_items(household_id,name,ingredient_id,quantity,unit,done,added_from_recipe,created_by)
      values(p_household_id,v_name,v_ingredient_id,v_quantity,v_unit,false,nullif(v_item->>'recipe_id','')::uuid,v_user_id);
    end if;
  end loop;
end; $$;
revoke all on function public.add_or_merge_shopping_items(uuid,jsonb) from public;
grant execute on function public.add_or_merge_shopping_items(uuid,jsonb) to authenticated;

create or replace function public.transfer_shopping_item_to_products(p_shopping_item_id uuid,p_quantity numeric,p_unit text,p_category text,p_expiry_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_user_id uuid:=auth.uid(); v_item public.shopping_items; v_product public.products;
  v_unit text:=nullif(trim(p_unit),''); v_product_id uuid; v_quantity numeric:=p_quantity; v_match_group text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_quantity is not null and v_quantity<=0 then raise exception 'Quantity must be positive'; end if;
  select * into v_item from public.shopping_items where id=p_shopping_item_id for update;
  if not found then raise exception 'Shopping item not found'; end if;
  if not exists(select 1 from public.household_members where household_id=v_item.household_id and user_id=v_user_id) then raise exception 'Access denied'; end if;
  if v_item.transferred_at is not null then raise exception 'Item already added to products'; end if;
  if v_item.ingredient_id is null then v_item.ingredient_id:=public.resolve_ingredient_name(v_item.name); end if;
  select coalesce(c.match_group,c.normalized_name) into v_match_group from public.ingredients_catalog c where c.id=v_item.ingredient_id;
  select * into v_product from public.products
  where household_id=v_item.household_id
    and ((v_match_group is not null and ingredient_match_group=v_match_group) or (v_match_group is null and public.normalize_ingredient_text(name)=public.normalize_ingredient_text(v_item.name)))
    and (case when unit='кг' then 'г' when unit='л' then 'мл' when unit='шт.' then 'шт' else coalesce(unit,'') end)
      =(case when v_unit='кг' then 'г' when v_unit='л' then 'мл' when v_unit='шт.' then 'шт' else coalesce(v_unit,'') end)
  order by expiry_date nulls last limit 1 for update;
  if found and v_product.quantity is not null and v_quantity is not null then
    update public.products set quantity=quantity+v_quantity*case when v_unit in ('кг','л') then 1000 else 1 end/case when v_product.unit in ('кг','л') then 1000 else 1 end,
      ingredient_id=coalesce(ingredient_id,v_item.ingredient_id),category=coalesce(nullif(trim(p_category),''),category),expiry_date=coalesce(p_expiry_date,expiry_date)
      where id=v_product.id returning id into v_product_id;
  else
    insert into public.products(household_id,name,ingredient_id,quantity,unit,category,expiry_date,created_by)
    values(v_item.household_id,v_item.name,v_item.ingredient_id,v_quantity,v_unit,nullif(trim(p_category),''),p_expiry_date,v_user_id)
    returning id into v_product_id;
  end if;
  update public.shopping_items set ingredient_id=coalesce(ingredient_id,v_item.ingredient_id),done=true,transferred_at=now(),quantity=coalesce(p_quantity,quantity),unit=coalesce(v_unit,unit),category=coalesce(nullif(trim(p_category),''),category) where id=v_item.id;
  return v_product_id;
end; $$;
revoke all on function public.transfer_shopping_item_to_products(uuid,numeric,text,text,date) from public;
grant execute on function public.transfer_shopping_item_to_products(uuid,numeric,text,text,date) to authenticated;
