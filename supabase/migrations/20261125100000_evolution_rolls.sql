-- Evolution rolls made on the character's own power system tab, starting with Quirks:
--
--   * quirk_instability  1d1000: 500+ makes the Quirk unstable for 3 RPs. 3 failed rolls in a row
--                        and the player must redo the requirements; staff then reset the rolls.
--                        Cooldown: one Instability roll per RP. Until RPs are tracked, an RP is a day,
--                        so a Quirk card rolls Instability at most once every 24 hours.
--   * quirk_evolution    1d10000 on the last turn of the 3rd unstable RP (Spontaneous Evolution),
--                        so no sooner than 3 days (3 RPs) after the Quirk went unstable:
--                        0–1,000 nothing, 1,001–5,000 Awakening, 5,001–7,999 Plus Variant,
--                        8,000–9,949 Maximum Variant, 9,950+ Infinite Variant.
--   * overclock_instability  1d10, every turn an overclocked Ability stays at 50+ Instability:
--                        1–5 nothing, 6–9 Overclock ends (10-turn cooldown), 10 the ability is gone for good.
--                        Only a lost ability goes in the evolution log (these are rolled every turn).
--   * stand_arrow        1d1000, once per RP, for a JoJo character without a Stand: 700+ finds a Stand
--                        Arrow (the GMs then roll whether they survive it).
--   * arc_roll           1d1000, for an inFAMOUS Conduit searching for evolution items: 0–499 nothing,
--                        500–790 Blast Shard, 791–899 Blast Core, 900+ Core Relay (Mainland only).
--                        3 rolls per location per RP, 5 turns apart; players and GMs keep to that.
--   * adolla_peek        1d10, for a Fire Force card with a Stigma peering into a nearby Adolla Link:
--                        5+ sees into it. 2 tries per Link; until RPs are tracked a Link is one RP, so a
--                        card peeks at most twice in 24 hours.
--
-- Rates from the Index (My Hero Academia: Quirk Evolution; Abilities: Overclocking and Underclocking; JoJo: Stand Basics; inFAMOUS: Conduit Evolution; Fire Force: Adolla). Rolls are made by the database, never the
-- browser; players can read their characters' rolls but not change them. Each roll is written to the
-- character's evolution log. Only approved characters roll, and an account roll lock stops these too.
--
-- Run once in the SQL Editor after 20261124100000_tree_starting_skills.sql.

create table public.evolution_rolls (
	id bigint generated always as identity primary key,
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	kind text not null check (kind in ('quirk_instability', 'quirk_evolution', 'overclock_instability', 'stand_arrow', 'arc_roll', 'adolla_peek')),
	sides int not null,
	roll int not null,
	result text not null,
	actor uuid references public.profiles (id) on delete set null,
	-- Staff reset (e.g. after 3 failed Instability rolls once the requirements are redone).
	void boolean not null default false,
	created_at timestamptz not null default now()
);

create index evolution_rolls_card_idx on public.evolution_rolls (character_id, card_key, created_at);

alter table public.evolution_rolls enable row level security;

create policy "evolution rolls: owner or admin reads" on public.evolution_rolls
	for select to authenticated
	using (public.is_admin() or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));

/** What a roll gives. */
create or replace function public.evolution_roll_result(p_kind text, p_roll int)
returns text
language sql
immutable
set search_path = ''
as $$
	select case p_kind
		when 'quirk_instability' then case when p_roll >= 500 then 'unstable' else 'stable' end
		when 'quirk_evolution' then case
			when p_roll <= 1000 then 'nothing'
			when p_roll <= 5000 then 'awakening'
			when p_roll <= 7999 then 'plus'
			when p_roll <= 9949 then 'maximum'
			else 'infinite'
		end
		when 'overclock_instability' then case when p_roll <= 5 then 'steady' when p_roll <= 9 then 'exit' else 'lost' end
		when 'stand_arrow' then case when p_roll >= 700 then 'arrow' else 'no_arrow' end
		when 'adolla_peek' then case when p_roll >= 5 then 'seen' else 'unseen' end
		when 'arc_roll' then case when p_roll >= 900 then 'core_relay' when p_roll >= 791 then 'blast_core' when p_roll >= 500 then 'blast_shard' else 'no_item' end
	end;
$$;

create or replace function public.roll_evolution(p_character uuid, p_card text, p_kind text)
returns public.evolution_rolls
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	card jsonb;
	last_instability public.evolution_rolls;
	evolved boolean;
	fails int;
	last_quirk timestamptz;
	ready_at timestamptz;
	sides int := case p_kind when 'quirk_instability' then 1000 when 'quirk_evolution' then 10000 when 'overclock_instability' then 10 when 'stand_arrow' then 1000 when 'arc_roll' then 1000 when 'adolla_peek' then 10 end;
	n int;
	rolled public.evolution_rolls;
