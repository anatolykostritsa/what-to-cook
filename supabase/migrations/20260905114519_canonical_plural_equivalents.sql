-- Conservative singular/plural equivalence groups. Intentionally excludes ambiguous pairs such as clove/cloves.
update public.ingredients_catalog set match_group='carrot', family_key=coalesce(family_key,'carrot') where normalized_name in ('carrot','carrots');
update public.ingredients_catalog set match_group='chicken breast', family_key='chicken' where normalized_name in ('chicken breast','chicken breasts');
update public.ingredients_catalog set match_group='lemon', family_key=coalesce(family_key,'lemon') where normalized_name in ('lemon','lemons');

update public.products p set ingredient_match_group=coalesce(c.match_group,c.normalized_name),ingredient_family_key=c.family_key from public.ingredients_catalog c where p.ingredient_id=c.id;
update public.shopping_items s set ingredient_match_group=coalesce(c.match_group,c.normalized_name),ingredient_family_key=c.family_key from public.ingredients_catalog c where s.ingredient_id=c.id;
update public.recipe_ingredients ri set ingredient_match_group=coalesce(c.match_group,c.normalized_name),ingredient_family_key=c.family_key from public.ingredients_catalog c where ri.ingredient_id=c.id;
