alter table public.meal_plan drop constraint if exists meal_plan_household_date_meal_unique;
alter table public.meal_plan add constraint meal_plan_household_date_meal_unique
unique (household_id, planned_date, meal_type);

do $$
begin
  alter publication supabase_realtime add table public.meal_plan;
exception when duplicate_object then null;
end $$;
