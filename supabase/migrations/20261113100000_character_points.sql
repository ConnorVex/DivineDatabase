-- System upgrade points: per-card wallets for AUP, QUP, JJUUP, CEUP, CTUP, BTUP, HUP, SUP, VUP,
-- SGUP and TGUP, tracked here instead of being typed onto the sheet.
--
--   * point_currencies: which currency each power system uses, how much one training or combat
--     session earns (Ultron awards it when staff approve a training log), and the sheet field that
--     shows the balance (kept in sync by a trigger, so the sheet always matches the wallet).
--   * point_conversions: fixed exchange rates, e.g. 5 JJUUP → 2 CEUP.
--   * character_points: one balance per character, system card and currency.
--   * point_ledger: every change, with where it came from.
--
-- Players convert on the site (convert_points); admins adjust on the site (adjust_points) or with
-- Ultron. Run once in the SQL Editor, then run the bot's 20261113110000_bot_training_points.sql.


-- ───────────────────────────── Tables ─────────────────────────────

create table if not exists public.point_currencies (
	code text primary key,
	system text not null,
	label text not null,
	-- Earned per approved training or combat session where the card was used.
	earn int not null default 0 check (earn between 0 and 1000),
	-- Sheet field on the system card that shows the balance, if the card has one.
	field text,
	-- Only applies when the card's field matches: { "key": "path", "in": ["Hamon"] } ('' = not set).
	show_if jsonb,
	sort int not null default 0
);

create table if not exists public.point_conversions (
	id int primary key,
	from_code text not null references public.point_currencies (code),
	from_amount int not null check (from_amount > 0),
	to_code text not null references public.point_currencies (code),
	to_amount int not null check (to_amount > 0)
);

create table if not exists public.character_points (
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	currency text not null references public.point_currencies (code),
	balance int not null default 0 check (balance between 0 and 1000000),
	updated_at timestamptz not null default now(),
	primary key (character_id, card_key, currency)
);

create table if not exists public.point_ledger (
	id bigint generated always as identity primary key,
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	currency text not null,
	change int not null,
	balance_after int not null,
	-- training | convert | staff | sheet (a starting balance copied from the approved sheet)
	source text not null check (source in ('training', 'convert', 'staff', 'sheet')),
	reason text not null default '',
	-- A Discord id (Ultron) or a profile id (the site).
	actor text,
	ref uuid,
	created_at timestamptz not null default now()
);
create index if not exists point_ledger_character on public.point_ledger (character_id, created_at desc);

insert into public.point_currencies (code, system, label, earn, field, show_if, sort) values
	('AUP', 'abilities', 'Ability Upgrade Points', 4, 'upgradePoints', null, 10),
	('QUP', 'quirk', 'Quirk Upgrade Points', 8, 'upgradePoints', null, 20),
	('JJUUP', 'jujutsu-kaisen', 'Jujutsu Universal Upgrade Points', 5, null, null, 30),
	('CEUP', 'jujutsu-kaisen', 'Cursed Energy Upgrade Points', 0, 'ceUpgradePoints', null, 31),
	('CTUP', 'jujutsu-kaisen', 'Cursed Technique Upgrade Points', 0, 'ctUpgradePoints', '{"key": "start", "in": ["Cursed Technique", ""]}', 32),
	('BTUP', 'jujutsu-kaisen', 'Barrier Technique Upgrade Points', 0, null, null, 33),
	('HUP', 'jojo', 'Hamon Upgrade Points', 4, 'hamonMastery', '{"key": "path", "in": ["Hamon"]}', 40),
	('SUP', 'jojo', 'Spin Upgrade Points', 2, 'spinMastery', '{"key": "path", "in": ["Spin"]}', 41),
	('VUP', 'jojo', 'Vampire Upgrade Points', 4, 'vampireUpgradePoints', '{"key": "path", "in": ["Vampire"]}', 42),
	('SGUP', 'fire-force', 'Second Generation Upgrade Points', 5, null, '{"key": "generation", "in": ["Second"]}', 50),
	('TGUP', 'fire-force', 'Third Generation Upgrade Points', 3, null, '{"key": "generation", "in": ["Third"]}', 51)
on conflict (code) do update set system = excluded.system, label = excluded.label, earn = excluded.earn,
	field = excluded.field, show_if = excluded.show_if, sort = excluded.sort;

insert into public.point_conversions (id, from_code, from_amount, to_code, to_amount) values
	(1, 'JJUUP', 5, 'CEUP', 2),
	(2, 'JJUUP', 10, 'CTUP', 2),
	(3, 'JJUUP', 55, 'BTUP', 1)
on conflict (id) do update set from_code = excluded.from_code, from_amount = excluded.from_amount,
	to_code = excluded.to_code, to_amount = excluded.to_amount;


-- ───────────────────────────── Access ─────────────────────────────

