-- Staff overrides: admins set any stat or card field on a character that isn't approved yet (for
-- example a character coming in already progressed). Values staff set don't count against the
-- starting limits, and the player can't change them.
--
--   staff_overrides: { "<path>": { "from": old value, "to": new value, "by": "admin name", "at": iso time } }
--     paths: stats.strength, stats.phase, potential.grade, …, and card:<card key>.<field key>
--   progressed: the whole sheet skips the starting limits (like an evolution).
--
-- Run once in the SQL Editor after 20261116100000_heavenly_grants.sql.

alter table public.characters
	add column if not exists staff_overrides jsonb not null default '{}'::jsonb,
	add column if not exists progressed boolean not null default false;

create or replace function public.guard_character_staff_overrides()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	k text;
	card text;
	field text;
	idx int;
	kept jsonb;
begin
	-- SQL Editor / service code has no logged-in user role; admins are trusted too.
	if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin() then
		return new;
	end if;
	if tg_op = 'INSERT' then
		new.staff_overrides := '{}'::jsonb;
		new.progressed := false;
		return new;
	end if;
	new.staff_overrides := old.staff_overrides;
	new.progressed := old.progressed;
	-- Put back every value staff set.
	for k in select jsonb_object_keys(old.staff_overrides) loop
		if k like 'card:%' then
			card := split_part(substr(k, 6), '.', 1);
			field := split_part(substr(k, 6), '.', 2);
			select (e.ord - 1)::int into idx
			from jsonb_array_elements(coalesce(new.sheet -> 'systems', '[]'::jsonb)) with ordinality e(v, ord)
			where e.v ->> 'key' = card;
			select v -> 'fields' -> field into kept
			from jsonb_array_elements(coalesce(old.sheet -> 'systems', '[]'::jsonb)) v
			where v ->> 'key' = card;
			if idx is not null and kept is not null then
				new.sheet := jsonb_set(new.sheet, array['systems', idx::text, 'fields', field], kept, true);
			end if;
		else
			kept := old.sheet #> string_to_array(k, '.');
			if kept is not null then
				new.sheet := jsonb_set(new.sheet, string_to_array(k, '.'), kept, true);
			end if;
		end if;
	end loop;
	return new;
end;
$$;

drop trigger if exists characters_staff_overrides_guard on public.characters;
create trigger characters_staff_overrides_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_staff_overrides();
