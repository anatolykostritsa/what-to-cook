drop index if exists public.recipes_source_external_unique;

create unique index recipes_source_external_unique
on public.recipes (source_name, external_id);
