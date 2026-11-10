-- Custom powers: admins design a power (a Cursed Technique, a Stand, a Quirk…) on a series' card and
-- grant it to a player. A grant goes to the player's account, where they add it as a card on a new
-- character or an evolution (approval uses it up), or straight onto one of their characters.
--
-- The card on the sheet carries "powerLink": { powerId, grantId, title, own, ownSkills, about, drawbacks }.
-- Its stats come from the power and stay locked; the player fills in only the parts left open.

create table if not exists public.custom_powers (
	id uuid primary key default gen_random_uuid(),
	name text not null check (length(btrim(name)) between 1 and 100),
	system text not null,
	-- The card as built: { system, fields, skills, parts? }, like a family ability.
	ability jsonb not null default '{}',
	description text not null default '',
	drawbacks text not null default '',
	-- An optional skill tree for the card (the same shape as a player's custom tree).
	tree jsonb,
	created_by uuid references public.profiles (id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.power_grants (
	id bigint generated always as identity primary key,
	power_id uuid not null references public.custom_powers (id) on delete cascade,
	profile_id uuid not null references public.profiles (id) on delete cascade,
	-- The character holding it, and its card; null while it waits on the account.
	character_id uuid references public.characters (id) on delete set null,
	card_key text,
	used_at timestamptz,
	note text not null default '',
	granted_by uuid references public.profiles (id) on delete set null,
	granted_at timestamptz not null default now()
);

create index if not exists power_grants_profile on public.power_grants (profile_id);

alter table public.custom_powers enable row level security;
alter table public.power_grants enable row level security;
revoke all on public.custom_powers from anon, authenticated;
revoke all on public.power_grants from anon, authenticated;
grant select on public.custom_powers to authenticated;
grant select on public.power_grants to authenticated;

-- Players see their own grants and the powers granted to them; admins see everything.
drop policy if exists "own power grants or admin" on public.power_grants;
create policy "own power grants or admin" on public.power_grants
	for select to authenticated using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "granted powers or admin" on public.custom_powers;
create policy "granted powers or admin" on public.custom_powers
	for select to authenticated using (
		(select public.is_admin())
		or exists (select 1 from public.power_grants g where g.power_id = custom_powers.id and g.profile_id = (select auth.uid()))
	);

-- Admins: create (p_id null) or change a power. Returns its id.
create or replace function public.save_custom_power(p_id uuid, p_name text, p_system text, p_ability jsonb, p_description text, p_drawbacks text, p_tree jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	pid uuid;
begin
	if not public.is_admin() then
		raise exception 'Only admins can build powers.' using errcode = '42501';
	end if;
	if length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
		raise exception 'Give the power a name (up to 100 characters).' using errcode = '22023';
	end if;
	if jsonb_typeof(p_ability) <> 'object' or jsonb_typeof(p_ability -> 'fields') <> 'object' then
		raise exception 'The power needs its card.' using errcode = '22023';
	end if;
	if p_id is null then
		insert into public.custom_powers (name, system, ability, description, drawbacks, tree, created_by)
		values (btrim(p_name), p_system, p_ability, coalesce(p_description, ''), coalesce(p_drawbacks, ''), case when jsonb_typeof(p_tree) = 'object' then p_tree end, auth.uid())
		returning id into pid;
	else
		update public.custom_powers
		set name = btrim(p_name), system = p_system, ability = p_ability, description = coalesce(p_description, ''),
			drawbacks = coalesce(p_drawbacks, ''), tree = case when jsonb_typeof(p_tree) = 'object' then p_tree end, updated_at = now()
		where id = p_id
		returning id into pid;
		if pid is null then
			raise exception 'That power doesn''t exist.' using errcode = 'P0002';
		end if;
	end if;
	return pid;
end;
$$;

-- Admins: delete a power and its unused grants. Cards already on characters stay as they are.
create or replace function public.delete_custom_power(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can delete powers.' using errcode = '42501';
	end if;
	delete from public.custom_powers where id = p_id;
end;
$$;

-- Admins: grant a power to a player's account. They add it as a card themselves.
create or replace function public.grant_power(p_power uuid, p_profile uuid, p_note text default '')
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
	insert into public.power_grants (power_id, profile_id, note, granted_by)
	values (p_power, p_profile, coalesce(p_note, ''), auth.uid())
	returning id into gid;
	return gid;
end;
$$;

-- Admins: grant a power straight onto a character. p_card is the card built from the power
-- (the site builds it with the card's defaults); it's added to the sheet and, once approved, to
-- the approved sheet as well.
create or replace function public.grant_power_to_character(p_power uuid, p_character uuid, p_card jsonb, p_note text default '')
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	gid bigint;
	card jsonb;
begin
	if not public.is_admin() then
		raise exception 'Only admins can grant powers.' using errcode = '42501';
	end if;
	if not exists (select 1 from public.custom_powers where id = p_power) then
		raise exception 'That power doesn''t exist.' using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_card) <> 'object' or p_card #>> '{powerLink,powerId}' is distinct from p_power::text or coalesce(p_card ->> 'key', '') = '' then
		raise exception 'That card isn''t built from this power.' using errcode = '22023';
	end if;
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null then
		raise exception 'That character doesn''t exist.' using errcode = 'P0002';
	end if;

	insert into public.power_grants (power_id, profile_id, character_id, card_key, used_at, note, granted_by)
	values (p_power, ch.owner_id, ch.id, p_card ->> 'key', now(), coalesce(p_note, ''), auth.uid())
	returning id into gid;
	card := jsonb_set(p_card, '{powerLink,grantId}', to_jsonb(gid));

	update public.characters
	set sheet = public.sheet_with_card(sheet, card),
		approved_sheet = case when approved_sheet is null then null else public.sheet_with_card(approved_sheet, card) end
	where id = ch.id;
	return gid;
end;
$$;

-- A sheet with one more power-system card (it becomes the priority system if it's the only one).
create or replace function public.sheet_with_card(p_sheet jsonb, p_card jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select jsonb_set(
		jsonb_set(coalesce(p_sheet, '{}'), '{systems}', (case when jsonb_typeof(p_sheet -> 'systems') = 'array' then p_sheet -> 'systems' else '[]' end) || jsonb_build_array(p_card)),
		'{prioritySystem}',
		case when coalesce(p_sheet ->> 'prioritySystem', '') = '' then to_jsonb(p_card ->> 'key') else p_sheet -> 'prioritySystem' end
	);
$$;

-- A sheet without the card that holds this grant.
create or replace function public.sheet_without_grant(p_sheet jsonb, p_grant bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
	kept jsonb;
	s jsonb := p_sheet;
begin
	if p_sheet is null or jsonb_typeof(p_sheet -> 'systems') <> 'array' then
		return p_sheet;
	end if;
	select coalesce(jsonb_agg(e), '[]') into kept
	from jsonb_array_elements(p_sheet -> 'systems') e
	where (e #>> '{powerLink,grantId}') is distinct from p_grant::text;
	s := jsonb_set(s, '{systems}', kept);
	if not exists (select 1 from jsonb_array_elements(kept) e where e ->> 'key' = s ->> 'prioritySystem') then
		s := jsonb_set(s, '{prioritySystem}', to_jsonb(coalesce(kept -> 0 ->> 'key', '')));
	end if;
	return s;
end;
$$;

-- Admins: take a grant back. p_remove_card also takes its card off the character.
create or replace function public.revoke_power_grant(p_grant bigint, p_remove_card boolean default false)
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
	select * into g from public.power_grants where id = p_grant;
	if g.id is null then
		return;
	end if;
	if p_remove_card then
		update public.characters
		set sheet = public.sheet_without_grant(sheet, g.id),
			approved_sheet = public.sheet_without_grant(approved_sheet, g.id)
		where id = g.character_id
			or (owner_id = g.profile_id and jsonb_typeof(sheet -> 'systems') = 'array' and exists (
				select 1 from jsonb_array_elements(sheet -> 'systems') e where e #>> '{powerLink,grantId}' = g.id::text
			));
	end if;
	delete from public.power_grants where id = g.id;
end;
$$;

-- Admins: every grant of a power, or of a player's account, with names.
create or replace function public.power_grants_list(p_power uuid default null, p_profile uuid default null)
returns table (id bigint, power_id uuid, power_name text, profile_id uuid, player_name text, character_id uuid, character_name text, card_key text, used_at timestamptz, note text, granted_at timestamptz)
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
		select g.id, g.power_id, p.name, g.profile_id, pr.display_name, g.character_id, c.name, g.card_key, g.used_at, g.note, g.granted_at
		from public.power_grants g
		join public.custom_powers p on p.id = g.power_id
		left join public.profiles pr on pr.id = g.profile_id
		left join public.characters c on c.id = g.character_id
		where (p_power is null or g.power_id = p_power) and (p_profile is null or g.profile_id = p_profile)
		order by g.granted_at desc;
end;
$$;

-- A character approved with a granted power's card uses up that grant (its owner's, still unused).
create or replace function public.use_power_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	e jsonb;
begin
	if new.status <> 'approved' or old.status = 'approved' or jsonb_typeof(new.sheet -> 'systems') <> 'array' then
		return new;
	end if;
	for e in select * from jsonb_array_elements(new.sheet -> 'systems') loop
		if jsonb_typeof(e #> '{powerLink,grantId}') = 'number' then
			update public.power_grants
			set character_id = new.id, card_key = e ->> 'key', used_at = now()
			where id = (e #>> '{powerLink,grantId}')::bigint and profile_id = new.owner_id and character_id is null;
		end if;
	end loop;
	return new;
end;
$$;

drop trigger if exists use_power_grants on public.characters;
create trigger use_power_grants after update of status on public.characters
	for each row execute function public.use_power_grants();

revoke execute on function public.save_custom_power(uuid, text, text, jsonb, text, text, jsonb) from public, anon;
revoke execute on function public.delete_custom_power(uuid) from public, anon;
revoke execute on function public.grant_power(uuid, uuid, text) from public, anon;
revoke execute on function public.grant_power_to_character(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.revoke_power_grant(bigint, boolean) from public, anon;
revoke execute on function public.power_grants_list(uuid, uuid) from public, anon;
revoke execute on function public.sheet_with_card(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.sheet_without_grant(jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.use_power_grants() from public, anon, authenticated;
grant execute on function public.save_custom_power(uuid, text, text, jsonb, text, text, jsonb) to authenticated;
grant execute on function public.delete_custom_power(uuid) to authenticated;
grant execute on function public.grant_power(uuid, uuid, text) to authenticated;
grant execute on function public.grant_power_to_character(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.revoke_power_grant(bigint, boolean) to authenticated;
grant execute on function public.power_grants_list(uuid, uuid) to authenticated;
