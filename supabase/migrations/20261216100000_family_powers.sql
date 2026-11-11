-- Custom powers granted to families (Final Tweaks 1).
--
--   * An admin grants a custom power to a family (family_power_grants).
--   * The family's owner hands it to member characters on the family Roster tab: the card goes
--     straight onto the character (sheet and approved sheet), like an admin's grant to a character.
--     It's a normal power grant (power_grants) tied to the family grant, so the card's checks,
--     "Update the card" and evolving powers all work the same.
--   * The owner can take it back from a member (the card comes off). An admin taking the family's
--     grant back removes it from every member it was handed to.
--   * A member who leaves has their character deleted, so nothing else is needed for that.
--
-- Run once in the SQL Editor after 20261215100000_admin_evolutions_auto.sql.

create table if not exists public.family_power_grants (
	id bigint generated always as identity primary key,
	family_id uuid not null references public.families (id) on delete cascade,
	power_id uuid not null references public.custom_powers (id) on delete cascade,
	note text not null default '',
	granted_by uuid references public.profiles (id) on delete set null,
	granted_at timestamptz not null default now(),
	unique (family_id, power_id)
);

alter table public.family_power_grants enable row level security;
revoke all on public.family_power_grants from anon, authenticated;

alter table public.power_grants
	add column if not exists family_grant_id bigint references public.family_power_grants (id) on delete cascade;
create index if not exists power_grants_family_grant on public.power_grants (family_grant_id);

-- Admins: grant a power to a family. Its owner hands it out.
create or replace function public.grant_power_to_family(p_power uuid, p_family uuid, p_note text default '')
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	gid bigint;
begin
	if not public.is_admin() then
		raise exception 'Only admins can grant powers.' using errcode = '42501';
	end if;
	if not exists (select 1 from public.custom_powers where id = p_power) then
		raise exception 'That power doesn''t exist.' using errcode = 'P0002';
	end if;
	if not exists (select 1 from public.families where id = p_family) then
		raise exception 'That family doesn''t exist.' using errcode = 'P0002';
	end if;
	if exists (select 1 from public.family_power_grants where family_id = p_family and power_id = p_power) then
		raise exception 'That family already has this power.' using errcode = 'P0001';
	end if;
	insert into public.family_power_grants (family_id, power_id, note, granted_by)
	values (p_family, p_power, coalesce(p_note, ''), auth.uid())
	returning id into gid;
	return gid;
end;
$$;

-- Takes one handed-out grant back: its card comes off the character, then the grant goes.
create or replace function public.drop_family_power_grant(g public.power_grants)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	perform set_config('portal.family_review', 'on', true);
	update public.characters
	set sheet = public.sheet_without_grant(sheet, g.id),
		approved_sheet = public.sheet_without_grant(approved_sheet, g.id)
	where id = g.character_id;
	perform set_config('portal.family_review', '', true);
	delete from public.power_evolutions where character_id = g.character_id and card_key = g.card_key;
	delete from public.character_unlocks where character_id = g.character_id and card_key = g.card_key and tree_id = 'custom';
	delete from public.power_grants where id = g.id;
end;
$$;

