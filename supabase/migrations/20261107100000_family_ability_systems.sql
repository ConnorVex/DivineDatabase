-- Power system start is merged into Family ability: a Family ability is now a card for any power
-- system (Abilities, Jujutsu Kaisen, JoJo…) with the family's own starting stats, stored as
-- details.ability.system. family_perk_details() already keeps the whole ability object.
--
-- Old Power system start perks become Family abilities. Their text stays; the owner builds the
-- card in the family editor and sends it again before members can link it.
--
-- Run once in the SQL Editor after 20261106100000_family_custom_traits.sql.

update public.family_perks
set kind = 'locked_power', details = '{}'::jsonb
where kind = 'system_start';
