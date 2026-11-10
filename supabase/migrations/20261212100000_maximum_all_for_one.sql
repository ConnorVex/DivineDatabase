-- Maximum All For One (M:AFO): a custom Quirk that steals Quirks, Abilities and Conduits from other
-- characters, stores them, and gives them to others. Only Tatsuya grants it (Full, or a Weaker one:
-- half the storage, no upgrades, at most 2 at a time) and only Tatsuya can let a holder steal and
-- transfer without approval. Otherwise every steal and transfer waits for an admin.
--
-- A steal takes the card off the other character's sheet and into the holder's storage and gives
-- MQP (Meta Quirk Points, not affected by traits). A transfer puts a stored power on another
-- character as an extra card. Stolen Abilities decay 3 RP after the steal (1 RP = 1 day; +2 per
-- Ability Preservation upgrade, never with Ability Stabilization). Over capacity is Singularity.
-- Storage upgrades are the M:AFO skill tree, bought with MQP.

-- ───────────────────────────── Tables ─────────────────────────────

create table if not exists public.mafo_holders (
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	weaker boolean not null default false,
	-- Tatsuya lets this holder steal and transfer without approval.
	free_actions boolean not null default false,
	granted_by uuid references public.profiles (id) on delete set null,
	granted_at timestamptz not null default now(),
	primary key (character_id, card_key)
);

create table if not exists public.mafo_items (
	id bigint generated always as identity primary key,
	holder_character uuid not null,
	holder_card text not null,
	kind text not null check (kind in ('quirk', 'ability', 'conduit')),
	tier text not null,
	slots int not null,
	mqp int not null,
	name text not null default '',
	-- Where it came from, and the card as it was.
	source_character uuid references public.characters (id) on delete set null,
	source_name text not null default '',
	card jsonb not null,
	status text not null default 'stored' check (status in ('stored', 'transferred')),
	stolen_at timestamptz not null default now(),
	transferred_to uuid references public.characters (id) on delete set null,
	transferred_at timestamptz,
	foreign key (holder_character, holder_card) references public.mafo_holders (character_id, card_key) on delete cascade
);
create index if not exists mafo_items_holder on public.mafo_items (holder_character, holder_card);

create table if not exists public.mafo_requests (
	id bigint generated always as identity primary key,
	holder_character uuid not null,
	holder_card text not null,
	action text not null check (action in ('steal', 'transfer')),
	-- Steal: whose card. Transfer: which stored power, and to whom.
	victim_character uuid references public.characters (id) on delete cascade,
	victim_card text,
	item_id bigint references public.mafo_items (id) on delete cascade,
	target_character uuid references public.characters (id) on delete cascade,
	note text not null default '',
	status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
	reason text not null default '',
	requested_by uuid references public.profiles (id) on delete set null,
	requested_at timestamptz not null default now(),
	decided_by uuid references public.profiles (id) on delete set null,
	decided_at timestamptz,
	foreign key (holder_character, holder_card) references public.mafo_holders (character_id, card_key) on delete cascade
);

alter table public.mafo_holders enable row level security;
alter table public.mafo_items enable row level security;
alter table public.mafo_requests enable row level security;
-- Nobody reads these directly: mafo_state() and the admin functions hand them out.
revoke all on public.mafo_holders from anon, authenticated;
revoke all on public.mafo_items from anon, authenticated;
revoke all on public.mafo_requests from anon, authenticated;

