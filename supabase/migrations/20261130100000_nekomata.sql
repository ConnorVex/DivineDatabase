-- Nekomata (Tamaki Kotatsu's Ignition) on the claim board. Not a Pillar, so it sits in the regular
-- Canon Ignitions section. Two spots: one for the canon character, one for an OC. Tamaki Kotatsu is
-- already claimed, so one spot starts taken. Its theme and holder come from canon-ignitions.json.
-- Safe to run more than once.
--
-- Run once in the SQL Editor after 20261129100000_canon_conduits.sql.

insert into public.claimables (universe, claim_type, category, name, max_users, manual_users, note, sort_order)
values ('fire-force', 'ability', 'Ignition', 'Nekomata', 2, 1, '', 13)
on conflict (universe, claim_type, lower(name)) do update
	set category = excluded.category, max_users = excluded.max_users, manual_users = excluded.manual_users;
