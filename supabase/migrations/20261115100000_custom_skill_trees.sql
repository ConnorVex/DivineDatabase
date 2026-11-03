-- Custom skill trees: a player's own tree on a system card (sheet.systems[].customTree), approved
-- with the character. Its skills unlock like the wiki trees (tree id 'custom'), costing the card's
-- points (e.g. AUP) or the tree's custom currency, kept in the card's CUSTOM wallet. A custom
-- currency is earned per training session (the bot's training_review) and/or converted from the
-- card's points (convert_custom_points), at the rates staff approved.
--
-- Run once in the SQL Editor after 20261114100000_skill_trees.sql, then the bot's
-- 20261115110000_bot_custom_tree_points.sql.

-- The wallet for every custom currency. Its system matches no card, so it never shows as a system currency.
insert into public.point_currencies (code, system, label, earn, field, show_if, sort)
values ('CUSTOM', '*custom', 'Custom tree currency', 0, null, null, 999)
on conflict (code) do nothing;


-- ───────────────────────────── Tree data ─────────────────────────────

/** A card's approved custom tree, or null. */
create or replace function public.custom_tree(p_character uuid, p_card text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select case when jsonb_typeof(e -> 'customTree') = 'object' then e -> 'customTree' end
	from public.characters c, jsonb_array_elements(case when jsonb_typeof(c.approved_sheet -> 'systems') = 'array' then c.approved_sheet -> 'systems' else '[]' end) e
	where c.id = p_character and e ->> 'key' = p_card
	limit 1;
$$;

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
		select n ->> 'id', left(coalesce(n ->> 'label', ''), 100),
			case when coalesce((n ->> 'start')::boolean, false) or coalesce((n ->> 'cost')::numeric, 0) <= 0 then null
				else least(10000, floor((n ->> 'cost')::numeric))::int end,
			case when coalesce((n ->> 'start')::boolean, false) or coalesce((n ->> 'cost')::numeric, 0) <= 0 then null else currency end,
			coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(n -> 'requires') = 'array' then n -> 'requires' else '[]' end)), '{}'),
			coalesce((n ->> 'start')::boolean, false)
		from jsonb_array_elements(case when jsonb_typeof(tree -> 'nodes') = 'array' then tree -> 'nodes' else '[]' end) n
		where coalesce(n ->> 'id', '') <> '';
end;
$$;

