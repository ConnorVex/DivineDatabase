-- More canon Quirks for the claim board (all open: no holders yet). Their class and Quirk Factor are
-- fixed on the card (src/data/portal/canon-quirks.json). Staff can change a category or slot count in
-- the Admin Panel. Safe to run more than once.
--
-- Run once in the SQL Editor after 20261125100000_evolution_rolls.sql.

insert into public.claimables (universe, claim_type, category, name, max_users, manual_users, note, sort_order)
select universe, 'ability', category, name, max_users, 0, '', ord
from (values
	('my-hero-academia', 'Standard', 'Creation', 3, 31),
	('my-hero-academia', 'Standard', 'Hardening', 3, 32),
	('my-hero-academia', 'Standard', 'Engine', 3, 33),
	('my-hero-academia', 'Standard', 'Zero Gravity', 3, 34),
	('my-hero-academia', 'Standard', 'Frog', 3, 35),
	('my-hero-academia', 'Standard', 'Dark Shadow', 3, 36),
	('my-hero-academia', 'Standard', 'Invisibility', 3, 37),
	('my-hero-academia', 'Standard', 'Acid', 3, 38),
	('my-hero-academia', 'Standard', 'Tape', 3, 39),
	('my-hero-academia', 'Standard', 'Earphone Jack', 3, 40),
	('my-hero-academia', 'Standard', 'Navel Laser', 3, 41),
	('my-hero-academia', 'Standard', 'Pop Off', 3, 42),
	('my-hero-academia', 'Standard', 'Tail', 3, 43),
	('my-hero-academia', 'Standard', 'Anivoice', 3, 44),
	('my-hero-academia', 'Standard', 'Dupli-Arms', 3, 45),
	('my-hero-academia', 'Standard', 'Sugar Rush', 3, 46),
	('my-hero-academia', 'Standard', 'Steel', 3, 47),
	('my-hero-academia', 'Standard', 'Vines', 3, 48),
	('my-hero-academia', 'Standard', 'Big Fist', 3, 49),
	('my-hero-academia', 'Standard', 'Gigantification', 3, 50),
	('my-hero-academia', 'Standard', 'Brainwashing', 3, 51),
	('my-hero-academia', 'Standard', 'Fat Absorption', 3, 52),
	('my-hero-academia', 'Standard', 'Voice', 3, 53),
	('my-hero-academia', 'Standard', 'Lizard', 3, 54),
	('my-hero-academia', 'Standard', 'Magnetism', 3, 55),
	('my-hero-academia', 'Standard', 'Compress', 3, 56),
	('my-hero-academia', 'Standard', 'Muscle Augmentation', 3, 57),
	('my-hero-academia', 'Permission Based', 'Permeation', 2, 58),
	('my-hero-academia', 'Permission Based', 'Fierce Wings', 2, 59),
	('my-hero-academia', 'Permission Based', 'Foresight', 2, 60),
	('my-hero-academia', 'Permission Based', 'Transform', 2, 61),
	('my-hero-academia', 'Permission Based', 'Double', 2, 62),
	('my-hero-academia', 'Permission Based', 'Rewind', 1, 63)
) as v (universe, category, name, max_users, ord)
on conflict (universe, claim_type, lower(name)) do nothing;
