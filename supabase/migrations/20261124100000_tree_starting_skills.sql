-- Starting skills on custom skill trees. A new character starts with the skills its system grants
-- (e.g. 3 Standard and 2 Ultimate for a Quirk). Their tree nodes are marked "known" and are owned
-- once the character is approved; any other skill from the tree sits on the sheet as "locked" until
-- it's unlocked with points (unlock_skill, which already logs it in the evolution log).
--
--   * tree_nodes: a known node counts as owned from the start, with nothing to pay.
--   * Unlocking a custom tree node clears that skill's "locked" flag on both sheets; taking the
--     unlock back sets it again.
--
-- Run once in the SQL Editor after 20261123100000_maintenance_mode.sql.

/** A tree's nodes: the wiki's for built-in trees, the approved custom tree's for 'custom'. A cost of 0 is free. */
create or replace function public.tree_nodes(p_character uuid, p_card text, p_tree text)
returns table (id text, label text, cost_amount int, cost_currency text, requires text[], start boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	tree jsonb;
	currency text;
begin
	if p_tree <> 'custom' then
		return query select n.id, n.label, n.cost_amount, n.cost_currency, n.requires, n.start
			from public.skill_tree_nodes n where n.tree_id = p_tree;
		return;
	end if;
	tree := public.custom_tree(p_character, p_card);
	if tree is null then return; end if;
	currency := coalesce(nullif(tree ->> 'currency', ''), 'CUSTOM');
	return query
		with nodes as (
			select n,
				coalesce((n ->> 'start')::boolean, false) or coalesce((n ->> 'known')::boolean, false) as owned_from_start
			from jsonb_array_elements(case when jsonb_typeof(tree -> 'nodes') = 'array' then tree -> 'nodes' else '[]' end) n
			where coalesce(n ->> 'id', '') <> ''
		)
		select n ->> 'id', left(coalesce(n ->> 'label', ''), 100),
			case when owned_from_start or coalesce((n ->> 'cost')::numeric, 0) <= 0 then null
				else least(10000, floor((n ->> 'cost')::numeric))::int end,
			case when owned_from_start or coalesce((n ->> 'cost')::numeric, 0) <= 0 then null else currency end,
			coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(n -> 'requires') = 'array' then n -> 'requires' else '[]' end)), '{}'),
			owned_from_start
		from nodes;
end;
$$;

/** The sheet with the card's skill from that tree node marked locked or not. */
create or replace function public.set_tree_skill_locked(p_sheet jsonb, p_card text, p_node text, p_locked boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select case when jsonb_typeof(p_sheet -> 'systems') is distinct from 'array' then p_sheet
	else jsonb_set(p_sheet, '{systems}', (
		select coalesce(jsonb_agg(
			case when e ->> 'key' = p_card and jsonb_typeof(e -> 'skills') = 'array' then
				jsonb_set(e, '{skills}', (
					select coalesce(jsonb_agg(
						case when s ->> 'treeNodeId' = p_node then s || jsonb_build_object('locked', p_locked) else s end
						order by i), '[]'::jsonb)
					from jsonb_array_elements(e -> 'skills') with ordinality x(s, i)))
			else e end
			order by j), '[]'::jsonb)
		from jsonb_array_elements(p_sheet -> 'systems') with ordinality y(e, j)))
	end;
$$;

create or replace function public.sync_tree_skill_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	u public.character_unlocks := case when tg_op = 'DELETE' then old else new end;
	locked boolean := tg_op = 'DELETE';
begin
	if u.tree_id <> 'custom' then
		return null;
	end if;
	-- Trusted like skill_log, so guard_character keeps the change.
	perform set_config('portal.family_review', 'on', true);
	update public.characters set
		sheet = public.set_tree_skill_locked(sheet, u.card_key, u.node_id, locked),
		approved_sheet = case when approved_sheet is null then null
			else public.set_tree_skill_locked(approved_sheet, u.card_key, u.node_id, locked) end
	where id = u.character_id;
	perform set_config('portal.family_review', '', true);
	return null;
end;
$$;

drop trigger if exists character_unlocks_skill_lock on public.character_unlocks;
create trigger character_unlocks_skill_lock
	after insert or delete on public.character_unlocks
	for each row execute function public.sync_tree_skill_lock();

revoke execute on function public.set_tree_skill_locked(jsonb, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.sync_tree_skill_lock() from public, anon, authenticated;
