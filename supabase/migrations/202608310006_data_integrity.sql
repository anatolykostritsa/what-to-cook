-- Non-destructive integrity guards: NOT VALID preserves any legacy rows while
-- preventing new invalid quantities. Existing RLS policies remain unchanged.
alter table public.products drop constraint if exists products_quantity_nonnegative;
alter table public.products add constraint products_quantity_nonnegative check (quantity is null or quantity >= 0) not valid;
alter table public.shopping_items drop constraint if exists shopping_quantity_positive;
alter table public.shopping_items add constraint shopping_quantity_positive check (quantity is null or quantity > 0) not valid;
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_quantity_positive;
alter table public.recipe_ingredients add constraint recipe_ingredients_quantity_positive check (quantity is null or quantity > 0) not valid;
alter table public.meal_plan drop constraint if exists meal_plan_servings_positive;
alter table public.meal_plan add constraint meal_plan_servings_positive check (servings is null or servings > 0) not valid;

create unique index if not exists meal_plan_household_slot_unique
  on public.meal_plan(household_id, planned_date, meal_type);
create index if not exists products_household_expiry_idx on public.products(household_id, expiry_date);
create index if not exists shopping_items_household_done_idx on public.shopping_items(household_id, done);
create index if not exists recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id);
