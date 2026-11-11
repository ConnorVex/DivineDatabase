-- Inbox: every player sees, in one place, how everything they sent was decided and why.
--
--   * public.inbox: one row per message, with a copy of the reason as it was written, so a
--     message survives the source being edited or deleted (a declined join request deletes its
--     row, for example).
--   * Triggers on the source tables write the rows. They never block a decision: a failure is
--     only a warning. Nobody gets a message about something they did themselves.
--   * Outcomes of what a player sent: characters, evolutions, equipment, families, perk requests,
--     join requests, tryouts, inheritance rolls, sealed-family access, M:AFO requests, encryption.
--   * Staff actions on a player's things: staff overrides and notes, removed characters, roll
--     locks, grants (Heavenly Restriction, custom powers, family powers, locked systems) and
--     staff point changes.
--   * To-dos for family owners: join requests, tryouts and new characters that picked the family.
--   * Players read only their own rows. inbox_unread_count() feeds the top bar's badge;
--     inbox_mark_read() clears it when the Inbox page opens.
--   * Past decisions are copied in, already read.
--
-- Run once in the SQL Editor after 20261217100000_override_mode.sql.

create table if not exists public.inbox (
	id bigint generated always as identity primary key,
	recipient uuid not null references public.profiles (id) on delete cascade,
	kind text not null check (kind in (
		'character', 'evolution', 'equipment', 'family', 'perks', 'join', 'tryout', 'inheritance',
		'sealed_access', 'mafo', 'encryption', 'override', 'note', 'removed', 'roll_lock', 'grant', 'points',
		'todo_join', 'todo_tryout', 'todo_pick')),
	-- approved | needs_correction | denied | partial (some perks yes, some no) | info | todo
	outcome text not null check (outcome in ('approved', 'needs_correction', 'denied', 'partial', 'info', 'todo')),
	-- e.g. the character's name; subtitle says what it is about ("Tryout for House Vale").
	title text not null default '' check (char_length(title) <= 300),
	subtitle text not null default '' check (char_length(subtitle) <= 300),
	-- The reason or note, as written at the time.
	body text not null default '' check (char_length(body) <= 10000),
	-- A path on the site, without the leading slash, e.g. 'character/?id=…'.
	link text not null default '' check (char_length(link) <= 300),
	actor uuid references public.profiles (id) on delete set null,
	-- 'table:id' of the source row.
	ref text not null default '',
	created_at timestamptz not null default now(),
	read_at timestamptz
);

create index if not exists inbox_recipient_created on public.inbox (recipient, created_at desc);
create index if not exists inbox_recipient_unread on public.inbox (recipient) where read_at is null;

alter table public.inbox enable row level security;
revoke all on public.inbox from anon, authenticated;
grant select on public.inbox to authenticated;
drop policy if exists "read own inbox" on public.inbox;
create policy "read own inbox" on public.inbox
	for select to authenticated using (recipient = (select auth.uid()));

-- Adds one message. Skips a missing recipient (e.g. mid account deletion) and the player's own
-- actions, and never raises.
create or replace function public.inbox_add(
	p_recipient uuid, p_kind text, p_outcome text, p_title text,
	p_subtitle text default '', p_body text default '', p_link text default '', p_ref text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if p_recipient is null or p_recipient = auth.uid()
		or not exists (select 1 from public.profiles where id = p_recipient) then
		return;
	end if;
	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref)
	values (p_recipient, p_kind, p_outcome, left(coalesce(p_title, ''), 300), left(coalesce(p_subtitle, ''), 300),
		left(coalesce(p_body, ''), 10000), left(coalesce(p_link, ''), 300), auth.uid(), coalesce(p_ref, ''));
exception when others then
	raise warning 'Inbox message failed: %', sqlerrm;
end;
$$;