-- MQP: spent on the M:AFO tree. Only Full M:AFO cards (the card's "mafo" field) have it.
insert into public.point_currencies (code, system, label, earn, field, show_if, sort) values
	('MQP', 'quirk', 'Meta Quirk Points', 0, null, '{"key": "mafo", "in": ["Full"]}'::jsonb, 21)
on conflict (code) do update set system = excluded.system, label = excluded.label, earn = excluded.earn, field = excluded.field, show_if = excluded.show_if, sort = excluded.sort;

alter table public.point_ledger drop constraint if exists point_ledger_source_check;
alter table public.point_ledger add constraint point_ledger_source_check
	check (source in ('training', 'convert', 'staff', 'sheet', 'unlock', 'refund', 'mafo'));

-- ───────────────────────────── The M:AFO skill tree ─────────────────────────────

insert into public.skill_trees (id, system, label, show_if, sort) values
	('mha-mafo', 'quirk', 'Maximum All For One', '{"key": "mafo", "in": ["Full"]}'::jsonb, 20)
on conflict (id) do update set system = excluded.system, label = excluded.label, show_if = excluded.show_if, sort = excluded.sort;

delete from public.skill_tree_nodes where tree_id = 'mha-mafo';
insert into public.skill_tree_nodes (tree_id, id, label, cost_amount, cost_currency, requires, start, description, sort)
select 'mha-mafo', n.id, n.label, n.cost, case when n.cost is null then null else 'MQP' end, n.requires, n.cost is null, n.description, n.sort
from (values
	('mafo', 'Maximum: All For One', null::int, '{}'::text[], 'Steals Quirks, Abilities and Conduits, stores them and gives them to others.', 0),
	('base-quirk-storage', 'Base Quirk Storage', null, '{mafo}', '100 Quirk slots.', 1),
	('base-ability-storage', 'Base Ability Storage', null, '{mafo}', '50 Ability slots.', 2),
	('base-ability-decay', 'Base Ability Decay', null, '{mafo}', 'Stolen Abilities decay 3 RP after the steal.', 3),
	('base-conduit-storage', 'Base Conduit Storage', null, '{mafo}', '86 Conduit slots.', 4),
	('conduit-transference', 'Conduit Transference', 120, '{mafo}', 'Stored Conduits can be given to others.', 5),
	('quirk-storage-1', 'Quirk Storage Upgrade 1', 10, '{base-quirk-storage}', '+20 Quirk slots.', 10),
	('quirk-storage-2', 'Quirk Storage Upgrade 2', 15, '{quirk-storage-1}', '+20 Quirk slots.', 11),
	('quirk-storage-3', 'Quirk Storage Upgrade 3', 20, '{quirk-storage-2}', '+20 Quirk slots.', 12),
	('quirk-storage-4', 'Quirk Storage Upgrade 4', 25, '{quirk-storage-3}', '+20 Quirk slots.', 13),
	('quirk-storage-5', 'Quirk Storage Upgrade 5', 30, '{quirk-storage-4}', '+20 Quirk slots.', 14),
	('quirk-storage-6', 'Quirk Storage Upgrade 6', 35, '{quirk-storage-5}', '+20 Quirk slots.', 15),
	('quirk-storage-7', 'Quirk Storage Upgrade 7', 40, '{quirk-storage-6}', '+20 Quirk slots.', 16),
	('quirk-storage-8', 'Quirk Storage Upgrade 8', 45, '{quirk-storage-7}', '+20 Quirk slots.', 17),
	('quirk-storage-9', 'Quirk Storage Upgrade 9', 50, '{quirk-storage-8}', '+20 Quirk slots.', 18),
	('quirk-storage-max', 'Quirk Storage Max Upgrade', 100, '{quirk-storage-9}', '+50 Quirk slots.', 19),
	('ability-storage-1', 'Ability Storage Upgrade 1', 10, '{base-ability-storage}', '+10 Ability slots.', 20),
	('ability-storage-2', 'Ability Storage Upgrade 2', 20, '{ability-storage-1}', '+10 Ability slots.', 21),
	('ability-storage-3', 'Ability Storage Upgrade 3', 30, '{ability-storage-2}', '+10 Ability slots.', 22),
	('ability-storage-4', 'Ability Storage Upgrade 4', 40, '{ability-storage-3}', '+10 Ability slots.', 23),
	('ability-storage-5', 'Ability Storage Upgrade 5', 50, '{ability-storage-4}', '+10 Ability slots.', 24),
	('ability-storage-6', 'Ability Storage Upgrade 6', 60, '{ability-storage-5}', '+10 Ability slots.', 25),
	('ability-storage-7', 'Ability Storage Upgrade 7', 70, '{ability-storage-6}', '+10 Ability slots.', 26),
	('ability-storage-8', 'Ability Storage Upgrade 8', 80, '{ability-storage-7}', '+10 Ability slots.', 27),
	('ability-storage-9', 'Ability Storage Upgrade 9', 90, '{ability-storage-8}', '+10 Ability slots.', 28),
	('ability-storage-max', 'Ability Storage Max Upgrade', 100, '{ability-storage-9}', '+40 Ability slots.', 29),
	('conduit-storage-1', 'Conduit Storage Upgrade 1', 20, '{base-conduit-storage}', '+5 Conduit slots.', 30),
	('conduit-storage-2', 'Conduit Storage Upgrade 2', 40, '{conduit-storage-1}', '+5 Conduit slots.', 31),
	('conduit-storage-3', 'Conduit Storage Upgrade 3', 60, '{conduit-storage-2}', '+5 Conduit slots.', 32),
	('conduit-storage-4', 'Conduit Storage Upgrade 4', 80, '{conduit-storage-3}', '+5 Conduit slots.', 33),
	('conduit-storage-max', 'Max Conduit Storage Upgrade', 100, '{conduit-storage-4}', '+30 Conduit slots.', 34),
	('ability-preservation-1', 'Ability Preservation Upgrade 1', 30, '{base-ability-decay}', '+2 RP before a stolen Ability decays.', 40),
	('ability-preservation-2', 'Ability Preservation Upgrade 2', 60, '{ability-preservation-1}', '+2 RP before a stolen Ability decays.', 41),
	('ability-preservation-3', 'Ability Preservation Upgrade 3', 90, '{ability-preservation-2}', '+2 RP before a stolen Ability decays.', 42),
	('ability-preservation-4', 'Ability Preservation Upgrade 4', 90, '{ability-preservation-3}', '+2 RP before a stolen Ability decays.', 43),
	('ability-stabilization', 'Ability Stabilization Upgrade', 100, '{ability-preservation-4}', 'Stolen Abilities no longer decay.', 44),
	('infinite-capacity', 'Infinite Capacity', 200, '{quirk-storage-max,ability-storage-max}', 'No storage limits, so no Singularity.', 50)
) as n (id, label, cost, requires, description, sort);


-- M:AFO is itself the Maximum Variant: its card never rolls Instability or Spontaneous Evolution.
create or replace function public.guard_mafo_rolls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.kind in ('quirk_instability', 'quirk_evolution') and exists (select 1 from public.mafo_holders where character_id = new.character_id and card_key = new.card_key) then
		raise exception 'Maximum All For One is already the Maximum Variant. It can''t go through Instability.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

drop trigger if exists guard_mafo_rolls on public.evolution_rolls;
create trigger guard_mafo_rolls before insert on public.evolution_rolls
	for each row execute function public.guard_mafo_rolls();

-- ───────────────────────────── Rules ─────────────────────────────

-- Only Tatsuya grants M:AFO and lets holders act without approval.
create or replace function public.can_grant_mafo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from auth.identities i
		where i.user_id = auth.uid() and i.provider = 'discord' and i.provider_id = '530159153482694666'
	);
