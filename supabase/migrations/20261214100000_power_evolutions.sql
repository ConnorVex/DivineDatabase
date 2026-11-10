-- Evolving powers: a custom power can evolve into another one (Inferior Shrine → Superior Shrine).
-- Each stage is its own power with its own card and skill tree. The first stage has an evolution
-- meter on the card (e.g. "Metamorphosis 0/100"):
--   * it fills by itself from approved training logs that used the card (a set amount per log, not
--     changed by traits), and staff add or take points by hand for anything else (combat);
--   * with "tree first", it only fills once the card's skill tree is complete;
--   * once full, the player presses Evolve. The card is locked for the lock period: a minimum number
--     of days, skipped early once the character has that many approved RPs (training logs) since;
--   * then the card becomes the next stage: the next power's card, same key, same grant.
--
-- The site stores each power's ready-made card (custom_powers.card) whenever an admin saves it, so the
-- database can swap a card without rebuilding it.

alter table public.custom_powers add column if not exists card jsonb;
alter table public.custom_powers add column if not exists evolves_to uuid references public.custom_powers (id) on delete set null;
-- { meter, max, perLog, treeFirst, lockDays, lockRps }
alter table public.custom_powers add column if not exists evolution jsonb;

-- A card's progress towards its next stage.
create table if not exists public.power_evolutions (
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	power_id uuid not null references public.custom_powers (id) on delete cascade,
	meter int not null default 0 check (meter between 0 and 100000),
	-- Pressed Evolve: the card is locked until it becomes the next stage.
	started_at timestamptz,
	primary key (character_id, card_key)
);

create table if not exists public.power_meter_log (
	id bigint generated always as identity primary key,
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	power_id uuid,
	change int not null,
	meter_after int not null,
	source text not null check (source in ('training', 'staff', 'evolve')),
	reason text not null default '',
	actor uuid,
	created_at timestamptz not null default now()
);
create index if not exists power_meter_log_card on public.power_meter_log (character_id, card_key, created_at desc);

alter table public.power_evolutions enable row level security;
alter table public.power_meter_log enable row level security;
revoke all on public.power_evolutions from anon, authenticated;
revoke all on public.power_meter_log from anon, authenticated;

-- ───────────────────────────── Saving powers ─────────────────────────────

drop function if exists public.save_custom_power(uuid, text, text, jsonb, text, text, jsonb);

