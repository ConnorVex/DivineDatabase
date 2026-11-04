-- Pinned review notes: a reviewer pins a short note to one part of a character's form (a step,
-- a stat or a power system card). The player sees it as a red box right there, so they don't have
-- to hunt for what to fix. Notes stay until a reviewer removes them, and clear when the
-- character is approved.
--
--   pinned_notes: [ { "id", "step", "target", "text", "by", "at" } ]
--     step: basics, appearance, lore, stats, traits, combat, systems, storage, families
--     target: optional; a stat key (strength, phase, …) or card:<card key>
--
-- Run once in the SQL Editor after 20261117100000_staff_overrides.sql.

alter table public.characters
	add column if not exists pinned_notes jsonb not null default '[]'::jsonb;

-- Players can't write their own notes; only set_pinned_notes (below) can.
create or replace function public.guard_character_pinned_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin() then
			new.pinned_notes := '[]'::jsonb;
		end if;
		return new;
	end if;
	if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin()
		and coalesce(current_setting('portal.pin_notes', true), '') <> 'on' then
		new.pinned_notes := old.pinned_notes;
	end if;
	-- An approved character has nothing left to fix.
	if new.status = 'approved' and old.status is distinct from 'approved' then
		new.pinned_notes := '[]'::jsonb;
	end if;
	return new;
end;
$$;

drop trigger if exists characters_pinned_notes_guard on public.characters;
create trigger characters_pinned_notes_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_pinned_notes();

-- Admins, or the owner of a family the character picked while it waits for review.
create or replace function public.set_pinned_notes(p_character uuid, p_notes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
begin
	if jsonb_typeof(p_notes) is distinct from 'array' or jsonb_array_length(p_notes) > 50 or char_length(p_notes::text) > 20000 then
		raise exception 'Pinned notes must be a list of at most 50 short notes.';
	end if;
	select * into c from public.characters where id = p_character;
	if c.id is null then
		raise exception 'Character not found.';
	end if;
	if not public.is_admin() then
		if c.status not in ('pending', 'needs_correction') or not public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at) then
			raise exception 'Only admins, or the owner of a family this character picked, can pin notes on it.' using errcode = '42501';
		end if;
		perform set_config('portal.family_review', 'on', true);
	end if;
	perform set_config('portal.pin_notes', 'on', true);
	update public.characters set pinned_notes = p_notes where id = p_character;
	perform set_config('portal.pin_notes', '', true);
	perform set_config('portal.family_review', '', true);
end;
$$;

revoke all on function public.set_pinned_notes(uuid, jsonb) from public, anon;
grant execute on function public.set_pinned_notes(uuid, jsonb) to authenticated;
