-- Admin characters have no limits: rolls never overwrite their Potential or Cursed Energy.
--
-- apply_rolls (run on every save) writes the player's Potential and CE rolls onto the sheet.
-- An admin character keeps whatever the admin set instead, custom CE levels included. The rest
-- of the "no limits" lives in the form; the rules check already skips admin characters.
--
-- Run once in the SQL Editor after 20261130150000_sealed_families.sql.

create or replace function public.apply_rolls(sheet jsonb, char_id uuid, blank_missing boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	pot jsonb;
	ce jsonb;
	fam_pot text;
	fam_ce jsonb;
	systems jsonb;
begin
	-- Admin characters are set by hand: their Potential and Cursed Energy are whatever the admin typed.
	if exists (select 1 from public.characters where id = char_id and admin_character) then
		return sheet;
	end if;

	select result into pot from public.player_rolls
	where character_id = char_id and kind = 'potential' and status <> 'void'
	order by created_at desc limit 1;
	select result into ce from public.player_rolls
	where character_id = char_id and kind = 'cursed_energy' and status <> 'void'
	order by created_at desc limit 1;

	if jsonb_typeof(sheet) <> 'object' then sheet := '{}'::jsonb; end if;

	if jsonb_typeof(sheet -> 'inheritance') = 'object' then
		fam_pot := public.inherited_potential(sheet, char_id);
		fam_ce := public.inherited_ce(sheet, char_id);
	end if;

	if fam_pot is not null then
		sheet := jsonb_set(
			sheet, '{potential}',
			coalesce(case when jsonb_typeof(sheet -> 'potential') = 'object' then sheet -> 'potential' end, '{}'::jsonb)
				|| jsonb_build_object('grade', fam_pot, 'roll', null)
		);
	elsif pot is not null or blank_missing then
		sheet := jsonb_set(
			sheet, '{potential}',
			coalesce(case when jsonb_typeof(sheet -> 'potential') = 'object' then sheet -> 'potential' end, '{}'::jsonb)
				|| jsonb_build_object('grade', coalesce(pot ->> 'grade', ''), 'roll', pot -> 'roll')
		);
	end if;

	if jsonb_typeof(sheet -> 'systems') = 'array' and (ce is not null or fam_ce is not null or blank_missing) then
		select coalesce(jsonb_agg(
			case when e ->> 'system' = 'jujutsu-kaisen' then
				e || jsonb_build_object('fields',
					coalesce(case when jsonb_typeof(e -> 'fields') = 'object' then e -> 'fields' end, '{}'::jsonb)
						|| case when fam_ce is not null
							then jsonb_build_object('ceClass', fam_ce ->> 'class', 'ceAmount', null, 'ceLevel', fam_ce ->> 'detail')
							else jsonb_build_object('ceClass', coalesce(ce ->> 'class', ''), 'ceAmount', ce -> 'cep', 'ceLevel', ce -> 'level') end)
			else e end
			order by ord), '[]'::jsonb)
		into systems
		from jsonb_array_elements(sheet -> 'systems') with ordinality as x (e, ord);
		sheet := jsonb_set(sheet, '{systems}', systems);
	end if;

	return sheet;
end;
$$;

revoke execute on function public.apply_rolls(jsonb, uuid, boolean) from public, anon, authenticated;
