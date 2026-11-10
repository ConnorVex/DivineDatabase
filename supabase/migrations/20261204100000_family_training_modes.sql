-- Family custom traits on training logs: four kinds of effect.
--
-- A custom trait's training effect is now one of % increase, % decrease, a flat addition or
-- subtraction, or a flat multiplier/divider. The first three still save as percent / flat; the last
-- saves details.customTrait.training = { mode: 'multiply', factor, divide }. Older perks are unchanged.
--
-- The points are worked out as: base, then every percent, then every multiplier, then every flat.

-- Perk details as saved: the training effect keeps its kind and multiplier now.
create or replace function public.family_perk_details(p_kind text, p_details jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select case
		when jsonb_typeof(p_details) <> 'object' then '{}'::jsonb
		when p_kind = 'locked_power' and jsonb_typeof(p_details->'ability') = 'object'
			then jsonb_build_object('ability', p_details->'ability')
		when p_kind = 'starting_stats' and jsonb_typeof(p_details->'stats') = 'object'
			then jsonb_build_object('stats', jsonb_build_object(
				'strength', left(coalesce(p_details->'stats'->>'strength', ''), 60),
				'speed', left(coalesce(p_details->'stats'->>'speed', ''), 60),
				'defense', left(coalesce(p_details->'stats'->>'defense', ''), 60),
				'stamina', left(coalesce(p_details->'stats'->>'stamina', ''), 60),
				'intelligence', left(coalesce(p_details->'stats'->>'intelligence', ''), 60),
				'extraPtp', case when jsonb_typeof(p_details->'stats'->'extraPtp') = 'number'
					then greatest(0, least(1000, (p_details->'stats'->>'extraPtp')::numeric::int)) else 0 end))
		when p_kind = 'trait' and jsonb_typeof(p_details->'trait') = 'string' and char_length(btrim(p_details->>'trait')) between 1 and 100
			then jsonb_build_object('trait', btrim(p_details->>'trait'))
				|| case
					when jsonb_typeof(p_details->'customTrait') = 'object'
						and p_details->'customTrait'->>'category' in ('physical', 'skill', 'phenomena')
						and p_details->'customTrait'->>'effect' in ('buff', 'debuff', 'neutral')
					then jsonb_build_object('customTrait', jsonb_build_object(
						'category', p_details->'customTrait'->>'category',
						'effect', p_details->'customTrait'->>'effect')
						-- How the trait changes the Physical Points from a member's training log.
						|| case when jsonb_typeof(p_details->'customTrait'->'training') = 'object'
							then jsonb_build_object('training', jsonb_build_object(
								'percent', case when jsonb_typeof(p_details->'customTrait'->'training'->'percent') = 'number'
									then greatest(-100, least(500, (p_details->'customTrait'->'training'->>'percent')::numeric::int)) else 0 end,
								'flat', case when jsonb_typeof(p_details->'customTrait'->'training'->'flat') = 'number'
									then greatest(-100, least(100, (p_details->'customTrait'->'training'->>'flat')::numeric::int)) else 0 end)
								-- Which of the four kinds it is, and a multiplier/divider's amount.
								|| case when p_details->'customTrait'->'training'->>'mode' in ('increase', 'decrease', 'flat', 'multiply')
									then jsonb_build_object('mode', p_details->'customTrait'->'training'->>'mode') else '{}'::jsonb end
								|| case when jsonb_typeof(p_details->'customTrait'->'training'->'factor') = 'number'
									then jsonb_build_object(
										'factor', round(greatest(1, least(10, (p_details->'customTrait'->'training'->>'factor')::numeric)), 2),
										'divide', coalesce(p_details->'customTrait'->'training'->>'divide', 'false') = 'true')
									else '{}'::jsonb end)
							else '{}'::jsonb end)
					else '{}'::jsonb
				end
		when p_kind = 'trait_slots' and jsonb_typeof(p_details->'traitRules') = 'object'
			then jsonb_build_object('traitRules', p_details->'traitRules')
		when p_kind = 'system_start' and jsonb_typeof(p_details->'systemRules') = 'object'
			then jsonb_build_object('systemRules', p_details->'systemRules')
		when p_kind = 'fighting_style' and jsonb_typeof(p_details->'style') = 'object'
			then jsonb_build_object('style', p_details->'style')
		when p_kind = 'technique' and jsonb_typeof(p_details->'tracker') = 'object'
			then jsonb_build_object('tracker', p_details->'tracker')
		when p_kind = 'item' and jsonb_typeof(p_details->'items') = 'array'
			then jsonb_build_object('items', p_details->'items')
		else '{}'::jsonb
	end;
$$;

-- Every trait that changes this character's training points: [{ trait, percent, flat, factor, family }].
-- factor is what the points are multiplied by (0.5 for "divide by 2"; 1 when it doesn't multiply).
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
			case
				when coalesce((p.details #>> '{customTrait,training,factor}')::numeric, 0) <= 0 then 1::numeric
				when (p.details #>> '{customTrait,training,divide}') = 'true' then round(1 / (p.details #>> '{customTrait,training,factor}')::numeric, 4)
				else (p.details #>> '{customTrait,training,factor}')::numeric
			end as factor,
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
		select tr.trait, tr.percent, tr.flat, 1::numeric as factor, '' as family
		from public.training_trait_rules tr
		where lower(tr.trait) in (select name from sheet)
			and lower(tr.trait) not in (select lower(trait) from family)
	)
	select coalesce(jsonb_agg(jsonb_build_object('trait', e.trait, 'percent', e.percent, 'flat', e.flat, 'factor', e.factor, 'family', e.family) order by lower(e.trait)), '[]')
	from (select * from family where percent <> 0 or flat <> 0 or factor <> 1 union all select * from staff) e;
$$;

create or replace function public.training_adjust(p_character uuid, p_base int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	base int := coalesce(p_base, 0);
	adjustments jsonb := '[]';
	total_percent int := 0;
	total_factor numeric := 1;
	total_flat int := 0;
	e jsonb;
	f numeric;
	final int;
begin
	for e in select * from jsonb_array_elements(public.training_trait_effects(p_character)) loop
		f := coalesce((e ->> 'factor')::numeric, 1);
		total_percent := total_percent + (e ->> 'percent')::int;
		total_factor := total_factor * f;
		total_flat := total_flat + (e ->> 'flat')::int;
		adjustments := adjustments || jsonb_build_object(
			'trait', e ->> 'trait',
			'percent', (e ->> 'percent')::int,
			'flat', (e ->> 'flat')::int,
			'factor', f,
			'family', e ->> 'family',
			'change', round(base * (e ->> 'percent')::int / 100.0 + base * (f - 1))::int + (e ->> 'flat')::int
		);
	end loop;

	final := greatest(0, round(base * (100 + total_percent) / 100.0 * total_factor)::int + total_flat);
	return jsonb_build_object('base', p_base, 'adjustments', adjustments, 'final', final);
end;
$$;

revoke execute on function public.training_trait_effects(uuid) from public, anon, authenticated;
grant execute on function public.training_trait_effects(uuid) to service_role;
revoke execute on function public.training_adjust(uuid, int) from public, anon, authenticated;
grant execute on function public.training_adjust(uuid, int) to service_role;