begin
	if sides is null then
		raise exception 'Unknown roll.' using errcode = 'P0001';
	end if;
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not (ch.owner_id = auth.uid() or public.is_admin()) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if ch.approved_at is null or ch.status = 'denied' then
		raise exception 'Only approved characters can roll for evolutions.' using errcode = 'P0001';
	end if;
	if exists (select 1 from public.roll_locks where owner_id = ch.owner_id) then
		raise exception 'An admin has locked rolling on this account.' using errcode = '42501';
	end if;
	select e into card from jsonb_array_elements(ch.approved_sheet -> 'systems') e where e ->> 'key' = p_card;

	if p_kind = 'overclock_instability' then
		if card is null or card ->> 'system' <> 'abilities' or coalesce(trim(card -> 'fields' ->> 'overclockSkills'), '') = '' then
			raise exception 'That ability hasn''t unlocked Overclocking.' using errcode = 'P0001';
		end if;
		n := public.roll_die(sides);
		insert into public.evolution_rolls (character_id, card_key, kind, sides, roll, result, actor)
		values (p_character, p_card, p_kind, sides, n, public.evolution_roll_result(p_kind, n), auth.uid())
		returning * into rolled;
		if rolled.result = 'lost' then
			perform public.skill_log(p_character,
				format('Rolled 10 on 1d10 for Overclock Instability: %s''s genes disintegrated. The ability is gone for good.', coalesce(nullif(card -> 'fields' ->> 'name', ''), 'the ability')), '');
		end if;
		return rolled;
	end if;

	if p_kind = 'stand_arrow' then
		if card is null or card ->> 'system' <> 'jojo' or coalesce(card -> 'fields' ->> 'hasStand', 'Yes') <> 'No' then
			raise exception 'Only an approved JoJo card without a Stand can look for a Stand Arrow.' using errcode = 'P0001';
		end if;
		n := public.roll_die(sides);
		insert into public.evolution_rolls (character_id, card_key, kind, sides, roll, result, actor)
		values (p_character, p_card, p_kind, sides, n, public.evolution_roll_result(p_kind, n), auth.uid())
		returning * into rolled;
		perform public.skill_log(p_character, format('Rolled %s on 1d1000 for a Stand Arrow: %s.', n,
			case rolled.result when 'arrow' then 'found one (the GMs roll whether they survive it)' else 'nothing found' end), '');
		return rolled;
	end if;

	if p_kind = 'adolla_peek' then
		if card is null or card ->> 'system' <> 'fire-force' or coalesce(card -> 'fields' ->> 'stigma', '') <> 'Yes' then
			raise exception 'Only an approved Fire Force card with a Stigma can peer into Adolla Links.' using errcode = 'P0001';
		end if;
		select min(created_at) into ready_at from (
			select created_at from public.evolution_rolls
				where character_id = p_character and card_key = p_card and not void and kind = 'adolla_peek' and created_at > now() - interval '1 day'
				order by created_at desc limit 2) recent
			having count(*) >= 2;
		if ready_at is not null then
			raise exception 'You''ve used both peeks for this Link. Next peek after %.', to_char((ready_at + interval '1 day') at time zone 'UTC', 'Mon DD, HH24:MI "UTC"')
				using errcode = 'P0001';
		end if;
		n := public.roll_die(sides);
		insert into public.evolution_rolls (character_id, card_key, kind, sides, roll, result, actor)
		values (p_character, p_card, p_kind, sides, n, public.evolution_roll_result(p_kind, n), auth.uid())
		returning * into rolled;
		perform public.skill_log(p_character, format('Rolled %s on 1d10 to peer into an Adolla Link: %s.', n,
			case rolled.result when 'seen' then 'saw into it' else 'couldn''t see in' end), '');
		return rolled;
	end if;

	if p_kind = 'arc_roll' then
		if card is null or card ->> 'system' <> 'infamous' then
			raise exception 'Only an approved Conduit can make Arc Rolls.' using errcode = 'P0001';
		end if;
		n := public.roll_die(sides);
		insert into public.evolution_rolls (character_id, card_key, kind, sides, roll, result, actor)
		values (p_character, p_card, p_kind, sides, n, public.evolution_roll_result(p_kind, n), auth.uid())
		returning * into rolled;
		perform public.skill_log(p_character, format('Arc Roll: %s on 1d1000, %s.', n,
			case rolled.result when 'core_relay' then 'a Core Relay (Mainland only)' when 'blast_core' then 'a Blast Core' when 'blast_shard' then 'a Blast Shard' else 'nothing found' end), '');
		return rolled;
	end if;

	if card is null or card ->> 'system' <> 'quirk' then
		raise exception 'That card isn''t an approved Quirk.' using errcode = 'P0001';
	end if;
	if coalesce(card -> 'fields' ->> 'variant', 'None') in ('Plus', 'Maximum', 'Infinite') then
		raise exception 'This Quirk is already a Variant, so Instability is gone for good.' using errcode = 'P0001';
	end if;
	if coalesce(ch.approved_sheet -> 'potential' ->> 'grade', '') not in ('great', 'high', 'insane', 'immense', 'colossal', 'tremendous', 'peak', 'ultimate', 'apex', 'divine') then
		raise exception 'Quirk Instability needs Great Potential or higher.' using errcode = 'P0001';
	end if;

	-- Where the card stands: the last Instability roll, whether it's been rolled for evolution since,
	-- and the failed Instability rolls in a row.
	select * into last_instability from public.evolution_rolls
		where character_id = p_character and card_key = p_card and not void and kind = 'quirk_instability'
		order by created_at desc, id desc limit 1;
	evolved := last_instability.id is not null and exists (
		select 1 from public.evolution_rolls where character_id = p_character and card_key = p_card and not void
			and kind = 'quirk_evolution' and id > last_instability.id);
	select count(*) into fails from public.evolution_rolls r
		where r.character_id = p_character and r.card_key = p_card and not r.void and r.kind = 'quirk_instability' and r.result = 'stable'
			and r.id > coalesce((select max(id) from public.evolution_rolls x where x.character_id = p_character and x.card_key = p_card
				and not x.void and (x.result = 'unstable' or x.kind = 'quirk_evolution')), 0);

	-- Cooldowns in real-life time (an RP is a day until RPs are tracked).
	select max(created_at) into last_quirk from public.evolution_rolls
		where character_id = p_character and card_key = p_card and not void and kind in ('quirk_instability', 'quirk_evolution');
	ready_at := case
		when last_instability.result = 'unstable' and not evolved then last_instability.created_at + interval '3 days'
		else last_quirk + interval '1 day'
	end;
	if ready_at is not null and ready_at > now() then
		raise exception 'On cooldown until %. %', to_char(ready_at at time zone 'UTC', 'Mon DD, HH24:MI "UTC"'),
			case when last_instability.result = 'unstable' and not evolved then 'Spontaneous Evolution comes after your 3 unstable RPs.' else 'Instability is rolled once per RP.' end
			using errcode = 'P0001';
	end if;

	if p_kind = 'quirk_instability' then
		if last_instability.result = 'unstable' and not evolved then
			raise exception 'Your Quirk is already unstable. Roll for Spontaneous Evolution on the last turn of your 3rd unstable RP.' using errcode = 'P0001';
		end if;
		if fails >= 3 then
			raise exception '3 failed rolls. Use your Quirk 3 more times and store 50 QUP again, then ask staff to reset your rolls.' using errcode = 'P0001';
		end if;
	elsif last_instability.result is distinct from 'unstable' or evolved then
		raise exception 'Spontaneous Evolution is rolled once, at the end of an Instability.' using errcode = 'P0001';
	end if;

	n := public.roll_die(sides);
	insert into public.evolution_rolls (character_id, card_key, kind, sides, roll, result, actor)
	values (p_character, p_card, p_kind, sides, n, public.evolution_roll_result(p_kind, n), auth.uid())
	returning * into rolled;

	perform public.skill_log(p_character,
		case p_kind
			when 'quirk_instability' then format('Rolled %s on 1d1000 for Quirk Instability: %s.', n,
				case rolled.result when 'unstable' then 'unstable for 3 RPs' else 'no instability' end)
			else format('Rolled %s on 1d10000 for Spontaneous Evolution: %s.', n,
				case rolled.result when 'nothing' then 'nothing happened' when 'awakening' then 'a Quirk Awakening'
					else initcap(rolled.result) || ' Variant' end)
		end, '');
	return rolled;
end;
$$;

/** Staff: clears a card's rolls of one kind (or all), e.g. once 3 failed rolls' requirements are redone. */
create or replace function public.reset_evolution_rolls(p_character uuid, p_card text, p_kind text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only staff can reset rolls.' using errcode = '42501';
	end if;
	update public.evolution_rolls set void = true
		where character_id = p_character and card_key = p_card and not void and (p_kind is null or kind = p_kind);
	perform public.skill_log(p_character, 'Staff reset the evolution rolls.', '');
end;
$$;

revoke execute on function public.roll_evolution(uuid, text, text) from public, anon;
revoke execute on function public.reset_evolution_rolls(uuid, text, text) from public, anon;
grant execute on function public.roll_evolution(uuid, text, text) to authenticated;
grant execute on function public.reset_evolution_rolls(uuid, text, text) to authenticated;
grant select on public.evolution_rolls to authenticated;
