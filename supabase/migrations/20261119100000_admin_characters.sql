-- Admin characters, Divine Potential and Error Tiers.
--
--   admin_character: an admin's own character. No rule checks or limits, and it's approved as
--     soon as it's sent. Only admins can make one.
--   Divine Potential: story-based, set by staff only. It opens the Divine S.T.S (Kappa to Omega),
--     the ranks past 20A. admin_set_roll now accepts it.
--   Error Tiers: sheet.errorStats lists the stats (strength, speed, …) that show as ERROR to
--     everyone but admins. Only admin characters can have them.
--
-- Run once in the SQL Editor after 20261118100000_pinned_notes.sql.

alter table public.characters
	add column if not exists admin_character boolean not null default false;

-- Players can't make an admin character or give a sheet Error Tiers.
create or replace function public.guard_character_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin() then
		return new;
	end if;
	if tg_op = 'INSERT' then
		new.admin_character := false;
	else
		new.admin_character := old.admin_character;
	end if;
	if not new.admin_character then
		new.sheet := new.sheet - 'errorStats';
	elsif tg_op = 'UPDATE' then
		new.sheet := jsonb_set(new.sheet, '{errorStats}', coalesce(old.sheet -> 'errorStats', '[]'::jsonb), true);
	end if;
	return new;
end;
$$;

drop trigger if exists characters_admin_guard on public.characters;
create trigger characters_admin_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_admin();

create or replace function public.admin_set_roll(p_owner uuid, p_kind public.roll_kind, p_value text, p_character uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	res jsonb;
	cls text;
	idx int;
	c public.characters;
begin
	perform public.require_admin();
	if p_kind = 'potential' then
		if p_value not in ('limited', 'low', 'average', 'great', 'high', 'insane', 'immense', 'colossal', 'tremendous', 'peak', 'ultimate', 'apex', 'divine') then
			raise exception 'Unknown Potential "%".', p_value;
		end if;
		res := jsonb_build_object('roll', null, 'grade', p_value);
	else
		select key, ord::int into cls, idx
		from jsonb_each(public.ce_levels()) as l (key, value),
			jsonb_array_elements(l.value) with ordinality as x (lvl, ord)
		where lvl ->> 0 = p_value
		limit 1;
		if cls is null then
			raise exception 'Unknown Cursed Energy level "%".', p_value;
		end if;
		res := jsonb_build_object('classRoll', null, 'class', cls, 'amountRoll', idx, 'level', p_value,
			'cep', (public.ce_levels() -> cls -> (idx - 1) ->> 1)::int);
	end if;

	if p_character is not null then
		select * into c from public.characters where id = p_character;
		if c.id is null or c.owner_id <> p_owner then
			raise exception 'That character doesn''t belong to this player.';
		end if;
		update public.player_rolls set status = 'void', settled_at = now()
		where character_id = c.id and kind = p_kind and status <> 'void';
	end if;
	-- The new roll becomes the player's unsettled one unless it goes on an approved character,
	-- so only then does it replace whatever they're carrying.
	if c.approved_at is null then
		update public.player_rolls set status = 'void', settled_at = now() where owner_id = p_owner and kind = p_kind and status = 'active';
	end if;

	insert into public.player_rolls (owner_id, kind, result, character_id, status, source, settled_at)
	values (p_owner, p_kind, res, c.id,
		case when c.approved_at is not null then 'consumed'::public.roll_status else 'active'::public.roll_status end,
		'admin', case when c.approved_at is not null then now() end);
	perform public.log_roll_event(p_owner, 'admin_set', jsonb_build_object('kind', p_kind, 'result', res, 'character', c.id));

	if c.id is not null then
		update public.characters set sheet = public.apply_rolls(sheet, id, false) where id = c.id;
	end if;
	return res;
end;
$$;