alter table public.point_currencies enable row level security;
alter table public.point_conversions enable row level security;
alter table public.character_points enable row level security;
alter table public.point_ledger enable row level security;

drop policy if exists "Anyone reads currencies" on public.point_currencies;
create policy "Anyone reads currencies" on public.point_currencies for select using (true);
drop policy if exists "Anyone reads conversions" on public.point_conversions;
create policy "Anyone reads conversions" on public.point_conversions for select using (true);

drop policy if exists "Owners and admins read points" on public.character_points;
create policy "Owners and admins read points" on public.character_points for select using (
	public.is_admin() or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())
);
drop policy if exists "Owners and admins read the ledger" on public.point_ledger;
create policy "Owners and admins read the ledger" on public.point_ledger for select using (
	public.is_admin() or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())
);

revoke all on public.point_currencies, public.point_conversions, public.character_points, public.point_ledger from anon, authenticated;
grant select on public.point_currencies, public.point_conversions to anon, authenticated;
grant select on public.character_points, public.point_ledger to authenticated;
grant all on public.point_currencies, public.point_conversions, public.character_points, public.point_ledger to service_role;


-- ───────────────────────────── Helpers ─────────────────────────────

/** Whether a currency applies to a card's fields (its show_if matches). */
create or replace function public.points_applies(p_show_if jsonb, p_fields jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select p_show_if is null
		or coalesce(p_fields ->> (p_show_if ->> 'key'), '') in (select jsonb_array_elements_text(p_show_if -> 'in'));
$$;

/** The sheet with one card field set to a number. */
create or replace function public.points_set_field(p_sheet jsonb, p_card text, p_field text, p_value int)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select case
		when jsonb_typeof(p_sheet) <> 'object' or jsonb_typeof(p_sheet -> 'systems') <> 'array' then p_sheet
		else jsonb_set(p_sheet, '{systems}', (
			select coalesce(jsonb_agg(
				case when e ->> 'key' = p_card
					then jsonb_set(e, '{fields}', coalesce(case when jsonb_typeof(e -> 'fields') = 'object' then e -> 'fields' end, '{}'::jsonb)
						|| jsonb_build_object(p_field, p_value))
					else e end
				order by i), '[]'::jsonb)
			from jsonb_array_elements(p_sheet -> 'systems') with ordinality as t (e, i)
		))
	end;
$$;

/** Adds (or takes) points from one wallet and logs it. Callers check who may do it. */
create or replace function public.points_add(p_character uuid, p_card text, p_currency text, p_change int,
	p_source text, p_reason text, p_actor text, p_ref uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	cur int;
	label text;
begin
	select balance into cur from public.character_points
	where character_id = p_character and card_key = p_card and currency = p_currency for update;
	cur := coalesce(cur, 0);
	if coalesce(p_change, 0) = 0 then
		return cur;
	end if;
	if cur + p_change < 0 then
		select c.label into label from public.point_currencies c where c.code = p_currency;
		raise exception 'Not enough % (you have %, this needs %).', coalesce(label, p_currency), cur, -p_change using errcode = 'P0001';
	end if;
	insert into public.character_points (character_id, card_key, currency, balance)
	values (p_character, p_card, p_currency, cur + p_change)
	on conflict (character_id, card_key, currency) do update set balance = excluded.balance, updated_at = now();
	insert into public.point_ledger (character_id, card_key, currency, change, balance_after, source, reason, actor, ref)
	values (p_character, p_card, p_currency, p_change, cur + p_change, p_source, left(btrim(coalesce(p_reason, '')), 300), p_actor, p_ref);
	return cur + p_change;
end;
$$;

/** Rewrites the sheet fields that show balances so the sheet matches the wallets. */
create or replace function public.points_touch(p_character uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- Trusted like a family owner's review, so guard_character lets the sync trigger change the approved sheet.
	perform set_config('portal.family_review', 'on', true);
	update public.characters set updated_at = now() where id = p_character;
	perform set_config('portal.family_review', '', true);
end;
$$;


-- ───────────────────────────── Sheet sync ─────────────────────────────

-- On every change to a character: cards on the approved sheet that have no wallet yet start with
-- the number on the sheet, then every wallet is written back onto both sheets.
create or replace function public.sync_character_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	r record;
begin
	if jsonb_typeof(new.approved_sheet -> 'systems') = 'array' then
		for r in
			select e ->> 'key' as card, c.code, c.field,
				greatest(0, least(1000000, floor(case when (e -> 'fields' ->> c.field) ~ '^-?[0-9]+(\.[0-9]+)?$'
					then (e -> 'fields' ->> c.field)::numeric else 0 end)))::int as start
			from jsonb_array_elements(new.approved_sheet -> 'systems') e
			join public.point_currencies c on c.system = e ->> 'system' and c.field is not null
				and public.points_applies(c.show_if, e -> 'fields')
			where coalesce(e ->> 'key', '') <> ''
				and not exists (select 1 from public.character_points p
					where p.character_id = new.id and p.card_key = e ->> 'key' and p.currency = c.code)
		loop
			insert into public.character_points (character_id, card_key, currency, balance)
			values (new.id, r.card, r.code, r.start) on conflict do nothing;
			if r.start > 0 then
				insert into public.point_ledger (character_id, card_key, currency, change, balance_after, source, reason)
				values (new.id, r.card, r.code, r.start, r.start, 'sheet', 'Starting balance from the approved sheet');
			end if;
		end loop;
	end if;

	for r in
		select p.card_key, c.field, p.balance
		from public.character_points p join public.point_currencies c on c.code = p.currency
		where p.character_id = new.id and c.field is not null
	loop
		new.sheet := public.points_set_field(new.sheet, r.card_key, r.field, r.balance);
		if new.approved_sheet is not null then
			new.approved_sheet := public.points_set_field(new.approved_sheet, r.card_key, r.field, r.balance);
		end if;
	end loop;
	return new;
end;
$$;

-- Named to run after guard_character (triggers fire in name order).
drop trigger if exists zz_sync_character_points on public.characters;
create trigger zz_sync_character_points
	before insert or update on public.characters
	for each row execute function public.sync_character_points();


-- ───────────────────────────── Site ─────────────────────────────

/** A player converts on their own approved character: p_times × the conversion. */
create or replace function public.convert_points(p_character uuid, p_card text, p_conversion int, p_times int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	conv public.point_conversions;
	card jsonb;
begin
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not (ch.owner_id = auth.uid() or public.is_admin()) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if ch.approved_at is null or ch.status = 'denied' then
		raise exception 'Only approved characters can convert points.' using errcode = 'P0001';
	end if;
	if coalesce(p_times, 0) not between 1 and 1000 then
		raise exception 'Convert from 1 to 1000 times at once.' using errcode = 'P0001';
	end if;
	select * into conv from public.point_conversions where id = p_conversion;
	if conv.id is null then
		raise exception 'That conversion doesn''t exist.' using errcode = 'P0001';
	end if;
	select e into card from jsonb_array_elements(ch.approved_sheet -> 'systems') e where e ->> 'key' = p_card;
	if card is null or card ->> 'system' is distinct from (select system from public.point_currencies where code = conv.from_code) then
		raise exception 'That system card can''t use this conversion.' using errcode = 'P0001';
	end if;
	if not public.points_applies((select show_if from public.point_currencies where code = conv.to_code), card -> 'fields') then
		raise exception 'This card doesn''t use %.', conv.to_code using errcode = 'P0001';
	end if;

	perform public.points_add(p_character, p_card, conv.from_code, -conv.from_amount * p_times, 'convert',
		format('→ %s %s', conv.to_amount * p_times, conv.to_code), auth.uid()::text);
	perform public.points_add(p_character, p_card, conv.to_code, conv.to_amount * p_times, 'convert',
		format('%s %s →', conv.from_amount * p_times, conv.from_code), auth.uid()::text);
	perform public.points_touch(p_character);
end;
$$;

/** Admins add (positive) or take (negative) points. */
create or replace function public.adjust_points(p_character uuid, p_card text, p_currency text, p_change int, p_reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	after int;
begin
	if not public.is_admin() then
		raise exception 'Only admins can change points.' using errcode = '42501';
	end if;
	if not exists (select 1 from public.characters c, jsonb_array_elements(c.approved_sheet -> 'systems') e
		where c.id = p_character and e ->> 'key' = p_card) then
		raise exception 'That system card isn''t on the approved sheet.' using errcode = 'P0001';
	end if;
	if coalesce(p_change, 0) = 0 or abs(p_change) > 100000 then
		raise exception 'Change by 1 to 100000 points.' using errcode = 'P0001';
	end if;
	after := public.points_add(p_character, p_card, p_currency, p_change, 'staff', p_reason, auth.uid()::text);
	perform public.points_touch(p_character);
	return after;
end;
$$;

revoke execute on function public.points_add(uuid, text, text, int, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.points_touch(uuid) from public, anon, authenticated;
revoke execute on function public.sync_character_points() from public, anon, authenticated;
revoke execute on function public.convert_points(uuid, text, int, int) from public, anon;
revoke execute on function public.adjust_points(uuid, text, text, int, text) from public, anon;
grant execute on function public.convert_points(uuid, text, int, int) to authenticated;
grant execute on function public.adjust_points(uuid, text, text, int, text) to authenticated;


-- ───────────────────────────── Starting balances ─────────────────────────────

-- Every approved character's current numbers become its starting wallets.
update public.characters set updated_at = updated_at where approved_sheet is not null;
