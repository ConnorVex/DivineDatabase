-- The Inheritance: characters join a family only by being made for it.
--
-- A player starts a new character from an Open family's page. Its sheet carries
-- sheet.inheritance = { familyId, picks, options, potential }:
--   * picks: the "Members can pick it" perks they took (perk ids)
--   * options: System rules options they start with ("<perk id>|<field>=<value>")
--   * potential: a Potential they picked, when the family's Trait rules allow it
-- Rolled perks (and rolled System rules options) are asked for in family_inheritance_rolls,
-- and the family's owner (or an admin) rolls them. The owner then reviews the finished
-- character like before (is_family_reviewer reads sheet.families).
--
-- Existing characters can't join anymore: a player's own join request is refused, and a new
-- character's sheet.families is always just its inheritance family.

-- ───────────────────────────── Rolls ─────────────────────────────

create table if not exists public.family_inheritance_rolls (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	character_id uuid not null references public.characters (id) on delete cascade,
	player_id uuid not null references public.profiles (id) on delete cascade,
	-- The character's name when it was asked, for the owner (who can't read drafts).
	character_name text not null default '' check (char_length(character_name) <= 100),
	perk_id uuid not null references public.family_perks (id) on delete cascade,
	-- '' for a Rolled perk, '<field>=<value>' for a rolled System rules option.
	option text not null default '' check (char_length(option) <= 200),
	label text not null default '' check (char_length(label) <= 300),
	status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
	proof text not null default '' check (proof = '' or proof ~ '^https://'),
	note text not null default '' check (char_length(note) <= 500),
	created_at timestamptz not null default now(),
	decided_at timestamptz,
	decided_by uuid references public.profiles (id) on delete set null,
	unique (character_id, perk_id, option)
);
create index if not exists family_inheritance_rolls_family on public.family_inheritance_rolls (family_id, status);

alter table public.family_inheritance_rolls enable row level security;
drop policy if exists "inheritance rolls readable" on public.family_inheritance_rolls;
create policy "inheritance rolls readable" on public.family_inheritance_rolls
	for select to authenticated using (player_id = auth.uid() or public.is_family_owner(family_id) or public.is_admin());
-- Every write goes through the functions below.
revoke insert, update, delete on public.family_inheritance_rolls from anon, authenticated;
grant select on public.family_inheritance_rolls to authenticated;

-- ───────────────────────────── What a sheet inherits ─────────────────────────────