/** Node ids a card owns in a tree: starting points, bought nodes, and free nodes whose requirements are owned. */
create or replace function public.skill_owned(p_character uuid, p_card text, p_tree text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	owned text[];
	more text[];
begin
	select coalesce(array_agg(n.id), '{}') into owned
	from public.tree_nodes(p_character, p_card, p_tree) n
	where n.start or exists (select 1 from public.character_unlocks u
		where u.character_id = p_character and u.card_key = p_card and u.tree_id = p_tree and u.node_id = n.id);
	loop
		select coalesce(array_agg(n.id), '{}') into more
		from public.tree_nodes(p_character, p_card, p_tree) n
		where not n.start and n.cost_amount is null and not (n.id = any (owned)) and n.requires <@ owned;
		exit when cardinality(more) = 0;
		owned := owned || more;
	end loop;
	return owned;
end;
$$;


-- ───────────────────────────── Unlocking ─────────────────────────────

create or replace function public.unlock_skill(p_character uuid, p_card text, p_tree text, p_node text, p_free boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	admin boolean := public.is_admin();
	card jsonb;
	tree public.skill_trees;
	tree_label text;
	node record;
	owned text[];
	free boolean;
begin
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not (ch.owner_id = auth.uid() or admin) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if p_free and not admin then
		raise exception 'Only admins can unlock for free.' using errcode = '42501';
	end if;
	if ch.approved_at is null or ch.status = 'denied' then
		raise exception 'Only approved characters can unlock skills.' using errcode = 'P0001';
	end if;
	select e into card from jsonb_array_elements(ch.approved_sheet -> 'systems') e where e ->> 'key' = p_card;
	if card is null then
		raise exception 'That system card isn''t on the approved sheet.' using errcode = 'P0001';
	end if;
	if p_tree = 'custom' then
		if jsonb_typeof(card -> 'customTree') is distinct from 'object' then
			raise exception 'That card has no approved custom tree.' using errcode = 'P0001';
		end if;
		tree_label := coalesce(nullif(btrim(card -> 'customTree' ->> 'name'), ''), 'custom');
	else
		select * into tree from public.skill_trees where id = p_tree;
		if tree.id is null or card ->> 'system' is distinct from tree.system or not public.points_applies(tree.show_if, card -> 'fields') then
			raise exception 'That system card doesn''t use this skill tree.' using errcode = 'P0001';
		end if;
		tree_label := tree.label;
	end if;

	select * into node from public.tree_nodes(p_character, p_card, p_tree) n where n.id = p_node;
	if node.id is null then
		raise exception 'That skill isn''t on the tree.' using errcode = 'P0001';
	end if;
	owned := public.skill_owned(p_character, p_card, p_tree);
	if node.id = any (owned) then
		raise exception '% is already unlocked.', node.label using errcode = 'P0001';
	end if;
	if not node.requires <@ owned then
		raise exception 'Unlock what % needs first.', node.label using errcode = 'P0001';
	end if;

	free := p_free or node.cost_amount is null;
	if not free then
		if not exists (select 1 from public.point_currencies where code = node.cost_currency) then
			raise exception '% costs %, which isn''t tracked yet. Ask staff to unlock it.', node.label, node.cost_currency using errcode = 'P0001';
		end if;
		perform public.points_add(p_character, p_card, node.cost_currency, -node.cost_amount, 'unlock',
			format('%s (%s)', node.label, tree_label), auth.uid()::text);
	end if;

	insert into public.character_unlocks (character_id, card_key, tree_id, node_id, cost_amount, cost_currency, actor)
	values (p_character, p_card, p_tree, p_node, case when free then 0 else node.cost_amount end,
		case when free then null else node.cost_currency end, auth.uid()::text);

	perform public.skill_log(p_character,
		format('Unlocked %s on the %s skill tree%s.', node.label, tree_label, case when p_free then ' (given by staff)' else '' end),
		case when free then '' else format('%s %s', node.cost_amount,
			case when node.cost_currency = 'CUSTOM' then coalesce(nullif(card -> 'customTree' -> 'custom' ->> 'code', ''), 'points') else node.cost_currency end) end);
	perform public.points_touch(p_character);
end;
$$;

create or replace function public.remove_skill_unlock(p_character uuid, p_card text, p_tree text, p_node text, p_refund boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	u public.character_unlocks;
	label text;
	owned text[];
begin
	if not public.is_admin() then
		raise exception 'Only admins can take back unlocks.' using errcode = '42501';
	end if;
	select * into u from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = p_tree and node_id = p_node for update;
	if u.node_id is null then
		raise exception 'That skill isn''t unlocked.' using errcode = 'P0001';
	end if;
	select n.label into label from public.tree_nodes(p_character, p_card, p_tree) n where n.id = p_node;
	delete from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = p_tree and node_id = p_node;
	-- Nothing still unlocked may depend on it.
	owned := public.skill_owned(p_character, p_card, p_tree);
	if exists (select 1 from public.character_unlocks cu join public.tree_nodes(p_character, p_card, p_tree) n on n.id = cu.node_id
		where cu.character_id = p_character and cu.card_key = p_card and cu.tree_id = p_tree and not n.requires <@ owned) then
		raise exception 'Take back the skills that need % first.', coalesce(label, p_node) using errcode = 'P0001';
	end if;
	if p_refund and u.cost_amount > 0 and u.cost_currency is not null then
		perform public.points_add(p_character, p_card, u.cost_currency, u.cost_amount, 'refund', coalesce(label, p_node), auth.uid()::text);
	end if;
	perform public.skill_log(p_character, format('Staff removed %s from the skill tree%s.', coalesce(label, p_node),
		case when p_refund and u.cost_amount > 0 then ' (refunded)' else '' end),
		case when p_refund and u.cost_amount > 0 then format('+%s %s back', u.cost_amount, u.cost_currency) else '' end);
	perform public.points_touch(p_character);
end;
$$;


-- ───────────────────────────── Custom currency ─────────────────────────────

/** Convert the card's points into its custom currency at the approved rate (p_times × the rate). */
create or replace function public.convert_custom_points(p_character uuid, p_card text, p_times int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	tree jsonb;
	from_code text;
	from_amount int;
	to_amount int;
	code text;
begin
	select * into ch from public.characters where id = p_character for update;
	if ch.id is null or not (ch.owner_id = auth.uid() or public.is_admin()) then
		raise exception 'That isn''t your character.' using errcode = '42501';
	end if;
	if ch.approved_at is null or ch.status = 'denied' then
		raise exception 'Only approved characters can convert points.' using errcode = 'P0001';
	end if;
	if coalesce(p_times, 0) not between 1 and 1000 then
		raise exception 'Convert from 1 to 1000 times at once.' using errcode = 'P0001';
	end if;
	tree := public.custom_tree(p_character, p_card);
	from_code := tree -> 'custom' ->> 'convertFrom';
	if tree is null or tree ->> 'currency' is distinct from 'CUSTOM' or coalesce(from_code, '') = ''
		or not exists (select 1 from public.point_currencies where point_currencies.code = from_code and system <> '*custom') then
		raise exception 'This card''s custom currency has no approved conversion.' using errcode = 'P0001';
	end if;
	from_amount := greatest(1, floor(coalesce((tree -> 'custom' ->> 'convertFromAmount')::numeric, 1)))::int;
	to_amount := greatest(1, floor(coalesce((tree -> 'custom' ->> 'convertToAmount')::numeric, 1)))::int;
	code := coalesce(nullif(tree -> 'custom' ->> 'code', ''), 'points');

	perform public.points_add(p_character, p_card, from_code, -from_amount * p_times, 'convert', format('→ %s %s', to_amount * p_times, code), auth.uid()::text);
	perform public.points_add(p_character, p_card, 'CUSTOM', to_amount * p_times, 'convert', format('%s %s →', from_amount * p_times, from_code), auth.uid()::text);
	perform public.points_touch(p_character);
end;
$$;

revoke execute on function public.custom_tree(uuid, text) from public, anon, authenticated;
revoke execute on function public.tree_nodes(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.skill_owned(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.convert_custom_points(uuid, text, int) from public, anon;
grant execute on function public.convert_custom_points(uuid, text, int) to authenticated;
