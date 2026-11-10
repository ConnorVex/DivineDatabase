-- Admin characters and Oculars.
--
--   * Admin characters no longer ping anyone: no "sent for review" in the staff channel and no
--     "has been approved" in the public one (they're approved the moment they're sent).
--   * publish_admin_character: sending an admin character approves it (new) or puts its edits
--     live (approved), and gives it the claims it asked for, so an admin character can take an
--     Ocular spot too, while one is open.
--   * The Ocular spot starts empty: the 6 spots tracked by hand are cleared. The players who
--     hold one claim it on the Divine Database, or staff give it to their character in
--     Admin Panel → Claims → Oculars.
--
-- Run once in the SQL Editor after 20261201100000_admin_characters_no_limits.sql.

create or replace function public.notify_character_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	who text;
	player_id text;
	name text := public.discord_escape(new.name);
	was_approved boolean := tg_op = 'UPDATE' and old.approved_at is not null;
	evolution_denied boolean := current_setting('portal.evolution_denied', true) = 'on';
	kind_text text;
	role_color int;
	series text;
	evolution text;
begin
	-- Admin characters are approved on send and never reviewed: no pings for them.
	if new.admin_character then
		return null;
	end if;

	select p.discord_id into player_id from public.profiles p where p.id = new.owner_id;
	who := case when player_id is not null then '<@' || player_id || '>' else 'A player' end;

	-- Sent for review → staff channel (mentions shown but never pinged).
	if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
		select u.name into series from public.universes u where u.slug = new.canon_universe;
		kind_text := case
			when new.kind = 'canon' then 'Canon tryout · ' || coalesce(series, 'unknown series')
			else 'OC' || coalesce(' · ' || initcap(replace(nullif(new.sheet ->> 'role', ''), '-', ' ')), '')
		end;
		if was_approved then
			select left(summary, 300) into evolution from public.evolution_requests
			where character_id = new.id and status = 'pending' order by submitted_at desc limit 1;
		end if;
		role_color := case new.sheet ->> 'role'
			when 'hero' then 16106818 when 'vigilante' then 10181093 when 'villain' then 15087942
			when 'jujutsu-sorcerer' then 3835647 when 'curse-user' then 12592851 when 'student' then 4122280
			when 'civilian' then 9418936 else 2154656 end;
		perform public.discord_post('discord_staff_webhook', jsonb_build_object(
			'content', case
				when was_approved then '🧬 Evolution sent for review'
				when tg_op = 'UPDATE' and old.status = 'needs_correction' then '🔁 Resubmitted after correction'
				else '📝 New character sent for review'
			end,
			'embeds', jsonb_build_array(jsonb_build_object(
				'title', left(new.name, 250),
				'url', public.portal_site_url() || '/portal/admin/review/',
				'description', 'by ' || who || E'\n' || kind_text || coalesce(E'\n\n' || evolution, ''),
				'color', role_color
			)),
			'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
		));
	end if;

	-- A review decision → public channel, pinging only the player.
	if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', case
				when evolution_denied then who || ', the evolution of your character **' || name || '** has been DENIED.'
				when new.status = 'approved' and was_approved then who || ', the evolution of your character **' || name || '** has been approved!'
				when new.status = 'approved' then who || ', your character **' || name || '** has been approved!'
				when new.status = 'needs_correction' and was_approved then who || ', the evolution of your character **' || name || '** needs a few changes. Check your dashboard for the admin''s notes: https://database.singularityeco.us/characters/'
				when new.status = 'needs_correction' then who || ', your character **' || name || '** needs a few changes. Check your dashboard for the admin''s notes: https://database.singularityeco.us/characters/'
				else who || ', your character **' || name || '** has been DENIED. You must create a new character.'
			end,
			'allowed_mentions', case when player_id is not null
				then jsonb_build_object('users', jsonb_build_array(player_id))
				else jsonb_build_object('parse', '[]'::jsonb) end
		));
	end if;

	return null;
end;
$$;

create or replace function public.publish_admin_character(p_character uuid)
returns public.characters
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	k public.claimables;
begin
	perform public.require_admin();
	select * into c from public.characters where id = p_character for update;
	if c.id is null or not c.admin_character then
		raise exception 'That isn''t an admin character.' using errcode = 'P0001';
	end if;

	-- An Ocular (or any limited claim) only while a spot is open.
	for k in
		select * from public.claimables
		where id = any (c.requested_claims) and claim_type = 'ocular' and max_users is not null
			and not exists (select 1 from public.claims h where h.claimable_id = claimables.id and h.character_id = c.id)
	loop
		if k.manual_users + (select count(*) from public.claims h where h.claimable_id = k.id and h.counts_toward_limit) >= k.max_users then
			raise exception 'Every Ocular spot is taken. Remove the Ocular, or free a spot in Claims first.' using errcode = 'P0001';
		end if;
	end loop;

	if c.approved_at is null then
		return public.review_character(c.id, 'approved', 'Admin character.');
	end if;
	update public.characters set approved_name = name, approved_sheet = sheet where id = c.id
	returning * into c;
	perform public.grant_claims(c);
	return c;
end;
$$;

revoke execute on function public.publish_admin_character(uuid) from public, anon;
grant execute on function public.publish_admin_character(uuid) to authenticated;

update public.claimables set manual_users = 0, updated_at = now() where claim_type = 'ocular';
