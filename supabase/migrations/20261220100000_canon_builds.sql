-- Canon power builds: admins design a canon ability's skills (any series on the claim board),
-- plus the extra skills each Quirk Variant adds (Plus, Maximum, Infinite).
--
--   * canon_builds: one row per ability claim. `skills` are the base skills; `variants` is
--     { "Plus": { "about": "", "skills": [...] }, ... }. Everyone can read them (they're canon).
--   * A card holding the claim shows the build's skills live, plus each variant it has reached.
--     They aren't copied onto the sheet and don't count toward the player's own skill limits.
--   * Only admins save or delete a build (save_canon_build, delete_canon_build).
--
-- Run once in the SQL Editor after 20261219100000_override_claims_fix.sql.

create table if not exists public.canon_builds (
	claimable_id uuid primary key references public.claimables (id) on delete cascade,
	about text not null default '' check (char_length(about) <= 8000),
	skills jsonb not null default '[]' check (jsonb_typeof(skills) = 'array'),
	variants jsonb not null default '{}' check (jsonb_typeof(variants) = 'object'),
	updated_by uuid references public.profiles (id) on delete set null,
	updated_at timestamptz not null default now()
);

alter table public.canon_builds enable row level security;
drop policy if exists "anyone reads canon builds" on public.canon_builds;
create policy "anyone reads canon builds" on public.canon_builds for select to anon, authenticated using (true);
revoke all on public.canon_builds from anon, authenticated;
grant select on public.canon_builds to anon, authenticated;

create or replace function public.save_canon_build(p_claim uuid, p_about text, p_skills jsonb, p_variants jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	perform public.require_admin();
	if not exists (select 1 from public.claimables where id = p_claim and claim_type = 'ability') then
		raise exception 'That canon ability doesn''t exist.' using errcode = 'P0002';
	end if;
	if coalesce(jsonb_typeof(p_skills), '') <> 'array' or coalesce(jsonb_typeof(p_variants), '') <> 'object' then
		raise exception 'The build needs its skills.' using errcode = '22023';
	end if;
	if octet_length(p_skills::text) + octet_length(p_variants::text) > 400000 then
		raise exception 'That build is too big.' using errcode = '22023';
	end if;
	insert into public.canon_builds (claimable_id, about, skills, variants, updated_by, updated_at)
	values (p_claim, left(coalesce(p_about, ''), 8000), p_skills, p_variants, auth.uid(), now())
	on conflict (claimable_id) do update
	set about = excluded.about, skills = excluded.skills, variants = excluded.variants,
		updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.delete_canon_build(p_claim uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	perform public.require_admin();
	delete from public.canon_builds where claimable_id = p_claim;
end;
$$;

revoke execute on function public.save_canon_build(uuid, text, jsonb, jsonb) from public, anon;
revoke execute on function public.delete_canon_build(uuid) from public, anon;
grant execute on function public.save_canon_build(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.delete_canon_build(uuid) to authenticated;