$$;

-- What a card is worth to M:AFO: { kind, tier, slots, mqp, name }, or { error } when it can't be taken.
create or replace function public.mafo_classify(p_card jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
	f jsonb := coalesce(p_card -> 'fields', '{}');
	sys text := p_card ->> 'system';
	nm text := coalesce(nullif(btrim(p_card #>> '{powerLink,title}'), ''), nullif(btrim(f ->> 'name'), ''), '');
	v text;
	classes text[];
begin
	if sys = 'quirk' then
		if coalesce(f ->> 'mafo', '') <> '' then
			return jsonb_build_object('error', 'M:AFO can''t take another M:AFO.');
		end if;
		v := coalesce(nullif(f ->> 'variant', ''), 'None');
		return case v
			when 'Plus' then jsonb_build_object('kind', 'quirk', 'tier', 'Plus', 'slots', 2, 'mqp', 2)
			when 'Maximum' then jsonb_build_object('kind', 'quirk', 'tier', 'Maximum', 'slots', 3, 'mqp', 4)
			when 'Infinite' then jsonb_build_object('kind', 'quirk', 'tier', 'Infinite', 'slots', 50, 'mqp', 10)
			else jsonb_build_object('kind', 'quirk', 'tier', 'Regular', 'slots', 1, 'mqp', 1)
		end || jsonb_build_object('name', coalesce(nullif(nm, ''), 'Quirk'));
	elsif sys = 'abilities' then
		-- The site's classes against the M:AFO types: the highest one counts.
		classes := case when jsonb_typeof(f -> 'classes') = 'array' then array(select jsonb_array_elements_text(f -> 'classes')) else '{}' end;
		if 'God' = any (classes) then
			return jsonb_build_object('error', 'God class Abilities can''t be stolen.');
		end if;
		return case
			when 'Transformation' = any (classes) then jsonb_build_object('kind', 'ability', 'tier', 'Transformation', 'slots', 1, 'mqp', 15)
			when 'Manipulation' = any (classes) then jsonb_build_object('kind', 'ability', 'tier', 'Controller', 'slots', 1, 'mqp', 6)
			else jsonb_build_object('kind', 'ability', 'tier', 'Production', 'slots', 1, 'mqp', 3)
		end || jsonb_build_object('name', coalesce(nullif(nm, ''), 'Ability'));
	elsif sys = 'infamous' then
		v := coalesce(f ->> 'class', '');
		return case v
			when 'Elemental' then jsonb_build_object('kind', 'conduit', 'tier', 'Elemental', 'slots', 1, 'mqp', 5)
			when 'Energy' then jsonb_build_object('kind', 'conduit', 'tier', 'Energy', 'slots', 4, 'mqp', 10)
			when 'Psychic' then jsonb_build_object('kind', 'conduit', 'tier', 'Psychic', 'slots', 8, 'mqp', 20)
			when 'Meta' then jsonb_build_object('kind', 'conduit', 'tier', 'Meta', 'slots', 40, 'mqp', 30)
			when 'Quantum' then jsonb_build_object('kind', 'conduit', 'tier', 'Quantum', 'slots', 73, 'mqp', 50)
			when 'Biologically Enhanced' then jsonb_build_object('error', 'Biologically Enhanced Conduits can''t be stolen.')
			else jsonb_build_object('error', 'That Conduit has no class yet.')
		end || case when v in ('Elemental', 'Energy', 'Psychic', 'Meta', 'Quantum') then jsonb_build_object('name', coalesce(nullif(nm, ''), v || ' Conduit')) else '{}'::jsonb end;
	end if;
	return jsonb_build_object('error', 'M:AFO can only take Quirks, Abilities and Conduits.');
end;
$$;

-- A holder's storage and what its tree gives: capacity, decay and what it can do.
create or replace function public.mafo_capacity(p_character uuid, p_card text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	h public.mafo_holders;
	owned text[];
	n int;
	stab timestamptz;
begin
	select * into h from public.mafo_holders where character_id = p_character and card_key = p_card;
	if h.character_id is null then
		return null;
	end if;
	if h.weaker then
		return jsonb_build_object('quirk', 50, 'ability', 25, 'conduit', 43, 'unlimited', false, 'decayRp', 3, 'stableSince', null, 'conduitTransfer', false);
	end if;
	select coalesce(array_agg(node_id), '{}') into owned from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = 'mha-mafo';
	select created_at into stab from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = 'mha-mafo' and node_id = 'ability-stabilization';
	n := (select count(*) from unnest(owned) x where x like 'ability-preservation-%');
	return jsonb_build_object(
		'quirk', 100 + 20 * (select count(*) from unnest(owned) x where x ~ '^quirk-storage-[0-9]$') + case when 'quirk-storage-max' = any (owned) then 50 else 0 end,
		'ability', 50 + 10 * (select count(*) from unnest(owned) x where x ~ '^ability-storage-[0-9]$') + case when 'ability-storage-max' = any (owned) then 40 else 0 end,
		'conduit', 86 + 5 * (select count(*) from unnest(owned) x where x ~ '^conduit-storage-[0-9]$') + case when 'conduit-storage-max' = any (owned) then 30 else 0 end,
		'unlimited', 'infinite-capacity' = any (owned),
		'decayRp', 3 + 2 * n,
		'stableSince', stab,
		'conduitTransfer', 'conduit-transference' = any (owned)
	);
end;
$$;

-- Whether a stored Ability has decayed (1 RP = 1 day). Stabilization stops decay from when it was bought.
create or replace function public.mafo_decayed(i public.mafo_items, cap jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
	select i.kind = 'ability' and i.status = 'stored'
		and i.stolen_at + make_interval(days => coalesce((cap ->> 'decayRp')::int, 3)) < now()
		and (cap ->> 'stableSince' is null or (cap ->> 'stableSince')::timestamptz > i.stolen_at + make_interval(days => coalesce((cap ->> 'decayRp')::int, 3)));
$$;

-- ───────────────────────────── Tatsuya: grant ─────────────────────────────

-- Gives a character M:AFO. p_card is the M:AFO Quirk card the site builds; it's added to the sheet
-- (and the approved sheet) as an extra card. At most 2 Weaker M:AFOs at a time.
create or replace function public.grant_mafo(p_character uuid, p_card jsonb, p_weaker boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	ch public.characters;
begin
	if not public.can_grant_mafo() then
		raise exception 'Only Tatsuya can grant Maximum All For One.' using errcode = '42501';
	end if;
	if jsonb_typeof(p_card) <> 'object' or p_card ->> 'system' <> 'quirk' or coalesce(p_card ->> 'key', '') = ''
		or p_card #>> '{fields,mafo}' is distinct from (array['Full', 'Weaker'])[1 + coalesce(p_weaker, false)::int] then
		raise exception 'That isn''t an M:AFO card.' using errcode = '22023';
	end if;
	if p_weaker and (select count(*) from public.mafo_holders where weaker) >= 2 then
		raise exception 'There can only be 2 Weaker M:AFOs at a time.' using errcode = 'P0001';
	end if;
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null then
		raise exception 'That character doesn''t exist.' using errcode = 'P0002';
	end if;
	if exists (select 1 from public.mafo_holders where character_id = ch.id) then
		raise exception 'That character already has M:AFO.' using errcode = 'P0001';
	end if;
	insert into public.mafo_holders (character_id, card_key, weaker, granted_by) values (ch.id, p_card ->> 'key', p_weaker, auth.uid());
	update public.characters
	set sheet = public.sheet_with_card(sheet, p_card),
		approved_sheet = case when approved_sheet is null then null else public.sheet_with_card(approved_sheet, p_card) end
	where id = ch.id;
end;
$$;

-- Lets a holder steal and transfer without approval (or not).
create or replace function public.set_mafo_free(p_character uuid, p_card text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.can_grant_mafo() then
		raise exception 'Only Tatsuya can change this.' using errcode = '42501';
	end if;
	update public.mafo_holders set free_actions = coalesce(p_on, false) where character_id = p_character and card_key = p_card;
end;
$$;

-- Takes M:AFO away: its card, storage and requests go. Powers already given to others stay with them.
create or replace function public.revoke_mafo(p_character uuid, p_card text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.can_grant_mafo() then
		raise exception 'Only Tatsuya can take M:AFO away.' using errcode = '42501';
	end if;
	delete from public.mafo_holders where character_id = p_character and card_key = p_card;
	update public.characters
	set sheet = public.sheet_without_key(sheet, p_card),
		approved_sheet = public.sheet_without_key(approved_sheet, p_card)
	where id = p_character;
end;
$$;

-- A sheet without one card (the priority moves to the first card left).
create or replace function public.sheet_without_key(p_sheet jsonb, p_key text)
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
	select coalesce(jsonb_agg(e), '[]') into kept from jsonb_array_elements(p_sheet -> 'systems') e where e ->> 'key' is distinct from p_key;
	s := jsonb_set(s, '{systems}', kept);
	if not exists (select 1 from jsonb_array_elements(kept) e where e ->> 'key' = s ->> 'prioritySystem') then
		s := jsonb_set(s, '{prioritySystem}', to_jsonb(coalesce(kept -> 0 ->> 'key', '')));
	end if;
	return s;
end;
$$;

-- ───────────────────────────── Doing a steal or a transfer ─────────────────────────────

create or replace function public.mafo_do(r public.mafo_requests)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	h public.mafo_holders;
	victim public.characters;
	target public.characters;
	item public.mafo_items;
	card jsonb;
	info jsonb;
	holder_name text;
	cap jsonb;
	new_card jsonb;
begin
	select * into h from public.mafo_holders where character_id = r.holder_character and card_key = r.holder_card;
	select coalesce(approved_name, name) into holder_name from public.characters where id = r.holder_character;
	cap := public.mafo_capacity(r.holder_character, r.holder_card);
	-- Trusted like a review, so guard_character lets the approved sheets change.
	perform set_config('portal.family_review', 'on', true);

	if r.action = 'steal' then
		select * into victim from public.characters where id = r.victim_character for update;
		if victim.id is null or victim.approved_sheet is null then
			raise exception 'That character isn''t approved.' using errcode = 'P0001';
		end if;
		select e into card from jsonb_array_elements(victim.approved_sheet -> 'systems') e where e ->> 'key' = r.victim_card;
		if card is null then
			raise exception 'That card isn''t on % any more.', coalesce(victim.approved_name, victim.name) using errcode = 'P0001';
		end if;
		info := public.mafo_classify(card);
		if info ? 'error' then
			raise exception '%', info ->> 'error' using errcode = 'P0001';
		end if;
		insert into public.mafo_items (holder_character, holder_card, kind, tier, slots, mqp, name, source_character, source_name, card)
		values (r.holder_character, r.holder_card, info ->> 'kind', info ->> 'tier', (info ->> 'slots')::int, (info ->> 'mqp')::int, info ->> 'name',
			victim.id, coalesce(victim.approved_name, victim.name), card);
		update public.characters
		set sheet = public.sheet_without_key(sheet, r.victim_card),
			approved_sheet = public.sheet_without_key(approved_sheet, r.victim_card)
		where id = victim.id;
		-- MQP isn't changed by traits. A Weaker M:AFO has no upgrades, so no MQP.
		if not h.weaker then
			perform public.points_add(r.holder_character, r.holder_card, 'MQP', (info ->> 'mqp')::int, 'mafo',
				format('Stole %s (%s %s) from %s', info ->> 'name', info ->> 'tier', info ->> 'kind', coalesce(victim.approved_name, victim.name)), auth.uid()::text);
		end if;
	else
		select * into item from public.mafo_items where id = r.item_id for update;
		if item.id is null or item.status <> 'stored' or item.holder_character <> r.holder_character or item.holder_card <> r.holder_card then
			raise exception 'That power isn''t in storage any more.' using errcode = 'P0001';
		end if;
		if public.mafo_decayed(item, cap) then
			raise exception '% has decayed.', item.name using errcode = 'P0001';
		end if;
		if item.kind = 'conduit' and not coalesce((cap ->> 'conduitTransfer')::boolean, false) then
			raise exception 'Giving Conduits needs Conduit Transference.' using errcode = 'P0001';
		end if;
		select * into target from public.characters where id = r.target_character for update;
		if target.id is null or target.approved_sheet is null then
			raise exception 'That character isn''t approved.' using errcode = 'P0001';
		end if;
		-- A new card, on top of their usual limits, saying where it came from.
		new_card := jsonb_set(item.card, '{key}', to_jsonb(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
			|| jsonb_build_object('mafoGift', jsonb_build_object('from', holder_name, 'at', now()));
		new_card := new_card - 'powerLink' - 'familyLink' - 'canonClaim';
		update public.characters
		set sheet = public.sheet_with_card(sheet, new_card),
			approved_sheet = public.sheet_with_card(approved_sheet, new_card)
		where id = target.id;
		update public.mafo_items set status = 'transferred', transferred_to = target.id, transferred_at = now() where id = item.id;
	end if;
	perform set_config('portal.family_review', '', true);
end;
$$;

-- The holder (or an admin) asks to steal a card or give a stored power. A holder Tatsuya let act
-- freely gets it done at once; otherwise it waits for an admin. Returns the request.
create or replace function public.mafo_request(p_holder uuid, p_card text, p_action text, p_victim uuid, p_victim_card text, p_item bigint, p_target uuid, p_note text default '')
returns public.mafo_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	h public.mafo_holders;
	ch public.characters;
	victim public.characters;
	card jsonb;
	info jsonb;
	item public.mafo_items;
	r public.mafo_requests;
begin
	select * into h from public.mafo_holders where character_id = p_holder and card_key = p_card;
	select * into ch from public.characters where id = p_holder;
	if h.character_id is null or ch.id is null then
		raise exception 'That card isn''t an M:AFO.' using errcode = 'P0001';
	end if;
	if not (ch.owner_id = auth.uid() or public.is_admin()) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if ch.approved_at is null then
		raise exception 'The M:AFO holder has to be approved first.' using errcode = 'P0001';
	end if;
	if p_action = 'steal' then
		if p_victim = p_holder then
			raise exception 'M:AFO can''t steal from its own holder.' using errcode = 'P0001';
		end if;
		select * into victim from public.characters where id = p_victim;
		select e into card from jsonb_array_elements(coalesce(victim.approved_sheet -> 'systems', '[]')) e where e ->> 'key' = p_victim_card;
		if card is null then
			raise exception 'Pick one of that character''s approved cards.' using errcode = 'P0001';
		end if;
		info := public.mafo_classify(card);
		if info ? 'error' then
			raise exception '%', info ->> 'error' using errcode = 'P0001';
		end if;
		if exists (select 1 from public.mafo_requests where status = 'pending' and action = 'steal' and victim_character = p_victim and victim_card = p_victim_card) then
			raise exception 'That card already has a steal waiting.' using errcode = 'P0001';
		end if;
	elsif p_action = 'transfer' then
		select * into item from public.mafo_items where id = p_item and holder_character = p_holder and holder_card = p_card and status = 'stored';
		if item.id is null then
			raise exception 'That power isn''t in storage.' using errcode = 'P0001';
		end if;
		if public.mafo_decayed(item, public.mafo_capacity(p_holder, p_card)) then
			raise exception '% has decayed.', item.name using errcode = 'P0001';
		end if;
		if item.kind = 'conduit' and not coalesce((public.mafo_capacity(p_holder, p_card) ->> 'conduitTransfer')::boolean, false) then
			raise exception 'Giving Conduits needs Conduit Transference.' using errcode = 'P0001';
		end if;
		if p_target is null or not exists (select 1 from public.characters where id = p_target and approved_at is not null and status <> 'denied') then
			raise exception 'Pick an approved character to give it to.' using errcode = 'P0001';
		end if;
		if exists (select 1 from public.mafo_requests where status = 'pending' and item_id = p_item) then
			raise exception 'That power already has a transfer waiting.' using errcode = 'P0001';
		end if;
	else
		raise exception 'Steal or transfer.' using errcode = '22023';
	end if;

	insert into public.mafo_requests (holder_character, holder_card, action, victim_character, victim_card, item_id, target_character, note, requested_by)
	values (p_holder, p_card, p_action, case when p_action = 'steal' then p_victim end, case when p_action = 'steal' then p_victim_card end,
		case when p_action = 'transfer' then p_item end, case when p_action = 'transfer' then p_target end, left(btrim(coalesce(p_note, '')), 500), auth.uid())
	returning * into r;
	if h.free_actions then
		perform public.mafo_do(r);
		update public.mafo_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = 'No approval needed.' where id = r.id
		returning * into r;
	end if;
	return r;
end;
$$;

-- Admins: approve (it happens now) or deny a waiting steal or transfer.
create or replace function public.decide_mafo_request(p_id bigint, p_approve boolean, p_reason text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	r public.mafo_requests;
begin
	if not public.is_admin() then
		raise exception 'Only admins can decide M:AFO requests.' using errcode = '42501';
	end if;
	select * into r from public.mafo_requests where id = p_id for update;
	if r.id is null or r.status <> 'pending' then
		raise exception 'That request isn''t waiting any more.' using errcode = 'P0001';
	end if;
	if p_approve then
		perform public.mafo_do(r);
	end if;
	update public.mafo_requests
	set status = case when p_approve then 'approved' else 'denied' end, reason = left(btrim(coalesce(p_reason, '')), 500), decided_by = auth.uid(), decided_at = now()
	where id = r.id;
end;
$$;

-- The holder or an admin: withdraw a waiting request.
create or replace function public.cancel_mafo_request(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	delete from public.mafo_requests r
	using public.characters c
	where r.id = p_id and r.status = 'pending' and c.id = r.holder_character and (c.owner_id = auth.uid() or public.is_admin());
end;
$$;

-- ───────────────────────────── Reading ─────────────────────────────

-- A character's M:AFO cards, for anyone who can see its sheet: capacity, storage and (for the owner
-- and admins) waiting requests and whether Tatsuya lets it act freely.
create or replace function public.mafo_state(p_character uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	page jsonb := public.character_page(p_character);
	mine boolean;
begin
	if page is null or coalesce((page ->> 'allowed')::boolean, false) is not true then
		return '[]'::jsonb;
	end if;
	mine := public.is_admin() or exists (select 1 from public.characters where id = p_character and owner_id = auth.uid());
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'card_key', h.card_key,
			'weaker', h.weaker,
			'free_actions', case when mine then h.free_actions end,
			'capacity', cap.c,
			'items', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', i.id, 'kind', i.kind, 'tier', i.tier, 'slots', i.slots, 'mqp', i.mqp, 'name', i.name,
					'source_name', i.source_name, 'status', i.status, 'stolen_at', i.stolen_at, 'transferred_at', i.transferred_at,
					'transferred_to', (select coalesce(approved_name, name) from public.characters where id = i.transferred_to),
					'decayed', public.mafo_decayed(i, cap.c),
					'decays_at', case when i.kind = 'ability' then i.stolen_at + make_interval(days => (cap.c ->> 'decayRp')::int) end,
					'card', i.card
				) order by i.stolen_at desc)
				from public.mafo_items i where i.holder_character = h.character_id and i.holder_card = h.card_key
			), '[]'),
			'requests', case when mine then coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', r.id, 'action', r.action, 'status', r.status, 'note', r.note, 'reason', r.reason, 'requested_at', r.requested_at,
					'victim_name', (select coalesce(approved_name, name) from public.characters where id = r.victim_character),
					'card_name', (select public.mafo_classify(e) ->> 'name' from public.characters v, jsonb_array_elements(coalesce(v.approved_sheet -> 'systems', '[]')) e where v.id = r.victim_character and e ->> 'key' = r.victim_card),
					'item_name', (select name from public.mafo_items where id = r.item_id),
					'target_name', (select coalesce(approved_name, name) from public.characters where id = r.target_character)
				) order by r.requested_at desc)
				from public.mafo_requests r where r.holder_character = h.character_id and r.holder_card = h.card_key
					and (r.status = 'pending' or r.decided_at > now() - interval '14 days')
			), '[]') end
		))
		from public.mafo_holders h, lateral (select public.mafo_capacity(h.character_id, h.card_key) as c) cap
		where h.character_id = p_character
	), '[]'::jsonb);
end;
$$;

-- Characters an M:AFO holder can steal from or give to: approved, not hidden or encrypted, with the
-- cards M:AFO could take and what each is worth. Only for holders' owners and admins.
create or replace function public.mafo_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.is_admin() or exists (select 1 from public.mafo_holders h join public.characters c on c.id = h.character_id where c.owner_id = auth.uid())) then
		raise exception 'Only M:AFO holders can see this.' using errcode = '42501';
	end if;
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'id', c.id,
			'name', coalesce(c.approved_name, c.name),
			'owner', p.display_name,
			'cards', coalesce((
				select jsonb_agg(jsonb_build_object('key', e ->> 'key', 'system', e ->> 'system') || public.mafo_classify(e))
				from jsonb_array_elements(coalesce(c.approved_sheet -> 'systems', '[]')) e
				where e ->> 'system' in ('quirk', 'abilities', 'infamous')
			), '[]')
		) order by coalesce(c.approved_name, c.name))
		from public.characters c
		left join public.profiles p on p.id = c.owner_id
		where c.approved_at is not null and c.status <> 'denied' and not c.hidden and not c.encrypted
	), '[]'::jsonb);
