-- Maintenance mode. While it's on, every page of the Divine Database shows a "we're working on it"
-- screen to anyone who isn't a logged-in admin. Admins switch it in the admin panel.
--
-- Run once in the SQL Editor after 20261122100000_approved_permissions.sql.

create table if not exists public.site_settings (
	id boolean primary key default true check (id), -- a single row
	maintenance boolean not null default false,
	maintenance_message text not null default '' check (char_length(maintenance_message) <= 500),
	updated_at timestamptz not null default now(),
	updated_by uuid references public.profiles (id) on delete set null
);
insert into public.site_settings (id) values (true) on conflict do nothing;

alter table public.site_settings enable row level security;
drop policy if exists "anyone reads site settings" on public.site_settings;
create policy "anyone reads site settings" on public.site_settings for select to anon, authenticated using (true);
grant select on public.site_settings to anon, authenticated;
revoke insert, update, delete, truncate on public.site_settings from anon, authenticated;

-- Admins only.
create or replace function public.set_maintenance(p_on boolean, p_message text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can switch maintenance mode.' using errcode = '42501';
	end if;
	update public.site_settings
	set maintenance = p_on, maintenance_message = left(coalesce(trim(p_message), ''), 500), updated_at = now(), updated_by = auth.uid()
	where id;
end;
$$;

revoke execute on function public.set_maintenance(boolean, text) from public, anon;
grant execute on function public.set_maintenance(boolean, text) to authenticated;
