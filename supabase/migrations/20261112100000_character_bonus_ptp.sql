-- Bonus PTP: extra starting tier points staff grant a character (for example, from a perk it
-- used to have). Counted on top of the role, systems and traits. Only admins can change it.
--
-- Run once in the SQL Editor.

alter table public.characters
	add column if not exists bonus_ptp int not null default 0 check (bonus_ptp between 0 and 200);

create or replace function public.guard_character_bonus_ptp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- SQL Editor / service code has no logged-in user role; admins are trusted too.
	if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin() then
		return new;
	end if;
	if tg_op = 'INSERT' then
		new.bonus_ptp := 0;
	else
		new.bonus_ptp := old.bonus_ptp;
	end if;
	return new;
end;
$$;

drop trigger if exists characters_bonus_ptp_guard on public.characters;
create trigger characters_bonus_ptp_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_bonus_ptp();