-- The reviewer's families, for a family owner's review of a character that picked them.
create or replace function public.inbox_family_names(p_sheet jsonb, p_owner uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select string_agg(f.name, ', ' order by f.name)
	from public.families f
	where f.owner_id = p_owner and jsonb_typeof(p_sheet -> 'families') = 'array'
		and f.id::text in (select jsonb_array_elements_text(p_sheet -> 'families'));
$$;

-- ───────────────────────────── Characters and evolutions ─────────────────────────────

-- review_character() and review_evolution() both leave a review note; the note is the message.
create or replace function public.inbox_review_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	evo boolean;
	fams text;
	sub text := '';
begin
	select * into c from public.characters where id = new.character_id;
	if c.id is null or c.admin_character then
		return null;
	end if;
	if new.outcome is not null then
		-- An evolution is still open while its review runs.
		evo := exists (select 1 from public.evolution_requests r
			where r.character_id = c.id and r.status in ('pending', 'needs_correction'));
		if not public.is_admin() then
			fams := public.inbox_family_names(c.sheet, auth.uid());
			if fams is not null then
				sub := 'Family review · ' || fams;
			end if;
		end if;
		perform public.inbox_add(c.owner_id, case when evo then 'evolution' else 'character' end, new.outcome::text,
			c.name, sub, new.body,
			case when new.outcome = 'needs_correction' then case when evo then 'evolve/?id=' else 'submit/?id=' end
				else 'character/?id=' end || c.id,
			'review_notes:' || new.id);
	elsif new.body like 'Evolution denied%' then
		perform public.inbox_add(c.owner_id, 'evolution', 'denied', c.name, '',
			regexp_replace(new.body, '^Evolution denied(: |\.)?', ''), 'character/?id=' || c.id, 'review_notes:' || new.id);
	elsif new.body like 'Staff override by %' then
		perform public.inbox_add(c.owner_id, 'override', 'info', c.name, '', new.body,
			'character/?id=' || c.id, 'review_notes:' || new.id);
	else
		perform public.inbox_add(c.owner_id, 'note', 'info', c.name, '', new.body,
			'character/?id=' || c.id, 'review_notes:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_review_note on public.review_notes;
create trigger inbox_review_note
	after insert on public.review_notes
	for each row execute function public.inbox_review_note();

-- Encryption switched on or off by staff, a request declined, and characters staff removed.
-- Also the family owners' to-do when a new character picks their family.
create or replace function public.inbox_character()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam record;
begin
	if tg_op = 'DELETE' then
		if not old.admin_character then
			perform public.inbox_add(old.owner_id, 'removed', 'info', old.name, 'Character removed by staff', '',
				'characters/', 'characters:' || old.id);
		end if;
		return null;
	end if;
	if new.admin_character then
		return null;
	end if;

	if tg_op = 'UPDATE' then
		if new.encrypted and not old.encrypted then
			perform public.inbox_add(new.owner_id, 'encryption', case when old.encryption_requested then 'approved' else 'info' end,
				new.name, case when old.encryption_requested then 'Encryption request' else 'Encrypted by staff' end, '',
				'character/?id=' || new.id, 'characters:' || new.id);
		elsif old.encrypted and not new.encrypted then
			perform public.inbox_add(new.owner_id, 'encryption', 'info', new.name, 'Encryption switched off by staff', '',
				'character/?id=' || new.id, 'characters:' || new.id);
		elsif old.encryption_requested and not new.encryption_requested and not new.encrypted then
			perform public.inbox_add(new.owner_id, 'encryption', 'denied', new.name, 'Encryption request', '',
				'character/?id=' || new.id, 'characters:' || new.id);
		end if;
	end if;

	-- Sent for review for the first time (or again) and not yet approved: the families it picked.
	if new.approved_at is null and new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending')
		and jsonb_typeof(new.sheet -> 'families') = 'array' then
		for fam in
			select f.name, f.owner_id from public.families f
			where f.status = 'approved' and f.owner_id is distinct from new.owner_id
				and f.id::text in (select jsonb_array_elements_text(new.sheet -> 'families'))
		loop
			perform public.inbox_add(fam.owner_id, 'todo_pick', 'todo', new.name, 'Wants to join ' || fam.name,
				'', 'admin/review/', 'characters:' || new.id);
		end loop;
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_character on public.characters;
create trigger inbox_character
	after insert or delete or update of status, encrypted, encryption_requested on public.characters
	for each row execute function public.inbox_character();

-- ───────────────────────────── Equipment ─────────────────────────────

create or replace function public.inbox_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.inbox_add(new.owner_id, 'equipment', new.status, new.name, '', new.review_note,
			'equipment/', 'equipment_requests:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_equipment on public.equipment_requests;
create trigger inbox_equipment
	after update of status on public.equipment_requests
	for each row execute function public.inbox_equipment();

-- ───────────────────────────── Families ─────────────────────────────

create or replace function public.inbox_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.inbox_add(new.owner_id, 'family', new.status::text, new.name, '', new.review_note,
			'families/view/?f=' || new.slug, 'families:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_family on public.families;
create trigger inbox_family
	after update of status on public.families
	for each row execute function public.inbox_family();

-- A perk request is decided once none of its perks is still pending: one message listing each.
create or replace function public.inbox_perk_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	ok int;
	no int;
	lines text;
begin
	if old.decided_at is not null or new.decided_at is null then
		return null;
	end if;
	select * into fam from public.families where id = new.family_id;
	if fam.id is null then
		return null;
	end if;
	select count(*) filter (where status = 'approved'), count(*) filter (where status = 'denied'),
		string_agg(case when status = 'approved' then '✓ ' else '✗ ' end || title
			|| case when review_note <> '' then ': ' || review_note else '' end, E'\n' order by sort, created_at)
	into ok, no, lines
	from public.family_perks where request_id = new.id;
	perform public.inbox_add(coalesce(new.sent_by, fam.owner_id), 'perks',
		case when no = 0 then 'approved' when ok = 0 then 'denied' else 'partial' end,
		fam.name, ok || ' approved, ' || no || ' denied', coalesce(lines, ''),
		'families/view/?f=' || fam.slug, 'family_perk_requests:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_perk_request on public.family_perk_requests;
create trigger inbox_perk_request
	after update of decided_at on public.family_perk_requests
	for each row execute function public.inbox_perk_request();

-- Join requests: the owner's to-do, then the answer. Declining deletes the request, and so does
-- removing a member, so the message is written on delete. A family or character being deleted
-- takes its rows with it; those are skipped.
create or replace function public.inbox_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	player uuid;
begin
	if tg_op = 'DELETE' then
		select * into fam from public.families where id = old.family_id;
		select owner_id into player from public.characters where id = old.character_id;
		if fam.id is null or (old.character_id is not null and player is null) then
			return null;
		end if;
		if old.status = 'requested' then
			perform public.inbox_add(coalesce(old.requested_by, player), 'join', 'denied', old.name,
				'Request to join ' || fam.name, '', 'families/view/?f=' || fam.slug, 'family_members:' || old.id);
		else
			perform public.inbox_add(player, 'join', 'info', old.name, 'Removed from ' || fam.name, '',
				'families/view/?f=' || fam.slug, 'family_members:' || old.id);
		end if;
		return null;
	end if;

	select * into fam from public.families where id = new.family_id;
	if tg_op = 'INSERT' and new.status = 'requested' then
		perform public.inbox_add(fam.owner_id, 'todo_join', 'todo', new.name, 'Asked to join ' || fam.name, new.message,
			'families/view/?f=' || fam.slug, 'family_members:' || new.id);
	elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'active' then
		perform public.inbox_add(new.requested_by, 'join', 'approved', new.name, 'Request to join ' || fam.name, '',
			'families/view/?f=' || fam.slug, 'family_members:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_family_member on public.family_members;
create trigger inbox_family_member
	after insert or delete or update of status on public.family_members
	for each row execute function public.inbox_family_member();

create or replace function public.inbox_tryout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
begin
	select * into fam from public.families where id = new.family_id;
	if tg_op = 'INSERT' then
		perform public.inbox_add(fam.owner_id, 'todo_tryout', 'todo', new.character_name, 'Tryout for ' || fam.name, '',
			'families/view/?f=' || fam.slug, 'family_tryouts:' || new.id);
	elsif old.status = 'pending' and new.status in ('accepted', 'declined') then
		perform public.inbox_add(new.player_id, 'tryout', case when new.status = 'accepted' then 'approved' else 'denied' end,
			new.character_name, 'Tryout for ' || fam.name, new.owner_note,
			'families/view/?f=' || fam.slug, 'family_tryouts:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_tryout on public.family_tryouts;
create trigger inbox_tryout
	after insert or update of status on public.family_tryouts
	for each row execute function public.inbox_tryout();

create or replace function public.inbox_inheritance_roll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
begin
	if old.status = 'pending' and new.status in ('won', 'lost') then
		select * into fam from public.families where id = new.family_id;
		perform public.inbox_add(new.player_id, 'inheritance', case when new.status = 'won' then 'approved' else 'denied' end,
			new.label, coalesce(nullif(new.character_name, ''), 'Your character') || ' · ' || coalesce(fam.name, 'family'),
			concat_ws(E'\n', nullif(new.note, ''), nullif(new.proof, '')),
			'characters/', 'family_inheritance_rolls:' || new.id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_inheritance_roll on public.family_inheritance_rolls;
create trigger inbox_inheritance_roll
	after update of status on public.family_inheritance_rolls
	for each row execute function public.inbox_inheritance_roll();

create or replace function public.inbox_inheritance_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
begin
	if old.status = 'pending' and new.status in ('allowed', 'declined') then
		select * into fam from public.families where id = new.family_id;
		perform public.inbox_add(new.player_id, 'sealed_access', case when new.status = 'allowed' then 'approved' else 'denied' end,
			fam.name, 'See the Inheritance', '', 'families/view/?f=' || fam.slug,
			'family_inheritance_access:' || new.family_id || ':' || new.player_id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_inheritance_access on public.family_inheritance_access;
create trigger inbox_inheritance_access
	after update of status on public.family_inheritance_access
	for each row execute function public.inbox_inheritance_access();

create or replace function public.inbox_family_power()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	pw text;
begin
	select * into fam from public.families where id = new.family_id;
	select name into pw from public.custom_powers where id = new.power_id;
	perform public.inbox_add(fam.owner_id, 'grant', 'info', coalesce(pw, 'A power'), 'Granted to ' || fam.name, new.note,
		'families/view/?f=' || fam.slug, 'family_power_grants:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_family_power on public.family_power_grants;
create trigger inbox_family_power
	after insert on public.family_power_grants
	for each row execute function public.inbox_family_power();

-- ───────────────────────────── M:AFO ─────────────────────────────

create or replace function public.inbox_mafo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	who text;
	what text;
begin
	if old.status <> 'pending' or new.status not in ('approved', 'denied') then
		return null;
	end if;
	if new.action = 'steal' then
		select name into who from public.characters where id = new.victim_character;
		what := 'Steal from ' || coalesce(who, 'a character');
	else
		select name into what from public.mafo_items where id = new.item_id;
		select name into who from public.characters where id = new.target_character;
		what := 'Transfer ' || coalesce(nullif(what, ''), 'a stored power') || ' to ' || coalesce(who, 'a character');
	end if;
	select name into who from public.characters where id = new.holder_character;
	perform public.inbox_add(new.requested_by, 'mafo', new.status, coalesce(who, 'M:AFO'), what, new.reason,
		'character/?id=' || new.holder_character, 'mafo_requests:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_mafo on public.mafo_requests;
create trigger inbox_mafo
	after update of status on public.mafo_requests
	for each row execute function public.inbox_mafo();

-- ───────────────────────────── Account: roll locks, grants, points ─────────────────────────────

create or replace function public.inbox_roll_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform public.inbox_add(new.owner_id, 'roll_lock', 'info', 'Rolling locked', 'On your account', new.reason,
			'characters/', 'roll_locks:' || new.owner_id);
	else
		perform public.inbox_add(old.owner_id, 'roll_lock', 'info', 'Rolling unlocked', 'On your account', '',
			'characters/', 'roll_locks:' || old.owner_id);
	end if;
	return null;
end;
$$;

drop trigger if exists inbox_roll_lock on public.roll_locks;
create trigger inbox_roll_lock
	after insert or delete on public.roll_locks
	for each row execute function public.inbox_roll_lock();

create or replace function public.inbox_heavenly_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.inbox_add(new.profile_id, 'grant', 'info', new.restriction || ' Heavenly Restriction',
		'Granted to your account', new.note, 'submit/', 'heavenly_grants:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_heavenly_grant on public.heavenly_grants;
create trigger inbox_heavenly_grant
	after insert on public.heavenly_grants
	for each row execute function public.inbox_heavenly_grant();

create or replace function public.inbox_power_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	pw text;
	ch text;
begin
	select name into pw from public.custom_powers where id = new.power_id;
	select name into ch from public.characters where id = new.character_id;
	perform public.inbox_add(new.profile_id, 'grant', 'info', coalesce(pw, 'A power'),
		case when ch is not null then 'Granted to ' || ch else 'Granted to your account' end, new.note,
		case when new.character_id is not null then 'character/?id=' || new.character_id else 'characters/' end,
		'power_grants:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_power_grant on public.power_grants;
create trigger inbox_power_grant
	after insert on public.power_grants
	for each row execute function public.inbox_power_grant();

create or replace function public.inbox_system_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	sys text;
begin
	select name into sys from public.locked_systems where slug = new.system;
	perform public.inbox_add(new.profile_id, 'grant', 'info', coalesce(sys, new.system), 'Access granted', '',
		'submit/', 'system_access:' || new.profile_id || ':' || new.system);
	return null;
end;
$$;

drop trigger if exists inbox_system_access on public.system_access;
create trigger inbox_system_access
	after insert on public.system_access
	for each row execute function public.inbox_system_access();

create or replace function public.inbox_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	cur text;
begin
	if new.source <> 'staff' then
		return null;
	end if;
	select * into c from public.characters where id = new.character_id;
	if c.id is null or c.admin_character then
		return null;
	end if;
	select label into cur from public.point_currencies where code = new.currency;
	perform public.inbox_add(c.owner_id, 'points', 'info', c.name,
		case when new.change > 0 then '+' else '' end || new.change || ' ' || coalesce(cur, new.currency)
			|| ' (now ' || new.balance_after || ')',
		new.reason, 'character/?id=' || c.id, 'point_ledger:' || new.id);
	return null;
end;
$$;

drop trigger if exists inbox_points on public.point_ledger;
create trigger inbox_points
	after insert on public.point_ledger
	for each row execute function public.inbox_points();

-- ───────────────────────────── Reading ─────────────────────────────

create or replace function public.inbox_unread_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
	select count(*)::int from public.inbox where recipient = auth.uid() and read_at is null;
$$;

-- Marks everything read; returns how many were unread.
create or replace function public.inbox_mark_read()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	update public.inbox set read_at = now() where recipient = auth.uid() and read_at is null;
	get diagnostics n = row_count;
	return n;
end;
$$;

-- ───────────────────────────── Past decisions (already read) ─────────────────────────────

do $$
begin
	if exists (select 1 from public.inbox) then
		return; -- run once
	end if;

	-- Character reviews that weren't an evolution's.
	insert into public.inbox (recipient, kind, outcome, title, body, link, actor, ref, created_at, read_at)
	select c.owner_id, 'character', n.outcome::text, c.name, n.body,
		case when n.outcome = 'needs_correction' then 'submit/?id=' else 'character/?id=' end || c.id,
		n.author_id, 'review_notes:' || n.id, n.created_at, now()
	from public.review_notes n join public.characters c on c.id = n.character_id
	where n.outcome is not null and not c.admin_character and n.author_id is distinct from c.owner_id
		and not exists (select 1 from public.evolution_requests r
			where r.character_id = c.id and r.reviewed_at between n.created_at - interval '1 minute' and n.created_at + interval '1 minute');

	-- Staff overrides and notes (not the "Evolution denied" ones; those come from the requests).
	insert into public.inbox (recipient, kind, outcome, title, body, link, actor, ref, created_at, read_at)
	select c.owner_id, case when n.body like 'Staff override by %' then 'override' else 'note' end, 'info', c.name, n.body,
		'character/?id=' || c.id, n.author_id, 'review_notes:' || n.id, n.created_at, now()
	from public.review_notes n join public.characters c on c.id = n.character_id
	where n.outcome is null and n.body not like 'Evolution denied%' and not c.admin_character
		and n.author_id is distinct from c.owner_id;

	insert into public.inbox (recipient, kind, outcome, title, body, link, actor, ref, created_at, read_at)
	select r.owner_id, 'evolution', r.status::text, c.name, r.review_note,
		case when r.status = 'needs_correction' then 'evolve/?id=' else 'character/?id=' end || c.id,
		r.reviewed_by, 'evolution_requests:' || r.id, coalesce(r.reviewed_at, r.submitted_at), now()
	from public.evolution_requests r join public.characters c on c.id = r.character_id
	where r.status <> 'pending' and not c.admin_character and r.reviewed_by is distinct from r.owner_id;

	insert into public.inbox (recipient, kind, outcome, title, body, link, actor, ref, created_at, read_at)
	select e.owner_id, 'equipment', e.status, e.name, e.review_note, 'equipment/', e.reviewed_by,
		'equipment_requests:' || e.id, coalesce(e.reviewed_at, e.updated_at), now()
	from public.equipment_requests e
	where e.status <> 'pending' and e.reviewed_by is distinct from e.owner_id;

	insert into public.inbox (recipient, kind, outcome, title, body, link, actor, ref, created_at, read_at)
	select f.owner_id, 'family', f.status::text, f.name, f.review_note, 'families/view/?f=' || f.slug, f.reviewed_by,
		'families:' || f.id, coalesce(f.reviewed_at, f.updated_at), now()
	from public.families f
	where f.owner_id is not null and f.status <> 'pending' and f.reviewed_by is distinct from f.owner_id;

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, ref, created_at, read_at)
	select coalesce(r.sent_by, f.owner_id), 'perks',
		case when s.no = 0 then 'approved' when s.ok = 0 then 'denied' else 'partial' end,
		f.name, s.ok || ' approved, ' || s.no || ' denied', coalesce(s.lines, ''), 'families/view/?f=' || f.slug,
		'family_perk_requests:' || r.id, r.decided_at, now()
	from public.family_perk_requests r
	join public.families f on f.id = r.family_id
	cross join lateral (
		select count(*) filter (where p.status = 'approved') as ok, count(*) filter (where p.status = 'denied') as no,
			string_agg(case when p.status = 'approved' then '✓ ' else '✗ ' end || p.title
				|| case when p.review_note <> '' then ': ' || p.review_note else '' end, E'\n' order by p.sort, p.created_at) as lines
		from public.family_perks p where p.request_id = r.id
	) s
	where r.decided_at is not null and coalesce(r.sent_by, f.owner_id) is not null and s.ok + s.no > 0
		-- An admin's own perks were approved as they saved them.
		and not exists (select 1 from public.admins a join public.profiles pr on pr.discord_id = a.discord_id
			where pr.id = coalesce(r.sent_by, f.owner_id));

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, ref, created_at, read_at)
	select t.player_id, 'tryout', case when t.status = 'accepted' then 'approved' else 'denied' end, t.character_name,
		'Tryout for ' || f.name, t.owner_note, 'families/view/?f=' || f.slug, 'family_tryouts:' || t.id,
		coalesce(t.reviewed_at, t.created_at), now()
	from public.family_tryouts t join public.families f on f.id = t.family_id
	where t.status <> 'pending';

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref, created_at, read_at)
	select r.player_id, 'inheritance', case when r.status = 'won' then 'approved' else 'denied' end, r.label,
		coalesce(nullif(r.character_name, ''), 'Your character') || ' · ' || f.name,
		concat_ws(E'\n', nullif(r.note, ''), nullif(r.proof, '')), 'characters/', r.decided_by,
		'family_inheritance_rolls:' || r.id, coalesce(r.decided_at, r.created_at), now()
	from public.family_inheritance_rolls r join public.families f on f.id = r.family_id
	where r.status <> 'pending';

	insert into public.inbox (recipient, kind, outcome, title, subtitle, link, actor, ref, created_at, read_at)
	select a.player_id, 'sealed_access', case when a.status = 'allowed' then 'approved' else 'denied' end, f.name,
		'See the Inheritance', 'families/view/?f=' || f.slug, a.decided_by,
		'family_inheritance_access:' || a.family_id || ':' || a.player_id, coalesce(a.decided_at, a.created_at), now()
	from public.family_inheritance_access a join public.families f on f.id = a.family_id
	where a.status <> 'pending';

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref, created_at, read_at)
	select m.requested_by, 'mafo', m.status, coalesce(h.name, 'M:AFO'),
		case when m.action = 'steal' then 'Steal from ' || coalesce(v.name, 'a character')
			else 'Transfer ' || coalesce(nullif(i.name, ''), 'a stored power') || ' to ' || coalesce(t.name, 'a character') end,
		m.reason, 'character/?id=' || m.holder_character, m.decided_by, 'mafo_requests:' || m.id,
		coalesce(m.decided_at, m.requested_at), now()
	from public.mafo_requests m
	left join public.characters h on h.id = m.holder_character
	left join public.characters v on v.id = m.victim_character
	left join public.characters t on t.id = m.target_character
	left join public.mafo_items i on i.id = m.item_id
	where m.status <> 'pending' and m.requested_by is not null and m.decided_by is distinct from m.requested_by;

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref, created_at, read_at)
	select l.owner_id, 'roll_lock', 'info', 'Rolling locked', 'On your account', l.reason, 'characters/', l.locked_by,
		'roll_locks:' || l.owner_id, l.locked_at, now()
	from public.roll_locks l;

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref, created_at, read_at)
	select g.profile_id, 'grant', 'info', g.restriction || ' Heavenly Restriction', 'Granted to your account', g.note,
		'submit/', g.granted_by, 'heavenly_grants:' || g.id, g.granted_at, now()
	from public.heavenly_grants g
	where g.granted_by is distinct from g.profile_id;

	insert into public.inbox (recipient, kind, outcome, title, subtitle, body, link, actor, ref, created_at, read_at)
	select g.profile_id, 'grant', 'info', p.name,
		case when c.name is not null then 'Granted to ' || c.name else 'Granted to your account' end, g.note,
		case when g.character_id is not null then 'character/?id=' || g.character_id else 'characters/' end,
		g.granted_by, 'power_grants:' || g.id, g.granted_at, now()
	from public.power_grants g
	join public.custom_powers p on p.id = g.power_id
	left join public.characters c on c.id = g.character_id
	where g.granted_by is distinct from g.profile_id;

	insert into public.inbox (recipient, kind, outcome, title, subtitle, link, actor, ref, created_at, read_at)
	select a.profile_id, 'grant', 'info', s.name, 'Access granted', 'submit/', a.granted_by,
		'system_access:' || a.profile_id || ':' || a.system, a.granted_at, now()
	from public.system_access a join public.locked_systems s on s.slug = a.system
	where a.granted_by is distinct from a.profile_id;
end;
$$;

revoke execute on function public.inbox_add(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.inbox_family_names(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.inbox_review_note() from public, anon, authenticated;
revoke execute on function public.inbox_character() from public, anon, authenticated;
revoke execute on function public.inbox_equipment() from public, anon, authenticated;
revoke execute on function public.inbox_family() from public, anon, authenticated;
revoke execute on function public.inbox_perk_request() from public, anon, authenticated;
revoke execute on function public.inbox_family_member() from public, anon, authenticated;
revoke execute on function public.inbox_tryout() from public, anon, authenticated;
revoke execute on function public.inbox_inheritance_roll() from public, anon, authenticated;
revoke execute on function public.inbox_inheritance_access() from public, anon, authenticated;
revoke execute on function public.inbox_family_power() from public, anon, authenticated;
revoke execute on function public.inbox_mafo() from public, anon, authenticated;
revoke execute on function public.inbox_roll_lock() from public, anon, authenticated;
revoke execute on function public.inbox_heavenly_grant() from public, anon, authenticated;
revoke execute on function public.inbox_power_grant() from public, anon, authenticated;
revoke execute on function public.inbox_system_access() from public, anon, authenticated;
revoke execute on function public.inbox_points() from public, anon, authenticated;
revoke execute on function public.inbox_unread_count() from public, anon;
revoke execute on function public.inbox_mark_read() from public, anon;
grant execute on function public.inbox_unread_count() to authenticated;
grant execute on function public.inbox_mark_read() to authenticated;