-- Admins: take a family's power back, and off every member it was handed to.
create or replace function public.revoke_family_power(p_grant bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	g public.power_grants;
begin
	if not public.is_admin() then
		raise exception 'Only admins can take powers back.' using errcode = '42501';
	end if;
	for g in select * from public.power_grants where family_grant_id = p_grant loop
		perform public.drop_family_power_grant(g);
	end loop;
	delete from public.family_power_grants where id = p_grant;
end;
$$;

-- The family's owner (or an admin): give a family power to a member character, or take it back.
create or replace function public.give_family_power(p_grant bigint, p_character uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	fg public.family_power_grants;
	fam public.families;
	pw public.custom_powers;
	ch public.characters;
	g public.power_grants;
	gid bigint;
	card jsonb;
begin
	select * into fg from public.family_power_grants where id = p_grant;
	if fg.id is null then
		raise exception 'The family doesn''t have that power any more.' using errcode = 'P0002';
	end if;
	select * into fam from public.families where id = fg.family_id;
	if not (public.is_admin() or fam.owner_id = auth.uid()) then
		raise exception 'Only the family''s owner can hand out its powers.' using errcode = '42501';
	end if;
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not exists (select 1 from public.family_members m where m.family_id = fam.id and m.character_id = ch.id and m.status = 'active') then
		raise exception 'That character isn''t a member of %.', fam.name using errcode = 'P0001';
	end if;
	select * into g from public.power_grants where family_grant_id = fg.id and character_id = ch.id;

	if not p_on then
		if g.id is not null then
			perform public.drop_family_power_grant(g);
		end if;
		return;
	end if;
	if g.id is not null then
		return;
	end if;

	select * into pw from public.custom_powers where id = fg.power_id;
	if pw.card is null then
		raise exception '% needs to be saved again in the Power Builder before it can be handed out. Ask an admin.', pw.name using errcode = 'P0001';
	end if;
	card := pw.card || jsonb_build_object('key', 'sys_' || substr(md5(random()::text), 1, 8));
	insert into public.power_grants (power_id, profile_id, character_id, card_key, used_at, note, granted_by, family_grant_id)
	values (pw.id, ch.owner_id, ch.id, card ->> 'key', now(), 'From ' || fam.name, auth.uid(), fg.id)
	returning id into gid;
	card := jsonb_set(card, '{powerLink,grantId}', to_jsonb(gid));

	perform set_config('portal.family_review', 'on', true);
	update public.characters
	set sheet = public.sheet_with_card(sheet, card),
		approved_sheet = case when approved_sheet is null then null else public.sheet_with_card(approved_sheet, card) end
	where id = ch.id;
	perform set_config('portal.family_review', '', true);
end;
$$;

-- A family's powers and who holds each, for its owner and admins.
create or replace function public.family_powers(p_family uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.families where id = p_family and owner_id = auth.uid())) then
		raise exception 'Only the family''s owner can see its powers.' using errcode = '42501';
	end if;
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'id', fg.id, 'power_id', p.id, 'name', p.name, 'system', p.system, 'description', p.description,
			'note', fg.note, 'granted_at', fg.granted_at, 'ready', p.card is not null,
			'holders', coalesce((select jsonb_agg(g.character_id) from public.power_grants g where g.family_grant_id = fg.id), '[]')
		) order by p.name)
		from public.family_power_grants fg join public.custom_powers p on p.id = fg.power_id
		where fg.family_id = p_family
	), '[]');
end;
$$;

-- Admins: the families that have a power, with how many members hold it.
create or replace function public.power_families(p_power uuid)
returns table (id bigint, family_id uuid, family_name text, note text, granted_at timestamptz, holders int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can see power grants.' using errcode = '42501';
	end if;
	return query
		select fg.id, fg.family_id, f.name, fg.note, fg.granted_at,
			(select count(*)::int from public.power_grants g where g.family_grant_id = fg.id)
		from public.family_power_grants fg join public.families f on f.id = fg.family_id
		where fg.power_id = p_power
		order by f.name;
end;
$$;

revoke execute on function public.grant_power_to_family(uuid, uuid, text) from public, anon;
revoke execute on function public.drop_family_power_grant(public.power_grants) from public, anon, authenticated;
revoke execute on function public.revoke_family_power(bigint) from public, anon;
revoke execute on function public.give_family_power(bigint, uuid, boolean) from public, anon;
revoke execute on function public.family_powers(uuid) from public, anon;
revoke execute on function public.power_families(uuid) from public, anon;
grant execute on function public.grant_power_to_family(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_family_power(bigint) to authenticated;
grant execute on function public.give_family_power(bigint, uuid, boolean) to authenticated;
grant execute on function public.family_powers(uuid) to authenticated;
grant execute on function public.power_families(uuid) to authenticated;
