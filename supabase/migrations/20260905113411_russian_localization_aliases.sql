-- Russian localization and canonical ingredient alias/equivalence layer.
alter table public.recipes add column if not exists name_ru text;
alter table public.recipes add column if not exists description_ru text;
alter table public.recipes add column if not exists instructions_ru text;

alter table public.ingredients_catalog add column if not exists display_name_ru text;
alter table public.ingredients_catalog add column if not exists match_group text;
alter table public.ingredients_catalog add column if not exists family_key text;
update public.ingredients_catalog set match_group=normalized_name where match_group is null;

alter table public.products add column if not exists ingredient_match_group text;
alter table public.products add column if not exists ingredient_family_key text;
alter table public.recipe_ingredients add column if not exists ingredient_match_group text;
alter table public.recipe_ingredients add column if not exists ingredient_family_key text;

create table if not exists public.ingredient_aliases (
  ingredient_id uuid not null references public.ingredients_catalog(id) on delete cascade,
  locale text not null default 'ru',
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  primary key(locale, normalized_alias)
);
create index if not exists ingredient_aliases_ingredient_idx on public.ingredient_aliases(ingredient_id);
alter table public.ingredient_aliases enable row level security;
drop policy if exists "authenticated read ingredient aliases" on public.ingredient_aliases;
create policy "authenticated read ingredient aliases" on public.ingredient_aliases for select to authenticated using (true);

create table if not exists public.ingredient_relations (
  source_ingredient_id uuid not null references public.ingredients_catalog(id) on delete cascade,
  target_ingredient_id uuid not null references public.ingredients_catalog(id) on delete cascade,
  relation_type text not null check (relation_type in ('compatible','broader','narrower')),
  created_at timestamptz not null default now(),
  primary key(source_ingredient_id,target_ingredient_id,relation_type),
  check (source_ingredient_id <> target_ingredient_id)
);
alter table public.ingredient_relations enable row level security;
drop policy if exists "authenticated read ingredient relations" on public.ingredient_relations;
create policy "authenticated read ingredient relations" on public.ingredient_relations for select to authenticated using (true);

create or replace function public.normalize_ingredient_text(p_value text)
returns text language sql immutable set search_path=public as $$
  select trim(regexp_replace(replace(lower(coalesce(p_value,'')),'ё','е'),'\s+',' ','g'))
$$;

update public.ingredients_catalog set match_group='egg', family_key='egg' where normalized_name in ('egg','eggs');
update public.ingredients_catalog set match_group='onion', family_key='onion' where normalized_name in ('onion','onions');
update public.ingredients_catalog set match_group='tomato', family_key='tomato' where normalized_name in ('tomato','tomatoes');
update public.ingredients_catalog set match_group='bay leaf', family_key='bay leaf' where normalized_name in ('bay leaf','bay leaves');
update public.ingredients_catalog set match_group='spring onion', family_key='onion' where normalized_name in ('spring onions','scallions');
update public.ingredients_catalog set match_group='coriander', family_key='herb' where normalized_name in ('coriander','cilantro');
update public.ingredients_catalog set match_group='plain flour', family_key='flour' where normalized_name in ('flour','plain flour','all purpose flour');
update public.ingredients_catalog set match_group='garlic', family_key='garlic' where normalized_name in ('garlic','garlic clove');
update public.ingredients_catalog set match_group='cumin', family_key='spice' where normalized_name in ('cumin','ground cumin');
update public.ingredients_catalog set match_group='cinnamon', family_key='spice' where normalized_name in ('cinnamon','ground cinnamon');
update public.ingredients_catalog set match_group='butter', family_key='butter' where normalized_name in ('butter','melted butter');

update public.ingredients_catalog set family_key='chicken' where normalized_name like 'chicken%' or normalized_name in ('whole chicken');
update public.ingredients_catalog set family_key='beef' where normalized_name like '%beef%';
update public.ingredients_catalog set family_key='pork' where normalized_name like '%pork%';
update public.ingredients_catalog set family_key='lamb' where normalized_name like '%lamb%';
update public.ingredients_catalog set family_key='tomato' where normalized_name like '%tomato%';
update public.ingredients_catalog set family_key='cheese' where normalized_name in ('parmesan','mozzarella','cheddar cheese','cheese','feta cheese','ricotta');
update public.ingredients_catalog set family_key='onion' where normalized_name like '%onion%' or normalized_name in ('shallots');

