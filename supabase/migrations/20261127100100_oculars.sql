-- Ocular Jujutsu Organs: the spots, and pictures of each Ocular. Safe to run more than once.
--
-- Run once in the SQL Editor after 20261127100000_ocular_claim_type.sql (in its own run).

-- The Ocular spots, counted like any claim: 7 in all, 6 held before the Divine Database (Index:
-- Current Active Oculars). A character asks for a spot on its JJK card's Oculars tab and takes it
-- when approved. Staff can change the spots or holders in the Admin Panel.
insert into public.claimables (universe, claim_type, category, name, max_users, manual_users, note, sort_order)
values (
	'jujutsu-kaisen', 'ocular', 'Ocular', 'Ocular Jujutsu Organ', 7, 6,
	'Active: Six Eyes, Colorless, Silent Night, Cold Abyss, Clarity, Scarlet Roulette', 0
)
on conflict (universe, claim_type, lower(name)) do nothing;

-- Pictures of each Ocular's eye. Anyone can view them; a signed-in player uploads into a folder
-- named after their own account, and can replace or remove only their own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ocular-images', 'ocular-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "ocular images: anyone views" on storage.objects;
create policy "ocular images: anyone views" on storage.objects
	for select using (bucket_id = 'ocular-images');

drop policy if exists "ocular images: players upload their own" on storage.objects;
create policy "ocular images: players upload their own" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'ocular-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ocular images: players change their own" on storage.objects;
create policy "ocular images: players change their own" on storage.objects
	for update to authenticated
	using (bucket_id = 'ocular-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ocular images: players remove their own" on storage.objects;
create policy "ocular images: players remove their own" on storage.objects
	for delete to authenticated
	using (bucket_id = 'ocular-images' and (storage.foldername(name))[1] = auth.uid()::text);
