-- Unparalleled Potential: between Apex and Divine (Phase 3, up to tier 20). It's never rolled.
-- Admins give a family the "Unparalleled Potential" special status, and that family's owner hands it
-- out to the family's members (and can take it back).
--
-- Giving it adds a Potential roll to the character (source 'family'), so apply_rolls writes it onto
-- the sheet like any roll. Taking it back voids that roll, and the character's earlier Potential returns.

alter table public.player_rolls drop constraint if exists player_rolls_source_check;
alter table public.player_rolls add constraint player_rolls_source_check check (source in ('rolled', 'admin', 'family'));

-- The family's owner (or an admin) gives or takes back Unparalleled Potential for one of its members.
create or replace function public.set_unparalleled(p_family uuid, p_character uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	fam public.families;
	ch public.characters;
begin
	select * into fam from public.families where id = p_family;
	if fam.id is null then
		raise exception 'That family doesn''t exist.' using errcode = 'P0002';
	end if;
	if not (public.is_admin() or fam.owner_id = auth.uid()) then
		raise exception 'Only the family''s owner can give Unparalleled Potential.' using errcode = '42501';
	end if;
	if not ('Unparalleled Potential' = any (fam.special_statuses)) then
		raise exception '% doesn''t have Unparalleled Potential to give. Ask an admin.', fam.name using errcode = 'P0001';
	end if;
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not exists (select 1 from public.family_members m where m.family_id = fam.id and m.character_id = ch.id and m.status = 'active') then
		raise exception 'That character isn''t a member of %.', fam.name using errcode = 'P0001';
	end if;

	if p_on then
		if exists (select 1 from public.player_rolls where character_id = ch.id and kind = 'potential' and status <> 'void' and source = 'family') then
			return;
		end if;
		insert into public.player_rolls (owner_id, kind, result, character_id, status, source, settled_at)
		values (ch.owner_id, 'potential', jsonb_build_object('roll', null, 'grade', 'unparalleled', 'family', fam.id), ch.id, 'consumed', 'family', now());
	else
		update public.player_rolls set status = 'void', settled_at = now()
		where character_id = ch.id and kind = 'potential' and status <> 'void' and source = 'family';
	end if;

	-- Write the Potential onto both sheets now (trusted like a review, so the guard allows it).
	perform set_config('portal.family_review', 'on', true);
	update public.characters
	set sheet = public.apply_rolls(sheet, id, false),
		approved_sheet = case when approved_sheet is null then null else public.apply_rolls(approved_sheet, id, false) end
	where id = ch.id;
	perform set_config('portal.family_review', '', true);
end;
$$;

-- The family's members who have Unparalleled Potential from it. For its owner and admins.
create or replace function public.family_unparalleled(p_family uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(array_agg(distinct r.character_id), '{}')
	from public.player_rolls r
	join public.family_members m on m.character_id = r.character_id and m.family_id = p_family
	where r.kind = 'potential' and r.status <> 'void' and r.source = 'family' and r.result ->> 'family' = p_family::text
		and (public.is_admin() or exists (select 1 from public.families f where f.id = p_family and f.owner_id = auth.uid()));
$$;

-- Quirk Instability needs Great Potential or better: Unparalleled counts.
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
	if coalesce(ch.approved_sheet -> 'potential' ->> 'grade', '') not in ('great', 'high', 'insane', 'immense', 'colossal', 'tremendous', 'peak', 'ultimate', 'apex', 'unparalleled', 'divine') then
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

revoke execute on function public.set_unparalleled(uuid, uuid, boolean) from public, anon;
revoke execute on function public.family_unparalleled(uuid) from public, anon;
grant execute on function public.set_unparalleled(uuid, uuid, boolean) to authenticated;
grant execute on function public.family_unparalleled(uuid) to authenticated;
