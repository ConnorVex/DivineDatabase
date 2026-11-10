-- A family's status is now just Open or Closed, and tryouts are gone: a family owner reviews
-- every new member's character instead.
--
-- Families that held tryouts become Open. The family_tryouts table and its rows are kept as a
-- record, but nothing can add to it anymore: sending a tryout needs recruiting = 'tryouts',
-- which the check below no longer allows.

update public.families set recruiting = 'open' where recruiting = 'tryouts';

alter table public.families drop constraint if exists families_recruiting_check;
alter table public.families add constraint families_recruiting_check check (recruiting in ('open', 'closed'));
