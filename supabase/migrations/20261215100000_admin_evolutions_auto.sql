-- Admin character evolutions are approved straight away, with no announcement and no evolution log.
--
--   * submit_evolution: for an admin character it puts the changes live at once (as "Publish
--     changes" on the form does). No submission is kept, nothing goes to the review queue or
--     Discord, and no entry is added to the evolution log.
--   * Evolutions already waiting on admin characters are put live the same way, quietly.
--
-- Run once in the SQL Editor after 20261214100000_power_evolutions.sql.

create or replace function public.submit_evolution(p_character_id uuid, p_summary text, p_earned text default '', p_links text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	r public.evolution_requests;
begin
	select * into c from public.characters where id = p_character_id for update;
	if c.id is null or c.owner_id is distinct from auth.uid() then
		raise exception 'Character not found.' using errcode = '42501';
	end if;
	if c.approved_at is null then
		raise exception 'Only approved characters can evolve. Send this one for review instead.';
	end if;
	if c.status = 'denied' then
		raise exception 'This character is locked.';
	end if;

	-- Admin characters: live at once, no review, no ping (notify_character_status skips them), no log.
	if c.admin_character then
		delete from public.evolution_requests where character_id = c.id and status in ('pending', 'needs_correction');
		if c.status is distinct from 'approved' then
			update public.characters set status = 'approved' where id = c.id;
		end if;
		perform public.publish_admin_character(c.id);
		return null;
	end if;

	if char_length(btrim(coalesce(p_summary, ''))) = 0 then
		raise exception 'Describe what evolved.';
	end if;

	select * into r from public.evolution_requests where character_id = c.id and status in ('pending', 'needs_correction') for update;
	if r.id is null then
		insert into public.evolution_requests (character_id, owner_id, summary, earned, links)
		values (c.id, c.owner_id, btrim(p_summary), coalesce(p_earned, ''), coalesce(p_links, ''))
		returning * into r;
	else
		update public.evolution_requests
		set summary = btrim(p_summary), earned = coalesce(p_earned, ''), links = coalesce(p_links, ''),
			status = 'pending', submitted_at = case when status = 'pending' then submitted_at else now() end
		where id = r.id
		returning * into r;
	end if;

	if c.status is distinct from 'pending' then
		perform set_config('portal.evolution_submit', 'on', true);
		update public.characters set status = 'pending' where id = c.id;
		perform set_config('portal.evolution_submit', 'off', true);
	end if;
	return r.id;
end;
$$;

revoke execute on function public.submit_evolution(uuid, text, text, text) from public, anon;
grant execute on function public.submit_evolution(uuid, text, text, text) to authenticated;

-- Evolutions already waiting on admin characters: live now, quietly (no log entry, no ping).
delete from public.evolution_requests r
using public.characters c
where c.id = r.character_id and c.admin_character and r.status in ('pending', 'needs_correction');

do $$
declare
	c public.characters;
begin
	for c in
		update public.characters
		set status = 'approved', approved_name = name, approved_sheet = sheet
		where admin_character and approved_at is not null and status in ('pending', 'needs_correction')
		returning *
	loop
		perform public.grant_claims(c);
	end loop;
end;
$$;
