-- Family traits don't count towards trait combinations: only the traits a player picked themself
-- (not one offered by their family, which the sheet marks "family": true) can make a Combo.
-- Family traits still count towards the trait limit, as before.
create or replace function public.discover_combos(p_character_id uuid)
returns table (name text, requires jsonb, perks text, system_limits jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	c public.characters;
	traits jsonb;
	picked text[];
begin
	select * into c from public.characters where id = p_character_id;
	if c.id is null or (
		c.owner_id is distinct from auth.uid()
		and not public.is_admin()
		and not (c.status in ('pending', 'needs_correction') and public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at))
	) then
		raise exception 'Character not found.' using errcode = '42501';
	end if;

	traits := case when jsonb_typeof(c.sheet -> 'traits') = 'array' then c.sheet -> 'traits' else '[]'::jsonb end;

	if jsonb_array_length(traits) > 4 + c.extra_trait_slots then
		return;
	end if;

	select coalesce(array_agg(t ->> 'name'), '{}') into picked
	from jsonb_array_elements(traits) t
	where coalesce(t ->> 'family', 'false') <> 'true';

	return query
	select k.name, k.requires, k.perks, k.system_limits
	from public.trait_combos k
	where not exists (
		select 1 from jsonb_array_elements(k.requires) need
		where not exists (
			select 1 from jsonb_array_elements_text(need) option where option = any (picked)
		)
	)
	order by k.name;
end;
$$;
