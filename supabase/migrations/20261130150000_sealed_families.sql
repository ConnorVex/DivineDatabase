-- Sealed families and opening the Inheritance.
--
-- An owner can seal their family (families.sealed). Its members' characters are then treated
-- like encrypted characters for everyone outside the family: the page, the lists, the gallery
-- and the bot all go through can_view_profile_character, so nothing sealed leaves the database.
-- Inside the family (the owner, admins, and the players with a member in it) everything shows.
-- Every perk of a sealed family is treated as hidden.
--
-- Hidden perks (and a sealed family's perks) are also shown to players the owner lets in to
-- build a character: a player asks to see the Inheritance (family_inheritance_access), and the
-- owner lets them in or declines.

alter table public.families add column if not exists sealed boolean not null default false;

-- ───────────────────────────── Who's inside ─────────────────────────────

-- The sealed family this character is an active member of (null when none).
create or replace function public.character_seal(p_character uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select f.id
	from public.family_members m
	join public.families f on f.id = m.family_id
	where m.character_id = p_character and m.status = 'active' and f.sealed and f.status = 'approved'
	order by f.name
	limit 1;
$$;

-- For PostgREST: characters?select=...,sealed
create or replace function public.sealed(c public.characters)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.character_seal(c.id) is not null;
$$;

-- Is this profile inside the family: its owner, or the player of an active member?
create or replace function public.family_insider(p_family uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select p_profile is not null and (
		exists (select 1 from public.families f where f.id = p_family and f.owner_id = p_profile)
		or exists (
			select 1 from public.family_members m
			join public.characters c on c.id = m.character_id
			where m.family_id = p_family and m.status = 'active' and c.owner_id = p_profile
		)
	);
$$;

-- As before, plus sealing: a sealed member's sheet is for the family's insiders (and the usual
-- owner, admins and added viewers).
create or replace function public.can_view_profile_character(p_character uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.characters c
		cross join lateral (select public.character_seal(c.id) as seal) s
		where c.id = p_character
			and (
				(not c.encrypted and s.seal is null)
				or c.owner_id = p_profile
				or exists (select 1 from public.admins a join public.profiles p on p.discord_id = a.discord_id where p.id = p_profile)
				or exists (select 1 from public.character_viewers v where v.character_id = c.id and v.profile_id = p_profile)
				-- Sealed (and not encrypted by its player): the family sees it.
				or (not c.encrypted and s.seal is not null and public.family_insider(s.seal, p_profile))
			)
	);
$$;

-- As before, plus sealed_by: the family that seals this character, if any.
create or replace function public.character_page(p_character uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	c public.characters;
	me uuid := auth.uid();
	admin boolean := public.is_admin();
	mine boolean;
	owner_name text;
	sheet jsonb;
	seal uuid;
	seal_name text;
begin
	select * into c from public.characters where id = p_character;
	if c.id is null then
		return null;
	end if;
	mine := c.owner_id = me;
	if not (mine or admin) and (c.approved_at is null or c.hidden or c.status = 'denied') then
		return null;
	end if;
	select display_name into owner_name from public.profiles where id = c.owner_id;
	seal := public.character_seal(c.id);
	select name into seal_name from public.families where id = seal;
	if not (admin or (me is not null and public.can_view_profile_character(c.id, me))) then
		return jsonb_build_object('id', c.id, 'name', coalesce(c.approved_name, c.name), 'owner', owner_name, 'encrypted', true, 'allowed', false,
			'sealed_by', seal_name);
	end if;
	sheet := case when c.approved_at is not null then c.approved_sheet else c.sheet end;
	if not admin and c.admin_character then
		sheet := public.mask_error_tiers(sheet);
	end if;
	return jsonb_build_object(
		'id', c.id,
		'name', coalesce(case when mine or admin then c.name end, c.approved_name, c.name),
		'owner', owner_name,
		'owner_id', c.owner_id,
		'kind', c.kind,
		'canon_universe', c.canon_universe,
		'admin_character', c.admin_character,
		-- The player's own encryption; sealed_by says when the family seals it too.
		'encrypted', c.encrypted,
		'sealed_by', seal_name,
		'allowed', true,
		'mine', mine,
		'approved', c.approved_at is not null,
		'sheet', sheet
	);
end;
$$;

create or replace function public.public_characters(p_owner uuid)
returns table (id uuid, name text, encrypted boolean, allowed boolean, image text)
language sql
stable
security definer
set search_path = ''
as $$
	select c.id, coalesce(c.approved_name, c.name), c.encrypted or public.character_seal(c.id) is not null,
		public.is_admin() or public.can_view_profile_character(c.id, auth.uid()),
		case when public.is_admin() or public.can_view_profile_character(c.id, auth.uid()) then c.approved_sheet -> 'appearance' ->> 'image' end
	from public.characters c
	where c.owner_id = p_owner and c.approved_at is not null and not c.hidden and c.status <> 'denied'
	order by coalesce(c.approved_name, c.name);
$$;

-- The public gallery hands out no sealed sheets either (insiders use character_page).
create or replace view public.gallery as
select
	c.id,
	c.kind,
	c.canon_universe,
	c.approved_name as name,
	case
		when c.encrypted or s.seal is not null then null
		when c.admin_character then public.mask_error_tiers(c.approved_sheet)
		else c.approved_sheet
	end as sheet,
	c.approved_at,
	p.display_name as player_name,
	p.avatar_url as player_avatar,
	c.encrypted or s.seal is not null as encrypted
from public.characters c
join public.profiles p on p.id = c.owner_id
cross join lateral (select public.character_seal(c.id) as seal) s
where c.approved_at is not null
	and not c.hidden
	and c.status <> 'denied';

-- ───────────────────────────── Opening the Inheritance ─────────────────────────────

create table if not exists public.family_inheritance_access (
	family_id uuid not null references public.families (id) on delete cascade,
	player_id uuid not null references public.profiles (id) on delete cascade,
	status text not null default 'pending' check (status in ('pending', 'allowed', 'declined')),
	message text not null default '' check (char_length(message) <= 500),
	created_at timestamptz not null default now(),
	decided_at timestamptz,
	decided_by uuid references public.profiles (id) on delete set null,
	primary key (family_id, player_id)
);
alter table public.family_inheritance_access enable row level security;
drop policy if exists "inheritance access readable" on public.family_inheritance_access;
create policy "inheritance access readable" on public.family_inheritance_access
	for select to authenticated using (player_id = auth.uid() or public.is_family_owner(family_id) or public.is_admin());
revoke insert, update, delete on public.family_inheritance_access from anon, authenticated;
grant select on public.family_inheritance_access to authenticated;

-- Who may see a family's hidden perks: insiders, admins, and players the owner let in.
create or replace function public.sees_family_secrets(p_family uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.is_admin()
		or public.family_insider(p_family, auth.uid())
		or exists (
			select 1 from public.family_inheritance_access a
			where a.family_id = p_family and a.player_id = auth.uid() and a.status = 'allowed'
		);
$$;

-- A player asks to see the Inheritance (asking again after a decline sends it again).
create or replace function public.ask_inheritance_access(p_family uuid, p_message text default '')
returns public.family_inheritance_access
language plpgsql
security definer
set search_path = ''
as $$
declare
	f public.families;
	asked public.family_inheritance_access;
	owner_discord text;
	me_name text;
begin
	if auth.uid() is null then
		raise exception 'Log in first.' using errcode = '42501';
	end if;
	select * into f from public.families where id = p_family;
	if f.id is null or f.status <> 'approved' or f.recruiting <> 'open' then
		raise exception 'That family isn''t taking new members right now.' using errcode = 'P0001';
	end if;
	perform public.ensure_profile();
	insert into public.family_inheritance_access (family_id, player_id, message)
	values (f.id, auth.uid(), left(coalesce(btrim(p_message), ''), 500))
	on conflict (family_id, player_id) do update
		set status = case when public.family_inheritance_access.status = 'declined' then 'pending' else public.family_inheritance_access.status end,
			message = excluded.message,
			created_at = case when public.family_inheritance_access.status = 'declined' then now() else public.family_inheritance_access.created_at end
	returning * into asked;

	if asked.status = 'pending' then
		select discord_id into owner_discord from public.profiles where id = f.owner_id;
		select display_name into me_name from public.profiles where id = auth.uid();
		if owner_discord is not null and f.owner_id is distinct from auth.uid() then
			perform public.discord_post('discord_public_webhook', jsonb_build_object(
				'content', '<@' || owner_discord || '>, **' || public.discord_escape(coalesce(me_name, 'A player'))
					|| '** asks to see **' || public.discord_escape(f.name) || '**''s Inheritance to make a character. Let them in on the family''s page in the Divine Database (Manage family → Inheritance).',
				'allowed_mentions', jsonb_build_object('users', jsonb_build_array(owner_discord))
			));
		end if;
	end if;
	return asked;
end;
$$;

-- The owner (or an admin) lets a player in, declines, or closes it again (p_allow null removes it).
create or replace function public.decide_inheritance_access(p_family uuid, p_player uuid, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	player_discord text;
	fam_name text;
begin
	if not (public.is_family_owner(p_family) or public.is_admin()) then
		raise exception 'Only the family''s owner can decide this.' using errcode = '42501';
	end if;
	perform public.ensure_profile();
	if p_allow is null then
		delete from public.family_inheritance_access where family_id = p_family and player_id = p_player;
		return;
	end if;
	update public.family_inheritance_access
	set status = case when p_allow then 'allowed' else 'declined' end, decided_at = now(), decided_by = auth.uid()
	where family_id = p_family and player_id = p_player;
	if not found then
		raise exception 'That request is gone.' using errcode = 'P0001';
	end if;
	select discord_id into player_discord from public.profiles where id = p_player;
	select name into fam_name from public.families where id = p_family;
	if player_discord is not null then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', '<@' || player_discord || '>, ' || case when p_allow
				then '**' || public.discord_escape(fam_name) || '** let you in: its whole Inheritance is open to you now.'
				else '**' || public.discord_escape(fam_name) || '** declined your request to see its Inheritance.' end,
			'allowed_mentions', jsonb_build_object('users', jsonb_build_array(player_discord))
		));
	end if;
end;
$$;

-- The requests with the players' names, for the owner (who can't read every profile).
create or replace function public.inheritance_access_list(p_family uuid)
returns table (player_id uuid, display_name text, avatar_url text, status text, message text, created_at timestamptz, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
	select a.player_id, p.display_name, p.avatar_url, a.status, a.message, a.created_at, a.decided_at
	from public.family_inheritance_access a
	join public.profiles p on p.id = a.player_id
	where a.family_id = p_family and (public.is_family_owner(p_family) or public.is_admin())
	order by a.status = 'pending' desc, a.created_at desc;
$$;

-- ───────────────────────────── The perk board ─────────────────────────────

-- As before; a sealed family's perks all count as hidden, and hidden perks also open to the
-- players the owner let in to build a character.
create or replace view public.family_perk_board
with (security_invoker = false) as
select p.id, p.family_id, (p.hidden or f.sealed) as hidden, p.created_at,
	(not (p.hidden or f.sealed) or v.ok) as unlocked,
	case when not (p.hidden or f.sealed) or v.ok then p.kind end as kind,
	case when not (p.hidden or f.sealed) or v.ok then p.access end as access,
	case when not (p.hidden or f.sealed) or v.ok then p.title else '' end as title,
	case when not (p.hidden or f.sealed) or v.ok then p.description else '' end as description,
	case when not (p.hidden or f.sealed) or v.ok then p.details else '{}'::jsonb end as details,
	p.section,
	p.sort
from public.family_perks p
join public.families f on f.id = p.family_id
cross join lateral (
	select (f.owner_id = auth.uid() or public.sees_family_secrets(f.id)) as ok
) v
where p.status = 'approved'
	and f.status = 'approved';

-- ───────────────────────────── Permissions ─────────────────────────────

revoke execute on function public.character_seal(uuid) from public, anon, authenticated;
revoke execute on function public.family_insider(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_profile_character(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.character_page(uuid) from public;
revoke execute on function public.public_characters(uuid) from public;
revoke execute on function public.sees_family_secrets(uuid) from public;
revoke execute on function public.ask_inheritance_access(uuid, text) from public, anon;
revoke execute on function public.decide_inheritance_access(uuid, uuid, boolean) from public, anon;
revoke execute on function public.inheritance_access_list(uuid) from public, anon;
grant execute on function public.character_page(uuid) to anon, authenticated;
grant execute on function public.public_characters(uuid) to anon, authenticated;
grant execute on function public.sees_family_secrets(uuid) to anon, authenticated;
grant execute on function public.sealed(public.characters) to anon, authenticated, service_role;
grant execute on function public.ask_inheritance_access(uuid, text) to authenticated;
grant execute on function public.decide_inheritance_access(uuid, uuid, boolean) to authenticated;
grant execute on function public.inheritance_access_list(uuid) to authenticated;
grant select on public.gallery to anon, authenticated;
grant select on public.family_perk_board to anon, authenticated;
