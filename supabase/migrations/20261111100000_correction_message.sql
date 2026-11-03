-- A character (or evolution) sent back for changes now points the player to their dashboard,
-- where the admin's notes are, instead of asking them to open a ticket. The rest of
-- notify_character_status() is unchanged from 20261030120000_portal_evolutions.sql.
--
-- Run once in the SQL Editor after 20261110100000_admin_perk_review_choice.sql.

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
