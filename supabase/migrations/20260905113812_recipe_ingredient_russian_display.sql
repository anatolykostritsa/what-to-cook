alter table public.recipe_ingredients add column if not exists name_ru text;

create or replace function public.sync_recipe_ingredient_russian_display()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.ingredient_id is null then
    new.name_ru:=null;
  else
    select c.display_name_ru into new.name_ru from public.ingredients_catalog c where c.id=new.ingredient_id;
  end if;
  return new;
end; $$;

drop trigger if exists recipe_ingredients_sync_russian_display on public.recipe_ingredients;
create trigger recipe_ingredients_sync_russian_display before insert or update of ingredient_id on public.recipe_ingredients for each row execute function public.sync_recipe_ingredient_russian_display();

update public.recipe_ingredients ri set name_ru=c.display_name_ru from public.ingredients_catalog c where ri.ingredient_id=c.id;
