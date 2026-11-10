-- Family perks, reworked so a family can be as custom as it likes:
--
--   * Sections: perks sit in sections the family names and orders (like Trello lists).
--     families.perk_sections holds the section names in order; family_perks.section and .sort place
--     each perk. Moving or reordering perks doesn't send them back for review.
--   * Rules: perks can carry rules the site understands, kept in family_perks.details:
--       Trait rules  (kind trait_slots):    { "traitRules": { extraSlots, regularSlots, anyTrait, countsForCombos, potentials[] } }
--       System rules (kind system_start):   { "systemRules": { system, required, unless, fixed{}, options[], extraPoints, pointsLabel, moveLimit } }
--       Fighting style (kind fighting_style): { "style": { styleClass, passive, activation } }
--       Tracker (kind technique):           { "tracker": { meter{ label, max, gain }, levels[], holders[] } }
--       Items (kind item):                  { "items": [ { name, note } ] }
--     plus the kinds that already had details (Family ability, Family trait, Starting stats).
--
-- Run once in the SQL Editor after 20261130100000_nekomata.sql.

alter table public.families
	add column if not exists perk_sections jsonb not null default '[]'::jsonb;
alter table public.families drop constraint if exists families_perk_sections_check;
alter table public.families
	add constraint families_perk_sections_check check (jsonb_typeof(perk_sections) = 'array' and jsonb_array_length(perk_sections) <= 30);

alter table public.family_perks
	add column if not exists section text not null default '',
	add column if not exists sort int not null default 0;
alter table public.family_perks drop constraint if exists family_perks_section_check;
alter table public.family_perks
	add constraint family_perks_section_check check (char_length(section) <= 60);


-- ───────────────────────────── Details ─────────────────────────────

-- What a perk's details may hold, by kind. Anything else is dropped.
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
		when p_kind = 'starting_stats' and jsonb_typeof(p_details->'stats') = 'object'
			then jsonb_build_object('stats', jsonb_build_object(
				'strength', left(coalesce(p_details->'stats'->>'strength', ''), 60),
				'speed', left(coalesce(p_details->'stats'->>'speed', ''), 60),
				'defense', left(coalesce(p_details->'stats'->>'defense', ''), 60),
				'stamina', left(coalesce(p_details->'stats'->>'stamina', ''), 60),
				'intelligence', left(coalesce(p_details->'stats'->>'intelligence', ''), 60),
				'extraPtp', case when jsonb_typeof(p_details->'stats'->'extraPtp') = 'number'
					then greatest(0, least(1000, (p_details->'stats'->>'extraPtp')::numeric::int)) else 0 end))
		when p_kind = 'trait' and jsonb_typeof(p_details->'trait') = 'string' and char_length(btrim(p_details->>'trait')) between 1 and 100
			then jsonb_build_object('trait', btrim(p_details->>'trait'))
				|| case
					when jsonb_typeof(p_details->'customTrait') = 'object'
						and p_details->'customTrait'->>'category' in ('physical', 'skill', 'phenomena')
						and p_details->'customTrait'->>'effect' in ('buff', 'debuff', 'neutral')
					then jsonb_build_object('customTrait', jsonb_build_object(
						'category', p_details->'customTrait'->>'category',
						'effect', p_details->'customTrait'->>'effect')
						-- How the trait changes the Physical Points from a member's training log.
						|| case when jsonb_typeof(p_details->'customTrait'->'training') = 'object'
							then jsonb_build_object('training', jsonb_build_object(
								'percent', case when jsonb_typeof(p_details->'customTrait'->'training'->'percent') = 'number'
									then greatest(-100, least(500, (p_details->'customTrait'->'training'->>'percent')::numeric::int)) else 0 end,
								'flat', case when jsonb_typeof(p_details->'customTrait'->'training'->'flat') = 'number'
									then greatest(-100, least(100, (p_details->'customTrait'->'training'->>'flat')::numeric::int)) else 0 end))
							else '{}'::jsonb end)
					else '{}'::jsonb
				end
		when p_kind = 'trait_slots' and jsonb_typeof(p_details->'traitRules') = 'object'
			then jsonb_build_object('traitRules', p_details->'traitRules')
		when p_kind = 'system_start' and jsonb_typeof(p_details->'systemRules') = 'object'
			then jsonb_build_object('systemRules', p_details->'systemRules')
		when p_kind = 'fighting_style' and jsonb_typeof(p_details->'style') = 'object'
			then jsonb_build_object('style', p_details->'style')
		when p_kind = 'technique' and jsonb_typeof(p_details->'tracker') = 'object'
			then jsonb_build_object('tracker', p_details->'tracker')
		when p_kind = 'item' and jsonb_typeof(p_details->'items') = 'array'
			then jsonb_build_object('items', p_details->'items')
		else '{}'::jsonb
	end;
$$;


-- ───────────────────────────── Guard ─────────────────────────────

