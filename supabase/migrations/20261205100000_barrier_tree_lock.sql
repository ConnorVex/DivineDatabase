-- Barrier Techniques stay locked after approval unless something unlocks them, so the Barrier
-- Techniques skill tree ('jjk-barrier') can't be bought into until they are. Same rule as the site's
-- barrierUnlocked(): the Barrier Prodigy trait, a family ability card with Barrier Techniques, a staff
-- value on one of the card's Barrier fields, a character staff marked as already progressed, or an
-- approved card that already has Barrier Techniques. Admins can still give tree skills for free.

create or replace function public.barrier_open(p_character uuid, p_card text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	card jsonb;
	f jsonb;
	bt jsonb;
begin
	select * into ch from public.characters where id = p_character;
	if ch.id is null then
		return false;
	end if;
	if ch.progressed then
		return true;
	end if;
	if exists (
		select 1 from jsonb_array_elements(case when jsonb_typeof(ch.approved_sheet -> 'traits') = 'array' then ch.approved_sheet -> 'traits' else '[]' end) t
		where t ->> 'name' = 'Barrier Prodigy'
	) then
		return true;
	end if;
	if exists (
		select 1 from jsonb_object_keys(coalesce(ch.staff_overrides, '{}')) k
		where k in (select 'card:' || p_card || '.' || x from unnest(array['barrierTechniques', 'domainGrade', 'constructionSpeed', 'simpleDomainGrade', 'amplificationGrade', 'btUpgradePoints']) x)
	) then
		return true;
	end if;
	select e into card from jsonb_array_elements(case when jsonb_typeof(ch.approved_sheet -> 'systems') = 'array' then ch.approved_sheet -> 'systems' else '[]' end) e
	where e ->> 'key' = p_card;
	if card is null then
		return false;
	end if;
	f := coalesce(card -> 'fields', '{}');
	bt := f -> 'barrierTechniques';
	-- Barrier Techniques on the card (a list, or an old card's text box).
	if (jsonb_typeof(bt) = 'array' and jsonb_array_length(bt) > 0) or (jsonb_typeof(bt) = 'string' and btrim(bt #>> '{}') <> '') then
		return true; -- a family ability with them, or an approved card that already has them
	end if;
	-- Any Barrier stat off its starting value.
	return coalesce(nullif(f ->> 'domainGrade', ''), 'Grade 4') <> 'Grade 4'
		or coalesce(nullif(f ->> 'simpleDomainGrade', ''), 'Grade 4') <> 'Grade 4'
		or coalesce(nullif(f ->> 'amplificationGrade', ''), 'Grade 4') <> 'Grade 4'
		or coalesce(nullif(f ->> 'constructionSpeed', ''), '0 (5 turns)') <> '0 (5 turns)'
		or coalesce(nullif(f ->> 'btUpgradePoints', ''), '0') not in ('0', '0.0');
end;
$$;

-- Runs inside unlock_skill, so a refused unlock takes no points either.
create or replace function public.guard_barrier_unlock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.tree_id = 'jjk-barrier' and not public.is_admin() and not public.barrier_open(new.character_id, new.card_key) then
		raise exception 'Barrier Techniques are locked. They need the Barrier Prodigy trait, a family ability, or staff to unlock them.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

drop trigger if exists guard_barrier_unlock on public.character_unlocks;
create trigger guard_barrier_unlock before insert on public.character_unlocks
	for each row execute function public.guard_barrier_unlock();

revoke execute on function public.barrier_open(uuid, text) from public, anon, authenticated;
revoke execute on function public.guard_barrier_unlock() from public, anon, authenticated;