with names(en,ru) as (values
('salt','Соль'),('garlic','Чеснок'),('garlic clove','Чеснок'),('onion','Лук'),('onions','Лук'),
('butter','Сливочное масло'),('melted butter','Сливочное масло'),('olive oil','Оливковое масло'),('sugar','Сахар'),('water','Вода'),
('milk','Молоко'),('egg','Яйцо'),('eggs','Яйца'),('vegetable oil','Растительное масло'),('parsley','Петрушка'),
('pepper','Перец'),('black pepper','Чёрный перец'),('flour','Мука'),('plain flour','Мука'),('all purpose flour','Мука'),
('potatoes','Картофель'),('carrots','Морковь'),('soy sauce','Соевый соус'),('coriander','Кориандр'),('cilantro','Кинза'),
('spring onions','Зелёный лук'),('scallions','Зелёный лук'),('baking powder','Разрыхлитель'),('lime','Лайм'),('caster sugar','Мелкий сахар'),
('lemon','Лимон'),('paprika','Паприка'),('red pepper','Красный перец'),('ginger','Имбирь'),('thyme','Тимьян'),
('chicken stock','Куриный бульон'),('red chilli','Красный чили'),('tomato puree','Томатное пюре'),('vanilla extract','Ванильный экстракт'),
('brown sugar','Коричневый сахар'),('oil','Масло'),('cinnamon','Корица'),('ground cinnamon','Корица'),('tomato','Помидор'),('tomatoes','Помидоры'),
('bay leaf','Лавровый лист'),('bay leaves','Лавровый лист'),('coconut milk','Кокосовое молоко'),('cornstarch','Кукурузный крахмал'),
('red onions','Красный лук'),('mint','Мята'),('cumin','Кумин'),('ground cumin','Кумин'),('lemon juice','Лимонный сок'),('fish sauce','Рыбный соус'),
('unsalted butter','Несолёное сливочное масло'),('rice','Рис'),('beef','Говядина'),('double cream','Жирные сливки'),('egg yolks','Яичные желтки'),
('bacon','Бекон'),('beef stock','Говяжий бульон'),('sunflower oil','Подсолнечное масло'),('celery','Сельдерей'),('icing sugar','Сахарная пудра'),
('almonds','Миндаль'),('shallots','Шалот'),('vegetable stock','Овощной бульон'),('allspice','Душистый перец'),('bread','Хлеб'),('cucumber','Огурец'),
('yeast','Дрожжи'),('breadcrumbs','Панировочные сухари'),('chicken thighs','Куриные бёдра'),('chorizo','Чоризо'),('honey','Мёд'),('nutmeg','Мускатный орех'),
('sesame seed oil','Кунжутное масло'),('extra virgin olive oil','Оливковое масло extra virgin'),('greek yogurt','Греческий йогурт'),('mushrooms','Грибы'),
('cardamom','Кардамон'),('chicken','Курица'),('green chilli','Зелёный чили'),('self raising flour','Самоподнимающаяся мука'),('sour cream','Сметана'),
('cabbage','Капуста'),('cayenne pepper','Кайенский перец'),('green pepper','Зелёный перец'),('leek','Лук-порей'),('mayonnaise','Майонез'),('mustard','Горчица'),
('orange','Апельсин'),('basil','Базилик'),('dill','Укроп'),('heavy cream','Жирные сливки'),('raisins','Изюм'),('cherry tomatoes','Помидоры черри'),
('chicken breast','Куриное филе'),('cinnamon stick','Палочка корицы'),('ground beef','Говяжий фарш'),('rosemary','Розмарин'),('turmeric','Куркума'),
('white wine','Белое вино'),('corn flour','Кукурузная мука'),('kosher salt','Кошерная соль'),('parmesan','Пармезан'),('chickpeas','Нут'),('chives','Шнитт-лук'),
('cloves','Гвоздика'),('egg white','Яичный белок'),('ground ginger','Молотый имбирь'),('lamb','Баранина'),('mozzarella','Моцарелла'),('pork','Свинина'),
('prawns','Креветки'),('red wine vinegar','Красный винный уксус'),('rice noodles','Рисовая лапша'),('tinned tomatos','Консервированные помидоры')
)
update public.ingredients_catalog c set display_name_ru=n.ru from names n where c.normalized_name=n.en;