end;
$$;

-- Admins: every waiting steal and transfer, with names.
create or replace function public.mafo_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can see M:AFO requests.' using errcode = '42501';
	end if;
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'id', r.id, 'action', r.action, 'note', r.note, 'requested_at', r.requested_at,
			'holder_id', r.holder_character,
			'holder_name', (select coalesce(approved_name, name) from public.characters where id = r.holder_character),
			'weaker', h.weaker,
			'victim_name', (select coalesce(approved_name, name) from public.characters where id = r.victim_character),
			'card', (select jsonb_build_object('system', e ->> 'system') || public.mafo_classify(e) from public.characters v, jsonb_array_elements(coalesce(v.approved_sheet -> 'systems', '[]')) e where v.id = r.victim_character and e ->> 'key' = r.victim_card),
			'item', (select jsonb_build_object('name', i.name, 'kind', i.kind, 'tier', i.tier, 'slots', i.slots) from public.mafo_items i where i.id = r.item_id),
			'target_name', (select coalesce(approved_name, name) from public.characters where id = r.target_character)
		) order by r.requested_at)
		from public.mafo_requests r
		join public.mafo_holders h on h.character_id = r.holder_character and h.card_key = r.holder_card
		where r.status = 'pending'
	), '[]'::jsonb);
end;
$$;

