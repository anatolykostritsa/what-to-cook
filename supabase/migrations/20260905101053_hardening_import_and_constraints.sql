-- Final MVP hardening: atomically import/update a trusted system recipe and its ingredients.

create or replace function public.import_system_recipe(
  p_recipe jsonb,
  p_ingredients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
  v_recipe_id uuid;
  v_source_name text := nullif(trim(p_recipe ->> 'source_name'), '');
  v_external_id text := nullif(trim(p_recipe ->> 'external_id'), '');
  v_name text := nullif(trim(p_recipe ->> 'name'), '');
  v_item jsonb;
begin
  if v_role <> 'service_role' then
    raise exception 'service_role required';
  end if;

  if jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'Invalid recipe payload';
  end if;
  if jsonb_typeof(coalesce(p_ingredients, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid ingredients payload';
  end if;
  if v_source_name is null or v_external_id is null or v_name is null then
    raise exception 'System recipe requires name, source_name and external_id';
  end if;

  insert into public.recipes (
    recipe_type, household_id, created_by, name, normalized_name, description,
    instructions, prep_time_minutes, servings, difficulty, cuisine, category,
    image_url, source_name, source_url, external_id, canonical_group_id,
    is_primary_variant, updated_at
  ) values (
    'system', null, null, v_name, nullif(p_recipe ->> 'normalized_name', ''), nullif(p_recipe ->> 'description', ''),
    nullif(p_recipe ->> 'instructions', ''), nullif(p_recipe ->> 'prep_time_minutes', '')::integer,
    nullif(p_recipe ->> 'servings', '')::integer, nullif(p_recipe ->> 'difficulty', ''),
    nullif(p_recipe ->> 'cuisine', ''), nullif(p_recipe ->> 'category', ''),
    nullif(p_recipe ->> 'image_url', ''), v_source_name, nullif(p_recipe ->> 'source_url', ''),
    v_external_id, nullif(p_recipe ->> 'canonical_group_id', '')::uuid,
    coalesce((p_recipe ->> 'is_primary_variant')::boolean, true), now()
  )
  on conflict (source_name, external_id)
  do update set
    recipe_type = 'system',
    household_id = null,
    created_by = null,
    name = excluded.name,
    normalized_name = excluded.normalized_name,
    description = excluded.description,
    instructions = excluded.instructions,
    prep_time_minutes = excluded.prep_time_minutes,
    servings = excluded.servings,
    difficulty = excluded.difficulty,
    cuisine = excluded.cuisine,
    category = excluded.category,
    image_url = excluded.image_url,
    source_url = excluded.source_url,
    canonical_group_id = excluded.canonical_group_id,
    is_primary_variant = excluded.is_primary_variant,
    updated_at = now()
  returning id into v_recipe_id;

  delete from public.recipe_ingredients where recipe_id = v_recipe_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb))
  loop
    if nullif(trim(v_item ->> 'name'), '') is null then
      raise exception 'Ingredient name is required';
    end if;

    insert into public.recipe_ingredients (
      recipe_id, ingredient_id, name, display_name, quantity, unit, optional, sort_order
    ) values (
      v_recipe_id,
      nullif(v_item ->> 'ingredient_id', '')::uuid,
      trim(v_item ->> 'name'),
      coalesce(nullif(trim(v_item ->> 'display_name'), ''), trim(v_item ->> 'name')),
      nullif(v_item ->> 'quantity', '')::numeric,
      nullif(trim(v_item ->> 'unit'), ''),
      coalesce((v_item ->> 'optional')::boolean, false),
      coalesce((v_item ->> 'sort_order')::integer, 0)
    );
  end loop;

  if not exists (select 1 from public.recipe_ingredients where recipe_id = v_recipe_id) then
    raise exception 'System recipe requires at least one ingredient';
  end if;

  return v_recipe_id;
end;
$$;

revoke all on function public.import_system_recipe(jsonb,jsonb) from public;
revoke all on function public.import_system_recipe(jsonb,jsonb) from anon;
revoke all on function public.import_system_recipe(jsonb,jsonb) from authenticated;
grant execute on function public.import_system_recipe(jsonb,jsonb) to service_role;
