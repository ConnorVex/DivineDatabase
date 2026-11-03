-- Custom family traits: a Family trait perk can give a trait the family made itself instead of
-- one from the trait list. details then also holds its type and effect:
--   { "trait": "<name>", "customTrait": { "category": "physical|skill|phenomena", "effect": "buff|debuff|neutral" } }
-- What the trait does is the perk's description.
--
-- Run once in the SQL Editor after 20261105100000_family_perk_details.sql.

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
