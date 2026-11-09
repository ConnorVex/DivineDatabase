-- Canon Conduit powers for the claim board. None are claimed yet (characters still have to be
-- submitted), so the ones from before the Divine Database are opened up too. Their class and element
-- are on the card (src/data/portal/canon-conduits.json). Safe to run more than once.
--
-- Run once in the SQL Editor.

-- The canon Conduits from before the Divine Database: no holders yet.
update public.claimables set manual_users = 0
where universe = 'infamous' and claim_type = 'ability';

insert into public.claimables (universe, claim_type, category, name, max_users, manual_users, note, sort_order)
select 'infamous', 'ability', category, name, 1, 0, '', ord
from (values
	('Regular Conduits', 'Electrokinesis', 200),
	('Regular Conduits', 'Neon', 201),
	('Regular Conduits', 'Smoke', 202),
	('Regular Conduits', 'Paper', 203),
	('Regular Conduits', 'Ice', 204),
	('Regular Conduits', 'Napalm', 205),
	('Family Conduits', 'Video', 206),
	('Family Conduits', 'Concrete', 207),
	('Psychic Conduits', 'Telekinesis', 208),
	('Psychic Conduits', 'Black Tar', 209),
	('Meta Conduits', 'Power Mimicry', 210),
	('Bio-Enhanced Conduits', 'Corrupted Transformation', 211),
	('Energy Conduits', 'Ray Field', 212)
) as v(category, name, ord)
on conflict (universe, claim_type, lower(name)) do nothing;
