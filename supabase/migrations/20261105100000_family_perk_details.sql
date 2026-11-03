-- Built family perks: a Family ability is made with the same Abilities card players use, and a
-- Family trait names a real trait, so members can link them on their character sheet.
--
--   * family_perks.details holds what was built:
--       Family ability (kind locked_power): { "ability": { "fields": {…Abilities fields…}, "skills": [ … ] } }
--       Family trait   (kind trait):        { "trait": "<trait name>" }
--     Other kinds keep using only the title and description, and their details stay {}.
--   * submit_perk_request() saves details; family_perk_board shows them (blanked when locked).
--
-- Run once in the SQL Editor after the earlier family files.

alter table public.family_perks
	add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.family_perks drop constraint if exists family_perks_details_check;
alter table public.family_perks
	add constraint family_perks_details_check check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 32000);

-- Only the two built kinds keep details.
create or replace function public.family_perk_details(p_kind text, p_details jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select case
		when jsonb_typeof(p_details) <> 'object' then '{}'::jsonb
		when p_kind = 'locked_power' and jsonb_typeof(p_details->'ability') = 'object'
			then jsonb_build_object('ability', p_details->'ability')
		when p_kind = 'trait' and jsonb_typeof(p_details->'trait') = 'string' and char_length(p_details->>'trait') between 1 and 100
			then jsonb_build_object('trait', p_details->'trait')
		else '{}'::jsonb
	end;
$$;


-- ───────────────────────────── Public view ─────────────────────────────

-- Same as before, plus details at the end.
create or replace view public.family_perk_board
with (security_invoker = false) as
select p.id, p.family_id, p.hidden, p.created_at,
	(not p.hidden or v.ok) as unlocked,
	case when not p.hidden or v.ok then p.kind end as kind,
	case when not p.hidden or v.ok then p.access end as access,
	case when not p.hidden or v.ok then p.title else '' end as title,
	case when not p.hidden or v.ok then p.description else '' end as description,
	case when not p.hidden or v.ok then p.details else '{}'::jsonb end as details
from public.family_perks p
join public.families f on f.id = p.family_id
cross join lateral (
	select (public.is_family_member(f.id) or f.owner_id = auth.uid() or public.is_admin()) as ok
) v
where p.status = 'approved'
	and f.status = 'approved';

revoke all on public.family_perk_board from anon, authenticated;
grant select on public.family_perk_board to anon, authenticated;


-- ───────────────────────────── Sending ─────────────────────────────

-- p_perks: [{ id?, kind, access, title, description, hidden, details? }]. With an id it changes that perk.
create or replace function public.submit_perk_request(p_family uuid, p_note text, p_perks jsonb)
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
begin
	if not (public.is_admin() or public.is_family_owner(p_family)) then
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

	insert into public.family_perk_requests (family_id, sent_by, note)
	values (p_family, auth.uid(), left(btrim(coalesce(p_note, '')), 2000))
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
				status = 'pending',
				request_id = req
			where id = (e->>'id')::uuid and family_id = p_family;
			if not found then
				raise exception 'One of these perks isn''t part of this family.';
			end if;
		else
			insert into public.family_perks (family_id, kind, access, title, description, hidden, details, status, request_id)
			values (p_family, e->>'kind', coalesce(e->>'access', 'automatic'), btrim(e->>'title'),
				coalesce(e->>'description', ''), coalesce((e->>'hidden')::boolean, false),
				public.family_perk_details(e->>'kind', coalesce(e->'details', '{}'::jsonb)), 'pending', req);
		end if;
		lines := lines || '• **' || public.discord_escape(btrim(e->>'title')) || '** · ' || replace(e->>'kind', '_', ' ')
			|| case when coalesce((e->>'hidden')::boolean, false) then ' · 🔒 members only' else '' end || E'\n';
	end loop;

	-- Older requests whose perks were all moved into this one are finished.
	update public.family_perk_requests r set decided_at = now()
	where r.family_id = p_family and r.id <> req and r.decided_at is null
		and not exists (select 1 from public.family_perks p where p.request_id = r.id and p.status = 'pending');

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
