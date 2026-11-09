-- Oculars get their own kind of claim, so the Ocular spots never mix with canon Cursed Techniques
-- in the claim picker. (A new enum value has to be committed before it's used, so the spots
-- themselves are added in the next file.) Safe to run more than once.
--
-- Run once in the SQL Editor after 20261126100000_more_canon_quirks.sql, then run
-- 20261127100100_oculars.sql on its own.

alter type public.claim_type add value if not exists 'ocular';
