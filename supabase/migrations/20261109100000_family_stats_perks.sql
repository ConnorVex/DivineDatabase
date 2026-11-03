-- Starting stats perks are built like a character's stats: details.stats holds a rank or custom
-- value per stat (blank = as normal) and extra PTP:
--   { "stats": { "strength": "15F", "speed": "", "defense": "", "stamina": "", "intelligence": "Genius", "extraPtp": 12 } }
-- Family abilities may also give only some parts of a card (details.ability.parts), which is
-- kept as part of the ability object.
--
-- Run once in the SQL Editor after 20261108100000_admin_family_perks.sql.

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
						'effect', p_details->'customTrait'->>'effect'))
					else '{}'::jsonb
				end
		else '{}'::jsonb
	end;
$$;
