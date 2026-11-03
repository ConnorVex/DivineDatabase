-- Skipping review is now a choice for admins: submit_perk_request() takes p_skip_review
-- (default true). An admin who unticks “Approve straight away” sends perks for review like an
-- owner. Owners can't skip review, whatever they send.
--
-- Run once in the SQL Editor after 20261109100000_family_stats_perks.sql.

drop function if exists public.submit_perk_request(uuid, text, jsonb);

create function public.submit_perk_request(p_family uuid, p_note text, p_perks jsonb, p_skip_review boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	req uuid;
	e jsonb;
	lines text := '';
	n int;
	admin boolean := public.is_admin();
	-- Admins can approve their own perks as they save them, or send them for review like an owner.
	skip boolean := admin and coalesce(p_skip_review, true);
	state text := case when skip then 'approved' else 'pending' end;
begin
	if not (admin or public.is_family_owner(p_family)) then
		raise exception 'Only the family''s owner can send perks.' using errcode = '42501';
	end if;
	select * into fam from public.families where id = p_family;
	if fam.id is null then
		raise exception 'Family not found.';
	end if;
	n := coalesce(jsonb_array_length(p_perks), 0);
	if n = 0 then
		raise exception 'Add at least one perk.';
	elsif n > 25 then
		raise exception 'Send at most 25 perks at a time.';
	end if;

	insert into public.family_perk_requests (family_id, sent_by, note, decided_at)
	values (p_family, auth.uid(), left(btrim(coalesce(p_note, '')), 2000), case when skip then now() end)
	returning id into req;

	for e in select * from jsonb_array_elements(p_perks) loop
		if coalesce(e->>'id', '') <> '' then
			update public.family_perks set
				kind = e->>'kind',
				access = coalesce(e->>'access', 'automatic'),
				title = btrim(e->>'title'),
				description = coalesce(e->>'description', ''),
				hidden = coalesce((e->>'hidden')::boolean, false),
				details = public.family_perk_details(e->>'kind', coalesce(e->'details', '{}'::jsonb)),
				status = state,
				review_note = case when skip then '' else review_note end,
				request_id = req
			where id = (e->>'id')::uuid and family_id = p_family;
			if not found then
				raise exception 'One of these perks isn''t part of this family.';
			end if;
		else
			insert into public.family_perks (family_id, kind, access, title, description, hidden, details, status, request_id)
			values (p_family, e->>'kind', coalesce(e->>'access', 'automatic'), btrim(e->>'title'),
				coalesce(e->>'description', ''), coalesce((e->>'hidden')::boolean, false),
				public.family_perk_details(e->>'kind', coalesce(e->'details', '{}'::jsonb)), state, req);
		end if;
		lines := lines || '• **' || public.discord_escape(btrim(e->>'title')) || '** · ' || replace(e->>'kind', '_', ' ')
			|| case when coalesce((e->>'hidden')::boolean, false) then ' · 🔒 members only' else '' end || E'\n';
	end loop;

	-- Older requests whose perks were all moved into this one are finished.
	update public.family_perk_requests r set decided_at = now()
	where r.family_id = p_family and r.id <> req and r.decided_at is null
		and not exists (select 1 from public.family_perks p where p.request_id = r.id and p.status = 'pending');

	-- Nothing for the staff to review when an admin approved them.
	if skip then
		return req;
	end if;

	perform public.discord_post('discord_staff_webhook', jsonb_build_object(
		'content', '✨ ' || n || case when n = 1 then ' family perk' else ' family perks' end || ' sent for review',
		'embeds', jsonb_build_array(jsonb_build_object(
			'title', left(fam.name, 250),
			'url', public.portal_site_url() || '/families/admin/',
			'description', left(lines || case when btrim(coalesce(p_note, '')) <> '' then E'\n' || public.discord_escape(btrim(p_note)) else '' end, 4000)
		)),
		'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
	));
	return req;
end;
$$;

revoke execute on function public.submit_perk_request(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.submit_perk_request(uuid, text, jsonb, boolean) to authenticated;
