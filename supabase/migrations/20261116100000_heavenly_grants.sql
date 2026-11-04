-- Heavenly Restrictions are Permission Based: admins grant one to a player's account, and the
-- next character approved with it uses it up. Twins are granted to two players at once, one as
-- the Cursed Twin and one as the Physical Twin.
--
-- Run once in the SQL Editor after 20261115110000_bot_custom_tree_points.sql.

create table if not exists public.heavenly_grants (
	id bigint generated always as identity primary key,
	profile_id uuid not null references public.profiles (id) on delete cascade,
	restriction text not null check (restriction in ('Physical', 'Cursed Energy', 'Cursed Twin', 'Physical Twin', 'Equilibrium')),
	-- The other twin's account (Twins only).
	twin_profile_id uuid references public.profiles (id) on delete set null,
	-- The character that used the grant; null while it's unused.
	character_id uuid references public.characters (id) on delete set null,
	used_at timestamptz,
	note text not null default '',
	granted_by uuid references public.profiles (id) on delete set null,
	granted_at timestamptz not null default now()
);

-- One unused grant per account at a time.
create unique index if not exists heavenly_grants_one_open on public.heavenly_grants (profile_id) where character_id is null;

alter table public.heavenly_grants enable row level security;

drop policy if exists "see own heavenly grants or admin" on public.heavenly_grants;
create policy "see own heavenly grants or admin" on public.heavenly_grants
	for select to authenticated using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Admins: grant a restriction. For Twins pass p_restriction 'Cursed Twin' or 'Physical Twin' and
-- the other player as p_twin; they get the other role.
create or replace function public.grant_heavenly(p_profile uuid, p_restriction text, p_twin uuid default null, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can grant Heavenly Restrictions.' using errcode = '42501';
	end if;
	if p_restriction in ('Cursed Twin', 'Physical Twin') then
		if p_twin is null or p_twin = p_profile then
			raise exception 'Twins need a second player as the other twin.';
		end if;
	elsif p_twin is not null then
		raise exception 'Only Twins are granted to two players.';
	end if;
	if exists (select 1 from public.heavenly_grants where character_id is null and profile_id in (p_profile, p_twin)) then
		raise exception 'That player already has an unused Heavenly Restriction. Revoke it first.';
	end if;
	insert into public.heavenly_grants (profile_id, restriction, twin_profile_id, note, granted_by)
	values (p_profile, p_restriction, p_twin, coalesce(p_note, ''), auth.uid());
	if p_twin is not null then
		insert into public.heavenly_grants (profile_id, restriction, twin_profile_id, note, granted_by)
		values (p_twin, case p_restriction when 'Cursed Twin' then 'Physical Twin' else 'Cursed Twin' end, p_profile, coalesce(p_note, ''), auth.uid());
	end if;
end;
$$;

-- Admins: take back a grant (unused or used; a used one stays on its character's sheet).
create or replace function public.revoke_heavenly(p_grant bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can revoke Heavenly Restrictions.' using errcode = '42501';
	end if;
	delete from public.heavenly_grants where id = p_grant;
end;
$$;

-- Admins: a player's grants, with the twin's and character's names.
create or replace function public.heavenly_grants_of(p_profile uuid)
returns table (id bigint, restriction text, twin_name text, character_name text, used_at timestamptz, note text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can see Heavenly Restriction grants.' using errcode = '42501';
	end if;
	return query
		select g.id, g.restriction, t.display_name, c.name, g.used_at, g.note, g.granted_at
		from public.heavenly_grants g
		left join public.profiles t on t.id = g.twin_profile_id
		left join public.characters c on c.id = g.character_id
		where g.profile_id = p_profile
		order by g.granted_at desc;
end;
$$;

-- A character approved with a Heavenly Restriction uses up its owner's matching unused grant.
create or replace function public.use_heavenly_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	hr text;
begin
	if new.status <> 'approved' or old.status = 'approved' then
		return new;
	end if;
	select e->'fields'->>'heavenlyRestriction' into hr
	from jsonb_array_elements(coalesce(new.sheet->'systems', '[]'::jsonb)) e
	where e->>'system' = 'jujutsu-kaisen' and coalesce(e->'fields'->>'heavenlyRestriction', 'None') <> 'None'
	limit 1;
	if hr is null or exists (select 1 from public.heavenly_grants where character_id = new.id) then
		return new;
	end if;
	update public.heavenly_grants
	set character_id = new.id, used_at = now()
	where profile_id = new.owner_id and character_id is null and restriction = hr;
	return new;
end;
$$;

drop trigger if exists use_heavenly_grant on public.characters;
create trigger use_heavenly_grant after update of status on public.characters
	for each row execute function public.use_heavenly_grant();
