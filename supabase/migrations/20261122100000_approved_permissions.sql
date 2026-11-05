-- Approved requests stay approved. When an admin approves a "needs permission" item, its text is
-- kept here, so the form and the review page show it as approved from then on instead of asking again.
--
-- Run once in the SQL Editor after 20261121100000_roll_ban_admins.sql.

alter table public.characters
	add column if not exists approved_permissions text[] not null default '{}';

-- Only admins (or the service role) change it.
create or replace function public.guard_character_permissions()
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
		new.approved_permissions := '{}';
	else
		new.approved_permissions := old.approved_permissions;
	end if;
	return new;
end;
$$;

drop trigger if exists characters_permissions_guard on public.characters;
create trigger characters_permissions_guard
	before insert or update on public.characters
	for each row execute function public.guard_character_permissions();
