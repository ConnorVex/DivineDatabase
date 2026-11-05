-- Encrypted characters. An owner asks for encryption with a reason; once staff approve it, only
-- the owner, admins and the players the owner adds can see the character. Everyone else gets the
-- name and "encrypted", never the sheet: the page and the bot both go through can_view_character
-- and character_page below, so nothing hidden ever leaves the database.
--
-- character_page also hides Error Tiers: on an admin character, the stats in sheet.errorStats come
-- back as "ERROR" for anyone who isn't an admin.
--
-- Run once in the SQL Editor after 20261119100000_admin_characters.sql.

alter table public.characters
	add column if not exists encryption_requested boolean not null default false,
	add column if not exists encryption_reason text not null default '' check (char_length(encryption_reason) <= 1000),
	add column if not exists encrypted boolean not null default false;

-- Who else may see an encrypted character.
create table if not exists public.character_viewers (
	character_id uuid not null references public.characters (id) on delete cascade,
	profile_id uuid not null references public.profiles (id) on delete cascade,
	added_by uuid references public.profiles (id) on delete set null default auth.uid(),
	added_at timestamptz not null default now(),
	primary key (character_id, profile_id)
);
alter table public.character_viewers enable row level security;

drop policy if exists "owner, admin or viewer reads viewers" on public.character_viewers;
create policy "owner, admin or viewer reads viewers" on public.character_viewers
	for select to authenticated using (
		profile_id = (select auth.uid())
		or (select public.is_admin())
		or exists (select 1 from public.characters c where c.id = character_viewers.character_id and c.owner_id = (select auth.uid()))
	);
grant select on public.character_viewers to authenticated;

-- Players ask for encryption and can switch it off, but only admins switch it on.
create or replace function public.guard_character_encryption()
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
		new.encrypted := false;
	elsif new.encrypted and not old.encrypted then
		new.encrypted := false;
	end if;
	return new;
end;
$$;

drop trigger if exists characters_encryption_guard on public.characters;
create trigger characters_encryption_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_encryption();

-- Can this profile see this character? p_profile defaults to the logged-in player.
create or replace function public.can_view_profile_character(p_character uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.characters c
		where c.id = p_character
			and (
				not c.encrypted
				or c.owner_id = p_profile
				or exists (select 1 from public.admins a join public.profiles p on p.discord_id = a.discord_id where p.id = p_profile)
				or exists (select 1 from public.character_viewers v where v.character_id = c.id and v.profile_id = p_profile)
			)
	);
$$;

-- For the bot (service role): can this Discord user see this character?
create or replace function public.can_view_character(p_character uuid, p_discord_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		exists (select 1 from public.admins where discord_id = p_discord_id)
		or public.can_view_profile_character(p_character, (select id from public.profiles where discord_id = p_discord_id)),
		false
	);
$$;

-- An Error Tier sheet as non-admins see it: those stats become "ERROR".
create or replace function public.mask_error_tiers(p_sheet jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
	k text;
begin
	if jsonb_typeof(p_sheet -> 'errorStats') <> 'array' then
		return p_sheet;
	end if;
	for k in select jsonb_array_elements_text(p_sheet -> 'errorStats') loop
		if k in ('strength', 'speed', 'defense', 'stamina', 'intelligence') then
			p_sheet := jsonb_set(p_sheet, array['stats', k], '"ERROR"', true);
		elsif k = 'phase' then
			p_sheet := jsonb_set(p_sheet, '{stats,phase}', 'null', true);
		elsif k = 'potential' then
			p_sheet := jsonb_set(p_sheet, '{potential}', '{"grade": "ERROR"}', true);
		end if;
	end loop;
	return p_sheet;
end;
$$;

-- One character's public page. Approved characters only (the owner and admins also get drafts).
-- Encrypted ones come back as just { id, name, encrypted: true } for anyone not allowed.
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
	if not (admin or (me is not null and public.can_view_profile_character(c.id, me))) then
		return jsonb_build_object('id', c.id, 'name', coalesce(c.approved_name, c.name), 'owner', owner_name, 'encrypted', true, 'allowed', false);
	end if;
	-- The live (approved) version; drafts only reach the owner and admins (checked above).
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
		'encrypted', c.encrypted,
		'allowed', true,
		'mine', mine,
		'approved', c.approved_at is not null,
		'sheet', sheet
	);
end;
$$;

-- A player's characters for lists: names and whether they're encrypted, never sheets.
create or replace function public.public_characters(p_owner uuid)
returns table (id uuid, name text, encrypted boolean, allowed boolean, image text)
language sql
stable
security definer
set search_path = ''
as $$
	select c.id, coalesce(c.approved_name, c.name), c.encrypted,
		public.is_admin() or public.can_view_profile_character(c.id, auth.uid()),
		case when public.is_admin() or public.can_view_profile_character(c.id, auth.uid()) then c.approved_sheet -> 'appearance' ->> 'image' end
	from public.characters c
	where c.owner_id = p_owner and c.approved_at is not null and not c.hidden and c.status <> 'denied'
	order by coalesce(c.approved_name, c.name);
