-- Fix: the gallery view stopped working for players and visitors.
--
-- 20261130150000_sealed_families.sql made the view call public.character_seal(), which only the
-- database itself may run, so every read of the gallery failed with "permission denied for
-- function character_seal" (the family pages' portraits and the character gallery read it).
-- The view now asks public.sealed(c) instead: the same answer, through a function players may
-- call (it runs with the owner's rights and says only whether the character is sealed).
--
-- Run once in the SQL Editor. Safe to run more than once.

create or replace view public.gallery as
select
	c.id,
	c.kind,
	c.canon_universe,
	c.approved_name as name,
	case
		when c.encrypted or s.sealed then null
		when c.admin_character then public.mask_error_tiers(c.approved_sheet)
		else c.approved_sheet
	end as sheet,
	c.approved_at,
	p.display_name as player_name,
	p.avatar_url as player_avatar,
	c.encrypted or s.sealed as encrypted
from public.characters c
join public.profiles p on p.id = c.owner_id
cross join lateral (select public.sealed(c) as sealed) s
where c.approved_at is not null
	and not c.hidden
	and c.status <> 'denied';

grant select on public.gallery to anon, authenticated;