-- As before, plus: an owner moving a perk to another section or place keeps its status.
create or replace function public.guard_family_perk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if public.is_admin() then
		if tg_op = 'UPDATE' and new.status is distinct from old.status then
			new.reviewed_at := now();
			new.reviewed_by := auth.uid();
		end if;
		return new;
	end if;
	if tg_op = 'UPDATE'
		and (new.kind, new.access, new.title, new.description, new.hidden, new.details, new.status)
			is not distinct from (old.kind, old.access, old.title, old.description, old.hidden, old.details, old.status) then
		-- Only the section or place changed.
		new.family_id := old.family_id;
		new.created_at := old.created_at;
		new.review_note := old.review_note;
		new.reviewed_at := old.reviewed_at;
		new.reviewed_by := old.reviewed_by;
		return new;
	end if;
	new.status := 'pending';
	new.review_note := case when tg_op = 'UPDATE' then old.review_note else '' end;
	new.reviewed_at := case when tg_op = 'UPDATE' then old.reviewed_at else null end;
	new.reviewed_by := case when tg_op = 'UPDATE' then old.reviewed_by else null end;
	if tg_op = 'UPDATE' then
		new.family_id := old.family_id;
		new.created_at := old.created_at;
	end if;
	return new;
end;
$$;


-- ───────────────────────────── Arranging ─────────────────────────────

-- The family's sections in order, and where each perk sits. Doesn't touch anything under review.
-- p_order: [{ id, section, sort }]
create or replace function public.arrange_family_perks(p_family uuid, p_sections jsonb, p_order jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	e jsonb;
begin
	if not (public.is_admin() or public.is_family_owner(p_family)) then
		raise exception 'Only the family''s owner can arrange its perks.' using errcode = '42501';
	end if;
	if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 30 then
		raise exception 'A family can have at most 30 perk sections.';
	end if;
	update public.families
	set perk_sections = (
		select coalesce(jsonb_agg(to_jsonb(left(btrim(s), 60))), '[]'::jsonb)
		from jsonb_array_elements_text(p_sections) s
		where btrim(s) <> ''
	)
	where id = p_family;

	for e in select * from jsonb_array_elements(coalesce(p_order, '[]'::jsonb)) loop
		update public.family_perks
		set section = left(btrim(coalesce(e->>'section', '')), 60),
			sort = coalesce((e->>'sort')::int, 0)
		where id = (e->>'id')::uuid and family_id = p_family;
	end loop;
end;
$$;

revoke execute on function public.arrange_family_perks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.arrange_family_perks(uuid, jsonb, jsonb) to authenticated;


-- ───────────────────────────── Sending ─────────────────────────────

-- As before, plus each perk's section and place.
create or replace function public.submit_perk_request(p_family uuid, p_note text, p_perks jsonb, p_skip_review boolean default true)
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
	elsif n > 40 then
		raise exception 'Send at most 40 perks at a time.';
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
				section = left(btrim(coalesce(e->>'section', section)), 60),
				sort = coalesce((e->>'sort')::int, sort),
				status = state,
				review_note = case when skip then '' else review_note end,
				request_id = req
			where id = (e->>'id')::uuid and family_id = p_family;
			if not found then
				raise exception 'One of these perks isn''t part of this family.';
			end if;
		else
			insert into public.family_perks (family_id, kind, access, title, description, hidden, details, section, sort, status, request_id)
			values (p_family, e->>'kind', coalesce(e->>'access', 'automatic'), btrim(e->>'title'),
				coalesce(e->>'description', ''), coalesce((e->>'hidden')::boolean, false),
				public.family_perk_details(e->>'kind', coalesce(e->'details', '{}'::jsonb)),
				left(btrim(coalesce(e->>'section', '')), 60), coalesce((e->>'sort')::int, 0), state, req);
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


-- ───────────────────────────── Public view ─────────────────────────────

-- Same as before, plus each perk's section and place (shown even on a locked card).
create or replace view public.family_perk_board
with (security_invoker = false) as
select p.id, p.family_id, p.hidden, p.created_at,
	(not p.hidden or v.ok) as unlocked,
	case when not p.hidden or v.ok then p.kind end as kind,
	case when not p.hidden or v.ok then p.access end as access,
	case when not p.hidden or v.ok then p.title else '' end as title,
	case when not p.hidden or v.ok then p.description else '' end as description,
	case when not p.hidden or v.ok then p.details else '{}'::jsonb end as details,
	p.section,
	p.sort
from public.family_perks p
join public.families f on f.id = p.family_id
cross join lateral (
	select (public.is_family_member(f.id) or f.owner_id = auth.uid() or public.is_admin()) as ok
) v
where p.status = 'approved'
	and f.status = 'approved';

revoke all on public.family_perk_board from anon, authenticated;
grant select on public.family_perk_board to anon, authenticated;