$$;

-- Finding a player to add as a viewer (names only, no Discord ids).
create or replace function public.find_viewer_candidates(p_query text)
returns table (profile_id uuid, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
	select p.id, p.display_name, p.avatar_url
	from public.profiles p
	where auth.uid() is not null and char_length(trim(p_query)) >= 2 and p.display_name ilike '%' || trim(p_query) || '%'
	order by p.display_name
	limit 8;
$$;

create or replace function public.character_viewer_list(p_character uuid)
returns table (profile_id uuid, display_name text, avatar_url text, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.characters where id = p_character and owner_id = auth.uid())) then
		raise exception 'Only the owner or an admin can see who has access.' using errcode = '42501';
	end if;
	return query
		select p.id, p.display_name, p.avatar_url, v.added_at
		from public.character_viewers v join public.profiles p on p.id = v.profile_id
		where v.character_id = p_character
		order by p.display_name;
end;
$$;

create or replace function public.add_character_viewer(p_character uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.characters where id = p_character and owner_id = auth.uid())) then
		raise exception 'Only the owner or an admin can add viewers.' using errcode = '42501';
	end if;
	if (select count(*) from public.character_viewers where character_id = p_character) >= 50 then
		raise exception 'A character can have at most 50 viewers.';
	end if;
	insert into public.character_viewers (character_id, profile_id, added_by)
	values (p_character, p_profile, auth.uid())
	on conflict do nothing;
end;
$$;

create or replace function public.remove_character_viewer(p_character uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.characters where id = p_character and owner_id = auth.uid())) then
		raise exception 'Only the owner or an admin can remove viewers.' using errcode = '42501';
	end if;
	delete from public.character_viewers where character_id = p_character and profile_id = p_profile;
end;
$$;

-- Admins switch encryption on (approving the request) or off.
create or replace function public.set_encryption(p_character uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can encrypt a character.' using errcode = '42501';
	end if;
	update public.characters set encrypted = p_on, encryption_requested = case when p_on then false else encryption_requested end
	where id = p_character;
end;
$$;

-- The owner (or an admin) switches encryption off, even on an approved character.
create or replace function public.stop_encryption(p_character uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.characters where id = p_character and owner_id = auth.uid())) then
		raise exception 'Only the owner or an admin can switch encryption off.' using errcode = '42501';
	end if;
	-- The same trusted path review_character uses, so approved characters can be changed.
	perform set_config('portal.family_review', 'on', true);
	update public.characters set encrypted = false, encryption_requested = false where id = p_character;
	perform set_config('portal.family_review', '', true);
end;
$$;

-- The public gallery view must not hand out encrypted sheets (or unmasked Error Tiers).
-- Encrypted characters keep their name in lists, with no sheet; allowed viewers use character_page.
create or replace view public.gallery as
select
	c.id,
	c.kind,
	c.canon_universe,
	c.approved_name as name,
	case
		when c.encrypted then null
		when c.admin_character then public.mask_error_tiers(c.approved_sheet)
		else c.approved_sheet
	end as sheet,
	c.approved_at,
	p.display_name as player_name,
	p.avatar_url as player_avatar,
	c.encrypted
from public.characters c
join public.profiles p on p.id = c.owner_id
where c.approved_at is not null
	and not c.hidden
	and c.status <> 'denied';

revoke execute on function public.stop_encryption(uuid) from public, anon;
grant execute on function public.stop_encryption(uuid) to authenticated;
revoke execute on function public.can_view_profile_character(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_character(uuid, text) from public, anon, authenticated;
revoke execute on function public.character_page(uuid) from public;
revoke execute on function public.public_characters(uuid) from public;
revoke execute on function public.find_viewer_candidates(text) from public, anon;
revoke execute on function public.character_viewer_list(uuid) from public, anon;
revoke execute on function public.add_character_viewer(uuid, uuid) from public, anon;
revoke execute on function public.remove_character_viewer(uuid, uuid) from public, anon;
revoke execute on function public.set_encryption(uuid, boolean) from public, anon;
grant execute on function public.can_view_character(uuid, text) to service_role;
-- Pure function; the gallery view calls it with the visitor's rights.
grant execute on function public.mask_error_tiers(jsonb) to anon, authenticated, service_role;
grant execute on function public.character_page(uuid) to anon, authenticated;
grant execute on function public.public_characters(uuid) to anon, authenticated;
grant execute on function public.find_viewer_candidates(text) to authenticated;
grant execute on function public.character_viewer_list(uuid) to authenticated;
grant execute on function public.add_character_viewer(uuid, uuid) to authenticated;
grant execute on function public.remove_character_viewer(uuid, uuid) to authenticated;
grant execute on function public.set_encryption(uuid, boolean) to authenticated;