with alias_seed(en,alias) as (values
('egg','яйцо'),('egg','яйца'),('egg','яиц'),('egg','яйцо куриное'),
('onion','лук'),('onion','луковица'),('onion','репчатый лук'),
('potatoes','картофель'),('potatoes','картошка'),('potatoes','картофеля'),
('carrots','морковь'),('carrots','морковка'),('tomato','помидор'),('tomato','помидоры'),('tomato','томат'),('tomato','томаты'),
('garlic','чеснок'),('garlic','зубчик чеснока'),('milk','молоко'),('butter','сливочное масло'),('butter','масло сливочное'),
('vegetable oil','растительное масло'),('sunflower oil','подсолнечное масло'),('olive oil','оливковое масло'),
('flour','мука'),('flour','пшеничная мука'),('sugar','сахар'),('salt','соль'),('water','вода'),('rice','рис'),
('chicken','курица'),('chicken','куриное мясо'),('chicken breast','куриное филе'),('chicken breast','филе курицы'),('chicken breast','куриная грудка'),
('chicken thighs','куриные бедра'),('chicken thighs','куриные бёдра'),('beef','говядина'),('ground beef','говяжий фарш'),('pork','свинина'),('lamb','баранина'),
('black pepper','черный перец'),('black pepper','чёрный перец'),('pepper','перец'),('paprika','паприка'),('cumin','кумин'),('cumin','зира'),
('coriander','кориандр'),('cilantro','кинза'),('parsley','петрушка'),('dill','укроп'),('basil','базилик'),('thyme','тимьян'),('rosemary','розмарин'),
('mushrooms','грибы'),('mushrooms','гриб'),('cucumber','огурец'),('cucumber','огурцы'),('cabbage','капуста'),('leek','лук порей'),('spring onions','зеленый лук'),('spring onions','зелёный лук'),
('lemon','лимон'),('lime','лайм'),('orange','апельсин'),('coconut milk','кокосовое молоко'),('soy sauce','соевый соус'),('fish sauce','рыбный соус'),
('sour cream','сметана'),('greek yogurt','греческий йогурт'),('parmesan','пармезан'),('mozzarella','моцарелла'),('bread','хлеб'),('breadcrumbs','панировочные сухари'),
('chickpeas','нут'),('almonds','миндаль'),('raisins','изюм'),('honey','мед'),('honey','мёд'),('mustard','горчица'),('mayonnaise','майонез')
), resolved as (
 select c.id, a.alias, public.normalize_ingredient_text(a.alias) normalized_alias
 from alias_seed a join public.ingredients_catalog c on c.normalized_name=a.en
), dedup as (
 select distinct on (normalized_alias) id,alias,normalized_alias from resolved order by normalized_alias,id
)
insert into public.ingredient_aliases(ingredient_id,locale,alias,normalized_alias)
select id,'ru',alias,normalized_alias from dedup
on conflict(locale,normalized_alias) do update set ingredient_id=excluded.ingredient_id,alias=excluded.alias;

with pairs(a,b) as (values
('chicken','chicken breast'),('chicken','chicken thighs'),
('tomato','cherry tomatoes'),('tomato','tinned tomatos'),
('onion','red onions'),('onion','shallots'),
('butter','unsalted butter'),('olive oil','extra virgin olive oil')
)
insert into public.ingredient_relations(source_ingredient_id,target_ingredient_id,relation_type)
select ca.id,cb.id,'compatible' from pairs p join public.ingredients_catalog ca on ca.normalized_name=p.a join public.ingredients_catalog cb on cb.normalized_name=p.b
on conflict do nothing;

create or replace function public.resolve_ingredient_name(p_query text)
returns uuid language sql stable set search_path=public as $$
  with q as (select public.normalize_ingredient_text(p_query) v), candidates as (
    select c.id,
      case
        when a.normalized_alias=(select v from q) then 0
        when public.normalize_ingredient_text(c.display_name_ru)=(select v from q) then 1
        when c.normalized_name=(select v from q) then 2
        else 9
      end rank
    from public.ingredients_catalog c
    left join public.ingredient_aliases a on a.ingredient_id=c.id and a.locale='ru'
    where a.normalized_alias=(select v from q)
       or public.normalize_ingredient_text(c.display_name_ru)=(select v from q)
       or c.normalized_name=(select v from q)
  )
  select id from candidates order by rank,id limit 1
$$;
revoke all on function public.resolve_ingredient_name(text) from public;
grant execute on function public.resolve_ingredient_name(text) to authenticated;

