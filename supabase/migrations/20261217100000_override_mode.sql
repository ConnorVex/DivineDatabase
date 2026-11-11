-- Override Mode (Final Tweaks 2).
--
--   An admin opens any character (draft, in review or approved) in Override Mode: the full form,
--   unlocked like an admin character. The usual checks still run, and each one can be ignored.
--
--   * characters.ignored_checks: the checks staff ignored for this character. They stay ignored,
--     for the player's later edits too, until an admin un-ignores them. Only admins change it.
--   * override_character: saves an override. A character that isn't approved keeps its status
--     (the player sends it as usual). An approved character goes live at once: no review, no ping,
--     no evolution log, and a "Staff override" note in its review history. A Potential or Cursed
--     Energy level staff changed is set as an admin roll, so it sticks.
--
-- Run once in the SQL Editor after 20261216100000_family_powers.sql.

alter table public.characters
	add column if not exists ignored_checks text[] not null default '{}';

-- Only admins (or the service role) change it.
create or replace function public.guard_character_ignored()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin() then
		return new;
	end if;
	if tg_op = 'INSERT' then
		new.ignored_checks := '{}';
	else
		new.ignored_checks := old.ignored_checks;
	end if;
	return new;
end;
$$;

drop trigger if exists characters_ignored_guard on public.characters;
create trigger characters_ignored_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_ignored();

revoke execute on function public.guard_character_ignored() from public, anon, authenticated;

create or replace function public.override_character(
	p_character uuid,
	p_name text,
	p_sheet jsonb,
	p_approved_sheet jsonb,
	p_claims text[],
	p_ignored text[],
	p_summary text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	c public.characters;
	who text;
	grade text;
	ce text;
	cur text;
begin
	perform public.require_admin();
	perform public.ensure_profile();
	select * into c from public.characters where id = p_character for update;
	if c.id is null then
		raise exception 'That character doesn''t exist.' using errcode = 'P0002';
	end if;
	if length(btrim(coalesce(p_name, ''))) = 0 then
		raise exception 'The character needs a name.' using errcode = '22023';
	end if;
	if coalesce(jsonb_typeof(p_sheet), '') <> 'object' or (c.approved_at is not null and coalesce(jsonb_typeof(p_approved_sheet), '') <> 'object') then
		raise exception 'The override needs the character''s sheet.' using errcode = '22023';
	end if;

	update public.characters
	set name = btrim(p_name),
		sheet = p_sheet,
		requested_claims = coalesce(p_claims, '{}'),
		ignored_checks = coalesce((select array_agg(distinct x) from unnest(p_ignored) x where length(x) between 1 and 2000), '{}'),
		approved_sheet = case when c.approved_at is not null then p_approved_sheet else approved_sheet end,
		approved_name = case when c.approved_at is not null then btrim(p_name) else approved_name end
	where id = c.id
	returning * into c;

	-- Potential and Cursed Energy come from rolls; a value staff changed becomes an admin roll.
	if not c.admin_character then
		grade := coalesce(case when c.approved_at is not null then p_approved_sheet else p_sheet end #>> '{potential,grade}', '');
		select result ->> 'grade' into cur from public.player_rolls
		where character_id = c.id and kind = 'potential' and status <> 'void' order by created_at desc limit 1;
		if grade <> '' and grade is distinct from cur
			and grade in ('limited', 'low', 'average', 'great', 'high', 'insane', 'immense', 'colossal', 'tremendous', 'peak', 'ultimate', 'apex', 'divine') then
			perform public.admin_set_roll(c.owner_id, 'potential', grade, c.id);
		end if;

		select e #>> '{fields,ceLevel}' into ce
		from jsonb_array_elements(case when jsonb_typeof((case when c.approved_at is not null then p_approved_sheet else p_sheet end) -> 'systems') = 'array'
			then (case when c.approved_at is not null then p_approved_sheet else p_sheet end) -> 'systems' else '[]' end) e
		where e ->> 'system' = 'jujutsu-kaisen' limit 1;
		select result ->> 'level' into cur from public.player_rolls
		where character_id = c.id and kind = 'cursed_energy' and status <> 'void' order by created_at desc limit 1;
		if coalesce(ce, '') <> '' and ce is distinct from cur
			and exists (select 1 from jsonb_each(public.ce_levels()) l, jsonb_array_elements(l.value) x (lvl) where lvl ->> 0 = ce) then
			perform public.admin_set_roll(c.owner_id, 'cursed_energy', ce, c.id);
		end if;

		update public.characters
		set sheet = public.apply_rolls(sheet, id, false),
			approved_sheet = case when approved_sheet is null then null else public.apply_rolls(approved_sheet, id, false) end
		where id = c.id
		returning * into c;
	end if;

	if c.approved_at is not null then
		perform public.grant_claims(c);
		select coalesce(nullif(display_name, ''), 'an admin') into who from public.profiles where id = auth.uid();
		insert into public.review_notes (character_id, author_id, outcome, body)
		values (c.id, auth.uid(), null, left('Staff override by ' || coalesce(who, 'an admin') || case when coalesce(btrim(p_summary), '') <> '' then ': ' || btrim(p_summary) else '.' end, 4000));
	end if;
end;
$$;

revoke execute on function public.override_character(uuid, text, jsonb, jsonb, text[], text[], text) from public, anon;
grant execute on function public.override_character(uuid, text, jsonb, jsonb, text[], text[], text) to authenticated;
