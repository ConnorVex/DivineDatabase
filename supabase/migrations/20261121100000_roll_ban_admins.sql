-- Roll bans on admins. Admins can roll-ban players, but not each other: only the prime owner
-- can roll-ban (or lift a roll ban from) another admin.
--
-- Run once in the SQL Editor after 20261120100000_encrypted_characters.sql.

-- The prime owner: the one Discord account above every other admin.
create or replace function public.is_prime_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from auth.identities i
		where i.user_id = auth.uid() and i.provider = 'discord' and i.provider_id = '530159153482694666'
	);
$$;

create or replace function public.set_roll_lock(p_owner uuid, p_locked boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.require_admin();
	if not public.is_prime_owner() and exists (
		select 1 from public.profiles p join public.admins a on a.discord_id = p.discord_id where p.id = p_owner
	) then
		raise exception 'Only the prime owner can roll-ban an admin.' using errcode = '42501';
	end if;
	if p_locked then
		insert into public.roll_locks (owner_id, reason, locked_by) values (p_owner, coalesce(p_reason, ''), auth.uid())
		on conflict (owner_id) do update set reason = excluded.reason, locked_by = excluded.locked_by, locked_at = now();
		perform public.log_roll_event(p_owner, 'locked', jsonb_build_object('reason', p_reason));
	else
		delete from public.roll_locks where owner_id = p_owner;
		perform public.log_roll_event(p_owner, 'unlocked');
	end if;
end;
$$;

revoke execute on function public.is_prime_owner() from public, anon;
grant execute on function public.is_prime_owner() to authenticated;
