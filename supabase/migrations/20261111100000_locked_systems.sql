-- Locked systems: Permission Based power systems (Speed Force first) whose rules only
-- players with access can read. The Index shows a glitched tile to everyone else.
--
-- The rules themselves are NOT in this file: both repos are public. They live in
-- supabase/private/ (gitignored) and are loaded by hand in the SQL Editor.
--
-- Run once in the SQL Editor after 20261110100000_admin_perk_review_choice.sql.

create table if not exists public.locked_systems (
	slug text primary key,
	name text not null,
	sort int not null default 0
);

create table if not exists public.locked_pages (
	system text not null references public.locked_systems (slug) on delete cascade,
	slug text not null,
	title text not null,
	sort int not null default 0,
	-- HTML, written by staff. Rendered as-is on the Index.
	body text not null,
	primary key (system, slug)
);

create table if not exists public.system_access (
	profile_id uuid not null references public.profiles (id) on delete cascade,
	system text not null references public.locked_systems (slug) on delete cascade,
	granted_by uuid references public.profiles (id) on delete set null,
	granted_at timestamptz not null default now(),
	primary key (profile_id, system)
);

alter table public.locked_systems enable row level security;
alter table public.locked_pages enable row level security;
alter table public.system_access enable row level security;

-- True when the caller may read a locked system: admins always, players once granted.
create or replace function public.has_system_access(p_system text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.is_admin() or exists (
		select 1 from public.system_access
		where profile_id = auth.uid() and system = p_system
	);
$$;

-- System names are public (the glitched tile shows one); pages are not.
drop policy if exists "anyone sees locked system names" on public.locked_systems;
create policy "anyone sees locked system names" on public.locked_systems
	for select to anon, authenticated using (true);

drop policy if exists "granted players read locked pages" on public.locked_pages;
create policy "granted players read locked pages" on public.locked_pages
	for select to authenticated using (public.has_system_access(system));

drop policy if exists "see own access or admin" on public.system_access;
create policy "see own access or admin" on public.system_access
	for select to authenticated using (profile_id = auth.uid() or public.is_admin());

-- Slugs of the locked systems the caller can open (all of them for admins).
create or replace function public.my_locked_systems()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
	select slug from public.locked_systems where public.has_system_access(slug);
$$;

-- Admins: everyone with access to a system.
create or replace function public.system_access_list(p_system text)
returns table (profile_id uuid, display_name text, discord_id text, avatar_url text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can see who has access.' using errcode = '42501';
	end if;
	return query
		select p.id, p.display_name, p.discord_id, p.avatar_url, a.granted_at
		from public.system_access a
		join public.profiles p on p.id = a.profile_id
		where a.system = p_system
		order by p.display_name;
end;
$$;

-- Admins: find players to grant access to, by name or Discord ID.
create or replace function public.find_players(p_query text)
returns table (profile_id uuid, display_name text, discord_id text, avatar_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can search players.' using errcode = '42501';
	end if;
	return query
		select p.id, p.display_name, p.discord_id, p.avatar_url
		from public.profiles p
		where p.display_name ilike '%' || trim(p_query) || '%' or p.discord_id = trim(p_query)
		order by p.display_name
		limit 10;
end;
$$;

create or replace function public.grant_system_access(p_system text, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can grant access.' using errcode = '42501';
	end if;
	insert into public.system_access (profile_id, system, granted_by)
	values (p_profile, p_system, auth.uid())
	on conflict do nothing;
end;
$$;

create or replace function public.revoke_system_access(p_system text, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can remove access.' using errcode = '42501';
	end if;
	delete from public.system_access where profile_id = p_profile and system = p_system;
end;
$$;

revoke execute on function public.has_system_access(text) from public, anon, authenticated;
revoke execute on function public.my_locked_systems() from public, anon, authenticated;
revoke execute on function public.system_access_list(text) from public, anon, authenticated;
revoke execute on function public.find_players(text) from public, anon, authenticated;
revoke execute on function public.grant_system_access(text, uuid) from public, anon, authenticated;
revoke execute on function public.revoke_system_access(text, uuid) from public, anon, authenticated;
grant execute on function public.has_system_access(text) to authenticated;
grant execute on function public.my_locked_systems() to authenticated;
grant execute on function public.system_access_list(text) to authenticated;
grant execute on function public.find_players(text) to authenticated;
grant execute on function public.grant_system_access(text, uuid) to authenticated;
grant execute on function public.revoke_system_access(text, uuid) to authenticated;

grant select on public.locked_systems to anon, authenticated;
grant select on public.locked_pages to authenticated;
grant select on public.system_access to authenticated;

insert into public.locked_systems (slug, name, sort) values ('speed-force', 'Speed Force', 1)
on conflict (slug) do update set name = excluded.name;