-- Admins: create (p_id null) or change a power, with its ready-made card and what it evolves into.
create or replace function public.save_custom_power(p_id uuid, p_name text, p_system text, p_ability jsonb, p_description text, p_drawbacks text, p_tree jsonb,
	p_card jsonb, p_evolves_to uuid, p_evolution jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	pid uuid;
	evo jsonb;
	nxt uuid := p_evolves_to;
	hops int := 0;
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
	if p_evolves_to is not null then
		if not exists (select 1 from public.custom_powers where id = p_evolves_to) then
			raise exception 'The power it evolves into doesn''t exist.' using errcode = 'P0002';
		end if;
		evo := jsonb_build_object(
			'meter', left(coalesce(nullif(btrim(p_evolution ->> 'meter'), ''), 'Evolution'), 40),
			'max', greatest(1, least(100000, coalesce((p_evolution ->> 'max')::numeric, 100)))::int,
			'perLog', greatest(0, least(1000, coalesce((p_evolution ->> 'perLog')::numeric, 0)))::int,
			'treeFirst', coalesce((p_evolution ->> 'treeFirst')::boolean, false),
			'lockDays', greatest(0, least(365, coalesce((p_evolution ->> 'lockDays')::numeric, 0)))::int,
			'lockRps', greatest(0, least(100, coalesce((p_evolution ->> 'lockRps')::numeric, 0)))::int);
	end if;

	if p_id is null then
		insert into public.custom_powers (name, system, ability, description, drawbacks, tree, card, evolves_to, evolution, created_by)
		values (btrim(p_name), p_system, p_ability, coalesce(p_description, ''), coalesce(p_drawbacks, ''), case when jsonb_typeof(p_tree) = 'object' then p_tree end,
			case when jsonb_typeof(p_card) = 'object' then p_card end, p_evolves_to, evo, auth.uid())
		returning id into pid;
	else
		update public.custom_powers
		set name = btrim(p_name), system = p_system, ability = p_ability, description = coalesce(p_description, ''),
			drawbacks = coalesce(p_drawbacks, ''), tree = case when jsonb_typeof(p_tree) = 'object' then p_tree end,
			card = case when jsonb_typeof(p_card) = 'object' then p_card end, evolves_to = p_evolves_to, evolution = evo, updated_at = now()
		where id = p_id
		returning id into pid;
		if pid is null then
			raise exception 'That power doesn''t exist.' using errcode = 'P0002';
		end if;
	end if;

	-- The ready-made card points back at this power (a new power has no id until now).
	update public.custom_powers set card = jsonb_set(card, '{powerLink,powerId}', to_jsonb(pid::text))
	where id = pid and jsonb_typeof(card -> 'powerLink') = 'object';

	-- No loops: following "evolves into" must end.
	while nxt is not null loop
		if nxt = pid or hops > 20 then
			raise exception 'A power can''t evolve back into itself.' using errcode = 'P0001';
		end if;
		select evolves_to into nxt from public.custom_powers where id = nxt;
		hops := hops + 1;
	end loop;
	return pid;
end;
$$;

-- ───────────────────────────── The meter ─────────────────────────────

-- The power on a character's approved card, if it's a granted power.
create or replace function public.card_power(p_character uuid, p_card text)
returns public.custom_powers
language sql
stable
security definer
set search_path = ''
as $$
	select p.* from public.characters c,
		jsonb_array_elements(case when jsonb_typeof(c.approved_sheet -> 'systems') = 'array' then c.approved_sheet -> 'systems' else '[]' end) e,
		public.custom_powers p
	where c.id = p_character and e ->> 'key' = p_card and p.id::text = e #>> '{powerLink,powerId}'
	limit 1;
$$;

-- Whether every skill on the card's tree is owned (true when it has no tree).
create or replace function public.card_tree_complete(p_character uuid, p_card text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select not exists (
		select 1 from public.tree_nodes(p_character, p_card, 'custom') n
		where not (n.id = any (public.skill_owned(p_character, p_card, 'custom')))
	);
$$;

-- Adds to (or takes from) a card's meter, between 0 and its size. Callers check who may.
create or replace function public.power_meter_add(p_character uuid, p_card text, p_change int, p_source text, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	pw public.custom_powers := public.card_power(p_character, p_card);
	ev public.power_evolutions;
	cur int;
	nxt int;
begin
	if pw.id is null or pw.evolves_to is null then
		raise exception 'That card''s power doesn''t evolve.' using errcode = 'P0001';
	end if;
	insert into public.power_evolutions (character_id, card_key, power_id) values (p_character, p_card, pw.id)
	on conflict (character_id, card_key) do nothing;
	select * into ev from public.power_evolutions where character_id = p_character and card_key = p_card for update;
	-- A new stage starts from an empty meter.
	if ev.power_id <> pw.id then
		update public.power_evolutions set power_id = pw.id, meter = 0, started_at = null where character_id = p_character and card_key = p_card;
		ev.meter := 0;
		ev.started_at := null;
	end if;
	if ev.started_at is not null then
		raise exception 'That card is already evolving.' using errcode = 'P0001';
	end if;
	cur := ev.meter;
	nxt := greatest(0, least((pw.evolution ->> 'max')::int, cur + coalesce(p_change, 0)));
	if nxt = cur then
		return cur;
	end if;
	update public.power_evolutions set meter = nxt where character_id = p_character and card_key = p_card;
	insert into public.power_meter_log (character_id, card_key, power_id, change, meter_after, source, reason, actor)
	values (p_character, p_card, pw.id, nxt - cur, nxt, p_source, left(btrim(coalesce(p_reason, '')), 300), auth.uid());
	return nxt;
end;
$$;

-- Staff: add or take meter points by hand (combat, corrections).
create or replace function public.adjust_power_meter(p_character uuid, p_card text, p_change int, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only staff can change the meter.' using errcode = '42501';
	end if;
	if coalesce(p_change, 0) = 0 or abs(p_change) > 100000 then
		raise exception 'Add or take a number of points.' using errcode = '22023';
	end if;
	return public.power_meter_add(p_character, p_card, p_change, 'staff', coalesce(nullif(btrim(p_reason), ''), 'Staff'));
end;
$$;

-- ───────────────────────────── Evolving ─────────────────────────────

-- The player (or staff) presses Evolve once the meter is full (and the tree complete, when it must be).
create or replace function public.start_power_evolution(p_character uuid, p_card text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	pw public.custom_powers := public.card_power(p_character, p_card);
	ev public.power_evolutions;
begin
	select * into ch from public.characters where id = p_character;
	if ch.id is null or not (ch.owner_id = auth.uid() or public.is_admin()) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if pw.id is null or pw.evolves_to is null then
		raise exception 'That card''s power doesn''t evolve.' using errcode = 'P0001';
	end if;
	select * into ev from public.power_evolutions where character_id = p_character and card_key = p_card and power_id = pw.id for update;
	if ev.started_at is not null then
		raise exception 'It''s already evolving.' using errcode = 'P0001';
	end if;
	if coalesce(ev.meter, 0) < (pw.evolution ->> 'max')::int then
		raise exception 'Fill the % meter first (%/%).', pw.evolution ->> 'meter', coalesce(ev.meter, 0), pw.evolution ->> 'max' using errcode = 'P0001';
	end if;
	if coalesce((pw.evolution ->> 'treeFirst')::boolean, false) and not public.card_tree_complete(p_character, p_card) then
		raise exception 'Complete the skill tree first.' using errcode = 'P0001';
	end if;
	update public.power_evolutions set started_at = now() where character_id = p_character and card_key = p_card;
	insert into public.power_meter_log (character_id, card_key, power_id, change, meter_after, source, reason, actor)
	values (p_character, p_card, pw.id, 0, ev.meter, 'evolve', 'Started evolving into the next stage', auth.uid());
	perform public.power_evolution_tick(p_character);
end;
$$;

-- When an evolving card's lock is over: days passed, or enough approved RPs since it started.
create or replace function public.power_evolution_due(ev public.power_evolutions, evo jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select ev.started_at is not null and (
		(coalesce((evo ->> 'lockDays')::int, 0) = 0 and coalesce((evo ->> 'lockRps')::int, 0) = 0)
		or (coalesce((evo ->> 'lockDays')::int, 0) > 0 and now() >= ev.started_at + make_interval(days => (evo ->> 'lockDays')::int))
		or (coalesce((evo ->> 'lockRps')::int, 0) > 0 and (
			select count(*) from public.training_logs t
			where t.character_id = ev.character_id and t.status = 'approved' and t.reviewed_at > ev.started_at
		) >= (evo ->> 'lockRps')::int)
	);
$$;

-- Turns every evolving card whose lock is over into its next stage. Anyone may call it: it only
-- finishes what's due. Returns how many cards evolved.
create or replace function public.power_evolution_tick(p_character uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	ev public.power_evolutions;
	pw public.custom_powers;
	nxt public.custom_powers;
	old_card jsonb;
	new_card jsonb;
	done int := 0;
	swap jsonb;
begin
	for ev in select * from public.power_evolutions where character_id = p_character and started_at is not null for update loop
		select * into pw from public.custom_powers where id = ev.power_id;
		select * into nxt from public.custom_powers where id = pw.evolves_to;
		continue when nxt.id is null or nxt.card is null or not public.power_evolution_due(ev, pw.evolution);
		select e into old_card from public.characters c, jsonb_array_elements(c.approved_sheet -> 'systems') e
		where c.id = p_character and e ->> 'key' = ev.card_key;
		continue when old_card is null;
		-- The next stage's card, on the same key and grant, keeping what the player wrote.
		new_card := nxt.card
			|| jsonb_build_object('key', ev.card_key, 'description', coalesce(old_card -> 'description', '""'), 'rollProofs', coalesce(old_card -> 'rollProofs', '{}'))
			|| case when coalesce((nxt.card #>> '{powerLink,ownSkills}')::boolean, false) then jsonb_build_object('skills', coalesce(old_card -> 'skills', '[]')) else '{}' end;
		new_card := jsonb_set(new_card, '{powerLink,grantId}', coalesce(old_card #> '{powerLink,grantId}', 'null'));
		swap := jsonb_build_object('from', pw.name, 'to', nxt.name, 'at', now());
		new_card := new_card || jsonb_build_object('evolvedFrom', coalesce(old_card -> 'evolvedFrom', '[]') || jsonb_build_array(swap));

		perform set_config('portal.family_review', 'on', true);
		update public.characters
		set sheet = case when jsonb_typeof(sheet -> 'systems') = 'array' then jsonb_set(sheet, '{systems}',
				(select jsonb_agg(case when e ->> 'key' = ev.card_key then new_card else e end order by i) from jsonb_array_elements(sheet -> 'systems') with ordinality x (e, i))) else sheet end,
			approved_sheet = jsonb_set(approved_sheet, '{systems}',
				(select jsonb_agg(case when e ->> 'key' = ev.card_key then new_card else e end order by i) from jsonb_array_elements(approved_sheet -> 'systems') with ordinality x (e, i)))
		where id = p_character;
		perform set_config('portal.family_review', '', true);

		-- The grant now holds the next stage, so the card's checks still find it.
		update public.power_grants set power_id = nxt.id
		where id = (old_card #>> '{powerLink,grantId}')::bigint and power_id = pw.id;
		-- The old stage's unlocks were for its tree; the new stage starts its own.
		delete from public.character_unlocks where character_id = p_character and card_key = ev.card_key and tree_id = 'custom';
		update public.power_evolutions set power_id = nxt.id, meter = 0, started_at = null where character_id = p_character and card_key = ev.card_key;
		insert into public.power_meter_log (character_id, card_key, power_id, change, meter_after, source, reason)
		values (p_character, ev.card_key, nxt.id, 0, 0, 'evolve', format('Evolved from %s into %s', pw.name, nxt.name));
		done := done + 1;
	end loop;
	return done;
end;
$$;

-- An approved training log fills the meters of the evolving cards it used, then checks locks (it's an RP).
create or replace function public.power_meter_from_training()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	r record;
begin
	if new.status <> 'approved' or old.status = 'approved' then
		return new;
	end if;
	for r in
		select e ->> 'key' as card, p.id, p.evolution
		from public.characters c,
			jsonb_array_elements(case when jsonb_typeof(c.approved_sheet -> 'systems') = 'array' then c.approved_sheet -> 'systems' else '[]' end) e,
			public.custom_powers p
		where c.id = new.character_id and e ->> 'key' = any (new.systems_used)
			and p.id::text = e #>> '{powerLink,powerId}' and p.evolves_to is not null
			and coalesce((p.evolution ->> 'perLog')::int, 0) > 0
	loop
		continue when exists (select 1 from public.power_evolutions where character_id = new.character_id and card_key = r.card and power_id = r.id and started_at is not null);
		continue when coalesce((r.evolution ->> 'treeFirst')::boolean, false) and not public.card_tree_complete(new.character_id, r.card);
		perform public.power_meter_add(new.character_id, r.card, (r.evolution ->> 'perLog')::int, 'training', 'Training log');
	end loop;
	perform public.power_evolution_tick(new.character_id);
	return new;
end;
$$;

drop trigger if exists power_meter_from_training on public.training_logs;
create trigger power_meter_from_training after update of status on public.training_logs
	for each row execute function public.power_meter_from_training();

-- ───────────────────────────── Reading ─────────────────────────────

-- A character's evolving cards, for anyone who can see its sheet: the meter, what's next, and the lock.
create or replace function public.power_evolution_state(p_character uuid)
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
	mine := exists (select 1 from public.characters where id = p_character and owner_id = auth.uid());
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'card_key', e ->> 'key',
			'power', p.name,
			'next', n.name,
			'next_ready', n.card is not null,
			'evolution', p.evolution,
			'meter', coalesce(ev.meter, 0),
			'started_at', ev.started_at,
			'ends_at', case when ev.started_at is not null and coalesce((p.evolution ->> 'lockDays')::int, 0) > 0 then ev.started_at + make_interval(days => (p.evolution ->> 'lockDays')::int) end,
			'rps_since', case when ev.started_at is not null then (select count(*) from public.training_logs t where t.character_id = p_character and t.status = 'approved' and t.reviewed_at > ev.started_at) end,
			'tree_complete', public.card_tree_complete(p_character, e ->> 'key'),
			'can_evolve', mine or public.is_admin(),
			'staff', public.is_admin(),
			'log', case when mine or public.is_admin() then coalesce((
				select jsonb_agg(jsonb_build_object('change', l.change, 'meter_after', l.meter_after, 'source', l.source, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
				from (select * from public.power_meter_log l where l.character_id = p_character and l.card_key = e ->> 'key' order by l.created_at desc limit 10) l
			), '[]') end
		))
		from public.characters c
			cross join lateral jsonb_array_elements(case when jsonb_typeof(c.approved_sheet -> 'systems') = 'array' then c.approved_sheet -> 'systems' else '[]' end) e
			join public.custom_powers p on p.id::text = e #>> '{powerLink,powerId}'
			join public.custom_powers n on n.id = p.evolves_to
			left join public.power_evolutions ev on ev.character_id = c.id and ev.card_key = e ->> 'key' and ev.power_id = p.id
		where c.id = p_character
	), '[]'::jsonb);
end;
$$;

-- ───────────────────────────── Grants ─────────────────────────────

revoke execute on function public.save_custom_power(uuid, text, text, jsonb, text, text, jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.save_custom_power(uuid, text, text, jsonb, text, text, jsonb, jsonb, uuid, jsonb) to authenticated;
revoke execute on function public.card_power(uuid, text) from public, anon, authenticated;
revoke execute on function public.card_tree_complete(uuid, text) from public, anon, authenticated;
revoke execute on function public.power_meter_add(uuid, text, int, text, text) from public, anon, authenticated;
revoke execute on function public.power_evolution_due(public.power_evolutions, jsonb) from public, anon, authenticated;
revoke execute on function public.power_meter_from_training() from public, anon, authenticated;
revoke execute on function public.adjust_power_meter(uuid, text, int, text) from public, anon;
revoke execute on function public.start_power_evolution(uuid, text) from public, anon;
revoke execute on function public.power_evolution_tick(uuid) from public;
revoke execute on function public.power_evolution_state(uuid) from public;
grant execute on function public.adjust_power_meter(uuid, text, int, text) to authenticated;
grant execute on function public.start_power_evolution(uuid, text) to authenticated;
grant execute on function public.power_evolution_tick(uuid) to anon, authenticated;
grant execute on function public.power_evolution_state(uuid) to anon, authenticated;