create or replace function public.suggest_ingredients(p_household_id uuid,p_query text,p_limit integer default 8)
returns table(id uuid,canonical_name text,default_unit text,category text)
language sql stable set search_path=public as $$
  with q as (select public.normalize_ingredient_text(p_query) v), ranked as (
    select c.id,coalesce(c.display_name_ru,c.canonical_name) label,c.default_unit,c.category,
      min(case
        when a.normalized_alias=(select v from q) then 0
        when public.normalize_ingredient_text(c.display_name_ru)=(select v from q) then 0
        when c.normalized_name=(select v from q) then 0
        when a.normalized_alias like (select v from q)||'%' then 1
        when public.normalize_ingredient_text(c.display_name_ru) like (select v from q)||'%' then 1
        when c.normalized_name like (select v from q)||'%' then 2
        else 3 end) rank,
      exists(select 1 from public.products p where p.household_id=p_household_id and p.ingredient_match_group=coalesce(c.match_group,c.normalized_name)) in_household
    from public.ingredients_catalog c
    left join public.ingredient_aliases a on a.ingredient_id=c.id and a.locale='ru'
    where c.normalized_name like '%'||(select v from q)||'%'
       or public.normalize_ingredient_text(c.display_name_ru) like '%'||(select v from q)||'%'
       or a.normalized_alias like '%'||(select v from q)||'%'
    group by c.id,c.display_name_ru,c.canonical_name,c.default_unit,c.category,c.match_group,c.normalized_name
  )
  select id,label,default_unit,category from ranked order by rank,in_household desc,label limit least(greatest(p_limit,1),20)
$$;
revoke all on function public.suggest_ingredients(uuid,text,integer) from public;
grant execute on function public.suggest_ingredients(uuid,text,integer) to authenticated;

create or replace function public.sync_ingredient_match_metadata()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.ingredient_id is null then
    new.ingredient_match_group:=null; new.ingredient_family_key:=null;
  else
    select coalesce(c.match_group,c.normalized_name),c.family_key into new.ingredient_match_group,new.ingredient_family_key
    from public.ingredients_catalog c where c.id=new.ingredient_id;
  end if;
  return new;
end; $$;

drop trigger if exists products_sync_ingredient_match_metadata on public.products;
create trigger products_sync_ingredient_match_metadata before insert or update of ingredient_id on public.products for each row execute function public.sync_ingredient_match_metadata();
drop trigger if exists recipe_ingredients_sync_ingredient_match_metadata on public.recipe_ingredients;
create trigger recipe_ingredients_sync_ingredient_match_metadata before insert or update of ingredient_id on public.recipe_ingredients for each row execute function public.sync_ingredient_match_metadata();

update public.products p set ingredient_match_group=coalesce(c.match_group,c.normalized_name),ingredient_family_key=c.family_key from public.ingredients_catalog c where p.ingredient_id=c.id;
update public.recipe_ingredients ri set ingredient_match_group=coalesce(c.match_group,c.normalized_name),ingredient_family_key=c.family_key from public.ingredients_catalog c where ri.ingredient_id=c.id;

create or replace function public.recipe_product_matches(p_ingredient_id uuid,p_product_id uuid)
returns boolean language sql stable set search_path=public as $$
  select case
    when ingredient.ingredient_id is not null and product.ingredient_id is not null
      then coalesce(ic.match_group,ic.normalized_name)=coalesce(pc.match_group,pc.normalized_name)
    when ingredient.ingredient_id is not null then
      coalesce((select coalesce(c2.match_group,c2.normalized_name) from public.ingredients_catalog c2 where c2.id=public.resolve_ingredient_name(product.name)),public.normalize_ingredient_text(product.name))
      = coalesce(ic.match_group,ic.normalized_name)
    when product.ingredient_id is not null then
      coalesce((select coalesce(c2.match_group,c2.normalized_name) from public.ingredients_catalog c2 where c2.id=public.resolve_ingredient_name(ingredient.name)),public.normalize_ingredient_text(ingredient.name))
      = coalesce(pc.match_group,pc.normalized_name)
    else public.normalize_ingredient_text(product.name)=public.normalize_ingredient_text(ingredient.name)
  end
  from public.recipe_ingredients ingredient
  join public.products product on product.id=p_product_id
  left join public.ingredients_catalog ic on ic.id=ingredient.ingredient_id
  left join public.ingredients_catalog pc on pc.id=product.ingredient_id
  where ingredient.id=p_ingredient_id
$$;
revoke all on function public.recipe_product_matches(uuid,uuid) from public;
grant execute on function public.recipe_product_matches(uuid,uuid) to authenticated;