-- Tatsuya: every holder, for the grant panel.
create or replace function public.mafo_holders_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.can_grant_mafo() then
		raise exception 'Only Tatsuya can see this.' using errcode = '42501';
	end if;
	return coalesce((
		select jsonb_agg(jsonb_build_object('character_id', h.character_id, 'card_key', h.card_key, 'weaker', h.weaker, 'free_actions', h.free_actions,
			'name', coalesce(c.approved_name, c.name), 'granted_at', h.granted_at) order by h.granted_at)
		from public.mafo_holders h join public.characters c on c.id = h.character_id
	), '[]'::jsonb);
end;
$$;

-- ───────────────────────────── Grants ─────────────────────────────

revoke execute on function public.guard_mafo_rolls() from public, anon, authenticated;
revoke execute on function public.mafo_classify(jsonb) from public, anon, authenticated;
revoke execute on function public.mafo_capacity(uuid, text) from public, anon, authenticated;
revoke execute on function public.mafo_decayed(public.mafo_items, jsonb) from public, anon, authenticated;
revoke execute on function public.mafo_do(public.mafo_requests) from public, anon, authenticated;
revoke execute on function public.sheet_without_key(jsonb, text) from public, anon, authenticated;
revoke execute on function public.can_grant_mafo() from public;
revoke execute on function public.grant_mafo(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.set_mafo_free(uuid, text, boolean) from public, anon;
revoke execute on function public.revoke_mafo(uuid, text) from public, anon;
revoke execute on function public.mafo_request(uuid, text, text, uuid, text, bigint, uuid, text) from public, anon;
revoke execute on function public.decide_mafo_request(bigint, boolean, text) from public, anon;
revoke execute on function public.cancel_mafo_request(bigint) from public, anon;
revoke execute on function public.mafo_state(uuid) from public;
revoke execute on function public.mafo_targets() from public, anon;
revoke execute on function public.mafo_queue() from public, anon;
revoke execute on function public.mafo_holders_list() from public, anon;
grant execute on function public.can_grant_mafo() to anon, authenticated;
grant execute on function public.grant_mafo(uuid, jsonb, boolean) to authenticated;
grant execute on function public.set_mafo_free(uuid, text, boolean) to authenticated;
grant execute on function public.revoke_mafo(uuid, text) to authenticated;
grant execute on function public.mafo_request(uuid, text, text, uuid, text, bigint, uuid, text) to authenticated;
grant execute on function public.decide_mafo_request(bigint, boolean, text) to authenticated;
grant execute on function public.cancel_mafo_request(bigint) to authenticated;
grant execute on function public.mafo_state(uuid) to anon, authenticated;
grant execute on function public.mafo_targets() to authenticated;
grant execute on function public.mafo_queue() to authenticated;
grant execute on function public.mafo_holders_list() to authenticated;
