-- Family custom traits on training logs.
--
-- A family's custom trait can change the Physical Points staff give on a training log, like the
-- staff's own trait rules (training_trait_rules): a percent of the base points and/or a flat amount.
-- It's saved on the perk as details.customTrait.training = { percent, flat } (see
-- family_perk_details) and only counts once the perk is approved.
--
-- It counts for the family's active members: always when the perk is Guaranteed (access
-- 'automatic'), otherwise when the member has the trait on their approved sheet. A family's
-- version of a trait wins over a staff rule with the same name, so it's never counted twice.

-- Every trait that changes this character's training points: [{ trait, percent, flat, family }].
-- family is the family's name, or '' for a staff rule.
create or replace function public.training_trait_effects(p_character uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	with sheet as (
		select distinct lower(btrim(t ->> 'name')) as name
		from public.characters c,
			jsonb_array_elements(case when jsonb_typeof(c.approved_sheet -> 'traits') = 'array' then c.approved_sheet -> 'traits' else '[]' end) t
		where c.id = p_character and jsonb_typeof(t -> 'name') = 'string'
	),
	family as (
		select distinct on (lower(btrim(p.details ->> 'trait')))
			btrim(p.details ->> 'trait') as trait,
			coalesce((p.details #>> '{customTrait,training,percent}')::numeric::int, 0) as percent,
			coalesce((p.details #>> '{customTrait,training,flat}')::numeric::int, 0) as flat,
			f.name as family
		from public.family_members m
		join public.families f on f.id = m.family_id and f.status = 'approved'
		join public.family_perks p on p.family_id = f.id and p.status = 'approved' and p.kind = 'trait'
		where m.character_id = p_character
			and m.status = 'active'
			and jsonb_typeof(p.details #> '{customTrait,training}') = 'object'
			and (p.access = 'automatic' or lower(btrim(p.details ->> 'trait')) in (select name from sheet))
		order by lower(btrim(p.details ->> 'trait')), p.created_at
	),
	staff as (
		select tr.trait, tr.percent, tr.flat, '' as family
		from public.training_trait_rules tr
		where lower(tr.trait) in (select name from sheet)
			and lower(tr.trait) not in (select lower(trait) from family)
	)
	select coalesce(jsonb_agg(jsonb_build_object('trait', e.trait, 'percent', e.percent, 'flat', e.flat, 'family', e.family) order by lower(e.trait)), '[]')
	from (select * from family where percent <> 0 or flat <> 0 union all select * from staff) e;
$$;

-- As before, but the traits come from training_trait_effects, so family traits count too.
create or replace function public.training_adjust(p_character uuid, p_base int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	adjustments jsonb := '[]';
	total_percent int := 0;
	total_flat int := 0;
	e jsonb;
	final int;
begin
	for e in select * from jsonb_array_elements(public.training_trait_effects(p_character)) loop
		total_percent := total_percent + (e ->> 'percent')::int;
		total_flat := total_flat + (e ->> 'flat')::int;
		adjustments := adjustments || jsonb_build_object(
			'trait', e ->> 'trait',
			'percent', (e ->> 'percent')::int,
			'flat', (e ->> 'flat')::int,
			'family', e ->> 'family',
			'change', round(coalesce(p_base, 0) * (e ->> 'percent')::int / 100.0)::int + (e ->> 'flat')::int
		);
	end loop;

	final := greatest(0, round(coalesce(p_base, 0) * (100 + total_percent) / 100.0)::int + total_flat);
	return jsonb_build_object('base', p_base, 'adjustments', adjustments, 'final', final);
end;
$$;

-- The bot only (it uses the service role), like the other training functions.
revoke execute on function public.training_trait_effects(uuid) from public, anon, authenticated;
grant execute on function public.training_trait_effects(uuid) to service_role;
revoke execute on function public.training_adjust(uuid, int) from public, anon, authenticated;
grant execute on function public.training_adjust(uuid, int) to service_role;