-- Whether this character inherits the perk: Guaranteed, picked, or a won roll.
create or replace function public.inherits_perk(p_sheet jsonb, p_character uuid, p_perk public.family_perks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select p_perk.status = 'approved'
		and jsonb_typeof(p_sheet -> 'inheritance') = 'object'
		and p_perk.family_id::text = p_sheet #>> '{inheritance,familyId}'
		and (
			p_perk.access = 'automatic'
			or (p_perk.access = 'choice' and coalesce(p_sheet #> '{inheritance,picks}', '[]') ? p_perk.id::text)
			or (p_perk.access = 'rolled' and exists (
				select 1 from public.family_inheritance_rolls r
				where r.character_id = p_character and r.perk_id = p_perk.id and r.option = '' and r.status = 'won'))
		);
$$;

-- The Potential the sheet picked, when an inherited Trait rules perk allows it; null otherwise.
create or replace function public.inherited_potential(p_sheet jsonb, p_character uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select p_sheet #>> '{inheritance,potential}'
	where coalesce(p_sheet #>> '{inheritance,potential}', '') <> ''
		and exists (
			select 1 from public.family_perks p
			where p.kind = 'trait_slots'
				and coalesce(p.details #> '{traitRules,potentials}', '[]') ? (p_sheet #>> '{inheritance,potential}')
				and public.inherits_perk(p_sheet, p_character, p)
		);
$$;

-- A Cursed Energy class the family gives instead of the usual roll: an inherited Jujutsu Kaisen
-- System rules option for ceClass that the player starts with, or a rolled one the owner won.
-- Returns { class, detail } or null.
create or replace function public.inherited_ce(p_sheet jsonb, p_character uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select jsonb_build_object('class', o ->> 'value', 'detail', coalesce(o ->> 'detail', ''))
	from public.family_perks p,
		jsonb_array_elements(coalesce(p.details #> '{systemRules,options}', '[]')) o
	where p.kind = 'system_start'
		and p.details #>> '{systemRules,system}' = 'jujutsu-kaisen'
		and o ->> 'field' = 'ceClass'
		and public.inherits_perk(p_sheet, p_character, p)
		and (
			(o ->> 'access' = 'start' and coalesce(p_sheet #> '{inheritance,options}', '[]') ? (p.id::text || '|ceClass=' || (o ->> 'value')))
			or (o ->> 'access' = 'rolled' and exists (
				select 1 from public.family_inheritance_rolls r
				where r.character_id = p_character and r.perk_id = p.id and r.option = 'ceClass=' || (o ->> 'value') and r.status = 'won'))
		)
	-- A won roll beats a value the player simply starts with.
	order by (o ->> 'access') = 'rolled' desc, p.sort, p.created_at
	limit 1;
$$;

-- As before (rolls always win), except a family's Inheritance can set the Potential and the
-- Cursed Energy class instead of the usual rolls.
create or replace function public.apply_rolls(sheet jsonb, char_id uuid, blank_missing boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	pot jsonb;
	ce jsonb;
	fam_pot text;
	fam_ce jsonb;
	systems jsonb;
begin
	select result into pot from public.player_rolls
	where character_id = char_id and kind = 'potential' and status <> 'void'
	order by created_at desc limit 1;
	select result into ce from public.player_rolls
	where character_id = char_id and kind = 'cursed_energy' and status <> 'void'
	order by created_at desc limit 1;

	if jsonb_typeof(sheet) <> 'object' then sheet := '{}'::jsonb; end if;

	if jsonb_typeof(sheet -> 'inheritance') = 'object' then
		fam_pot := public.inherited_potential(sheet, char_id);
		fam_ce := public.inherited_ce(sheet, char_id);
	end if;

	if fam_pot is not null then
		sheet := jsonb_set(
			sheet, '{potential}',
			coalesce(case when jsonb_typeof(sheet -> 'potential') = 'object' then sheet -> 'potential' end, '{}'::jsonb)
				|| jsonb_build_object('grade', fam_pot, 'roll', null)
		);
	elsif pot is not null or blank_missing then
		sheet := jsonb_set(
			sheet, '{potential}',
			coalesce(case when jsonb_typeof(sheet -> 'potential') = 'object' then sheet -> 'potential' end, '{}'::jsonb)
				|| jsonb_build_object('grade', coalesce(pot ->> 'grade', ''), 'roll', pot -> 'roll')
		);
	end if;

	if jsonb_typeof(sheet -> 'systems') = 'array' and (ce is not null or fam_ce is not null or blank_missing) then
		select coalesce(jsonb_agg(
			case when e ->> 'system' = 'jujutsu-kaisen' then
				e || jsonb_build_object('fields',
					coalesce(case when jsonb_typeof(e -> 'fields') = 'object' then e -> 'fields' end, '{}'::jsonb)
						|| case when fam_ce is not null
							then jsonb_build_object('ceClass', fam_ce ->> 'class', 'ceAmount', null, 'ceLevel', fam_ce ->> 'detail')
							else jsonb_build_object('ceClass', coalesce(ce ->> 'class', ''), 'ceAmount', ce -> 'cep', 'ceLevel', ce -> 'level') end)
			else e end
			order by ord), '[]'::jsonb)
		into systems
		from jsonb_array_elements(sheet -> 'systems') with ordinality as x (e, ord);
		sheet := jsonb_set(sheet, '{systems}', systems);
	end if;

	return sheet;
end;
$$;

-- ───────────────────────────── Asking for and deciding rolls ─────────────────────────────

-- The player asks the family's owner to roll a Rolled perk (p_option '') or a rolled System
-- rules option ('<field>=<value>') for their new inheritance character.
create or replace function public.request_inheritance_roll(p_character uuid, p_perk uuid, p_option text default '')
returns public.family_inheritance_rolls
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	p public.family_perks;
	f public.families;
	opt jsonb;
	label text;
	asked public.family_inheritance_rolls;
	owner_discord text;
begin
	select * into c from public.characters where id = p_character;
	if c.id is null or c.owner_id is distinct from auth.uid() then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if c.approved_at is not null or c.status not in ('draft', 'pending', 'needs_correction') then
		raise exception 'Rolls are for new characters only.' using errcode = 'P0001';
	end if;
	select * into p from public.family_perks where id = p_perk;
	if p.id is null or p.status <> 'approved' or p.family_id::text is distinct from c.sheet #>> '{inheritance,familyId}' then
		raise exception 'That perk isn''t part of this character''s inheritance.' using errcode = 'P0001';
	end if;
	select * into f from public.families where id = p.family_id;
	if f.status <> 'approved' or f.recruiting <> 'open' then
		raise exception '% is closed to new members right now.', f.name using errcode = 'P0001';
	end if;

	p_option := coalesce(btrim(p_option), '');
	if p_option = '' then
		if p.access <> 'rolled' then
			raise exception '% isn''t rolled for.', p.title using errcode = 'P0001';
		end if;
		label := p.title;
	else
		select o into opt
		from jsonb_array_elements(coalesce(p.details #> '{systemRules,options}', '[]')) o
		where (o ->> 'field') || '=' || (o ->> 'value') = p_option and o ->> 'access' = 'rolled'
			and public.inherits_perk(c.sheet, c.id, p)
		limit 1;
		if opt is null then
			raise exception 'That option isn''t rolled for.' using errcode = 'P0001';
		end if;
		label := p.title || ': ' || (opt ->> 'value') || case when coalesce(opt ->> 'detail', '') <> '' then ' (' || (opt ->> 'detail') || ')' else '' end;
	end if;

	perform public.ensure_profile();
	insert into public.family_inheritance_rolls (family_id, character_id, player_id, character_name, perk_id, option, label)
	values (f.id, c.id, auth.uid(), left(c.name, 100), p.id, p_option, left(label, 300))
	on conflict (character_id, perk_id, option) do nothing
	returning * into asked;
	if asked.id is null then
		select * into asked from public.family_inheritance_rolls where character_id = c.id and perk_id = p.id and option = p_option;
		return asked;
	end if;

	-- Ping the owner.
	select pr.discord_id into owner_discord from public.profiles pr where pr.id = f.owner_id;
	if owner_discord is not null and f.owner_id is distinct from auth.uid() then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', '<@' || owner_discord || '>, **' || public.discord_escape(coalesce(nullif(c.name, ''), 'A new character'))
				|| '** asks you to roll **' || public.discord_escape(label) || '** for **' || public.discord_escape(f.name)
				|| '**. Roll it on the family''s page in the Divine Database (Manage family → Inheritance).',
			'allowed_mentions', jsonb_build_object('users', jsonb_build_array(owner_discord))
		));
	end if;
	return asked;
end;
$$;

-- The player takes back a roll that's still waiting.
create or replace function public.withdraw_inheritance_roll(p_roll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	delete from public.family_inheritance_rolls where id = p_roll and player_id = auth.uid() and status = 'pending';
	if not found then
		raise exception 'Only a roll that''s still waiting can be taken back.' using errcode = 'P0001';
	end if;
end;
$$;

-- The owner (or an admin) records the roll. It can be changed until the character is approved.
create or replace function public.decide_inheritance_roll(p_roll uuid, p_won boolean, p_proof text default '', p_note text default '')
returns public.family_inheritance_rolls
language plpgsql
security definer
set search_path = ''
as $$
declare
	r public.family_inheritance_rolls;
	approved timestamptz;
	player_discord text;
begin
	select * into r from public.family_inheritance_rolls where id = p_roll for update;
	if r.id is null or not (public.is_family_owner(r.family_id) or public.is_admin()) then
		raise exception 'Only the family''s owner can roll this.' using errcode = '42501';
	end if;
	select approved_at into approved from public.characters where id = r.character_id;
	if approved is not null then
		raise exception 'That character is already approved.' using errcode = 'P0001';
	end if;
	if coalesce(btrim(p_proof), '') <> '' and btrim(p_proof) !~ '^https://' then
		raise exception 'The roll link must start with https://' using errcode = 'P0001';
	end if;

	perform public.ensure_profile();
	update public.family_inheritance_rolls
	set status = case when p_won then 'won' else 'lost' end,
		proof = coalesce(btrim(p_proof), ''),
		note = left(coalesce(btrim(p_note), ''), 500),
		decided_at = now(),
		decided_by = auth.uid()
	where id = p_roll
	returning * into r;

	select pr.discord_id into player_discord from public.profiles pr where pr.id = r.player_id;
	if player_discord is not null then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', '<@' || player_discord || '>, the roll for **' || public.discord_escape(r.label) || '** ('
				|| public.discord_escape(coalesce(nullif(r.character_name, ''), 'your character')) || ') '
				|| case when p_won then 'was a success ✅' else 'didn''t land ❌' end || '.',
			'allowed_mentions', jsonb_build_object('users', jsonb_build_array(player_discord))
		));
	end if;
	return r;
end;
$$;

-- ───────────────────────────── Joining only through the Inheritance ─────────────────────────────

-- A new character's families are just its inheritance family; an approved character keeps
-- the families it has (an evolution can't add one). Starting or sending an inheritance
-- character needs the family to be approved and Open.
create or replace function public.guard_inheritance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	fid text := new.sheet #>> '{inheritance,familyId}';
begin
	if jsonb_typeof(new.sheet) <> 'object' then
		return new;
	end if;
	if new.approved_at is not null then
		if tg_op = 'UPDATE' then
			new.sheet := jsonb_set(new.sheet, '{families}', coalesce(old.sheet -> 'families', '[]'::jsonb));
		end if;
		return new;
	end if;

	if fid is null or jsonb_typeof(new.sheet -> 'inheritance') <> 'object' then
		new.sheet := jsonb_set(new.sheet, '{families}', '[]'::jsonb);
		return new;
	end if;

	select * into fam from public.families where id::text = fid;
	if fam.id is null or fam.status <> 'approved' then
		raise exception 'That family isn''t taking new members.' using errcode = 'P0001';
	end if;
	-- Starting one, or sending it in, needs the family to be Open (saving a draft later doesn't).
	if fam.recruiting <> 'open' and (
		tg_op = 'INSERT'
		or (new.status = 'pending' and old.status is distinct from 'pending')
		or old.sheet #>> '{inheritance,familyId}' is distinct from fid
	) then
		raise exception '% is closed to new members right now.', fam.name using errcode = 'P0001';
	end if;
	new.sheet := jsonb_set(new.sheet, '{families}', jsonb_build_array(fid));
	return new;
end;
$$;

drop trigger if exists guard_inheritance on public.characters;
create trigger guard_inheritance
	before insert or update of sheet, status on public.characters
	for each row execute function public.guard_inheritance();

-- As before, minus the player's own join request (and tryouts, which are gone).
create or replace function public.guard_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	manager boolean := public.is_admin() or public.is_family_owner(new.family_id);
begin
	if tg_op = 'UPDATE' then
		new.family_id := old.family_id;
		new.character_id := old.character_id;
		new.requested_by := old.requested_by;
		new.created_at := old.created_at;
		return new;
	end if;

	if new.character_id is not null then
		select * into ch from public.characters where id = new.character_id;
		if ch.id is null or ch.approved_at is null or ch.status = 'denied' then
			raise exception 'Only approved characters can join a family.' using errcode = '42501';
		end if;
		new.name := coalesce(nullif(ch.approved_name, ''), ch.name);
		-- review_character adds an inheritance character to its family when it's approved.
		if coalesce(current_setting('portal.family_join', true), '') = 'on' then
			return new;
		end if;
		if ch.owner_id = auth.uid() and public.is_family_owner(new.family_id) then
			-- The owner adding their own character joins straight away.
			new.status := 'active';
			new.requested_by := auth.uid();
			return new;
		elsif not public.is_admin() then
			raise exception 'Characters can''t join a family after they''re made. Start a new character from the family''s page.' using errcode = '42501';
		end if;
		new.requested_by := coalesce(new.requested_by, ch.owner_id);
		return new;
	end if;

	-- A typed-in roster name: owners and admins only, always active.
	if not manager then
		raise exception 'Only the family''s owner can add roster names.' using errcode = '42501';
	end if;
	new.status := 'active';
	return new;
end;
$$;

-- ───────────────────────────── Permissions ─────────────────────────────

revoke execute on function public.inherits_perk(jsonb, uuid, public.family_perks) from public, anon, authenticated;
revoke execute on function public.inherited_potential(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.inherited_ce(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.apply_rolls(jsonb, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.request_inheritance_roll(uuid, uuid, text) from public, anon;
revoke execute on function public.withdraw_inheritance_roll(uuid) from public, anon;
revoke execute on function public.decide_inheritance_roll(uuid, boolean, text, text) from public, anon;
grant execute on function public.request_inheritance_roll(uuid, uuid, text) to authenticated;
grant execute on function public.withdraw_inheritance_roll(uuid) to authenticated;
grant execute on function public.decide_inheritance_roll(uuid, boolean, text, text) to authenticated;
