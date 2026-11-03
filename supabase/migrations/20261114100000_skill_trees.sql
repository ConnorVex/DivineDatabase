-- Built-in skill trees: the wiki's trees for JJK (Cursed Energy, Cursed Technique, Barrier
-- Techniques), JoJo (Hamon, Spin, Vampire) and Fire Force (Second and Third Generation), unlocked
-- per system card with that card's upgrade points.
--
--   * skill_trees / skill_tree_nodes: copied from the wiki's tree data (re-run to update them).
--   * character_unlocks: the nodes each card has bought.
--   * unlock_skill(): the owner (or an admin) buys a node whose requirements are all owned. It costs
--     the node's points straight away and adds a line to the evolution log. Admins can unlock for free
--     (p_free), e.g. for nodes priced in a currency with no wallet yet (VSP).
--   * remove_skill_unlock(): admins take a node back, optionally refunding it.
--
-- A node is owned when it's a starting point, was bought, or is free (no cost) and everything it
-- requires is owned. Run once in the SQL Editor after 20261113100000_character_points.sql.


-- ───────────────────────────── Tables ─────────────────────────────

create table if not exists public.skill_trees (
	id text primary key,
	system text not null,
	label text not null,
	-- Only for cards whose field matches, like point_currencies.show_if.
	show_if jsonb,
	sort int not null default 0
);

create table if not exists public.skill_tree_nodes (
	tree_id text not null references public.skill_trees (id) on delete cascade,
	id text not null,
	label text not null,
	cost_amount int,
	cost_currency text,
	requires text[] not null default '{}',
	start boolean not null default false,
	description text not null default '',
	sort int not null default 0,
	primary key (tree_id, id)
);

create table if not exists public.character_unlocks (
	character_id uuid not null references public.characters (id) on delete cascade,
	card_key text not null,
	tree_id text not null,
	node_id text not null,
	cost_amount int not null default 0,
	cost_currency text,
	actor text,
	created_at timestamptz not null default now(),
	primary key (character_id, card_key, tree_id, node_id)
);

alter table public.point_ledger drop constraint if exists point_ledger_source_check;
alter table public.point_ledger add constraint point_ledger_source_check
	check (source in ('training', 'convert', 'staff', 'sheet', 'unlock', 'refund'));

alter table public.skill_trees enable row level security;
alter table public.skill_tree_nodes enable row level security;
alter table public.character_unlocks enable row level security;

drop policy if exists "Anyone reads trees" on public.skill_trees;
create policy "Anyone reads trees" on public.skill_trees for select using (true);
drop policy if exists "Anyone reads tree nodes" on public.skill_tree_nodes;
create policy "Anyone reads tree nodes" on public.skill_tree_nodes for select using (true);
drop policy if exists "Owners and admins read unlocks" on public.character_unlocks;
create policy "Owners and admins read unlocks" on public.character_unlocks for select using (
	public.is_admin() or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())
);

revoke all on public.skill_trees, public.skill_tree_nodes, public.character_unlocks from anon, authenticated;
grant select on public.skill_trees, public.skill_tree_nodes to anon, authenticated;
grant select on public.character_unlocks to authenticated;
grant all on public.skill_trees, public.skill_tree_nodes, public.character_unlocks to service_role;


-- ───────────────────────────── Helpers ─────────────────────────────

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
	from public.skill_tree_nodes n
	where n.tree_id = p_tree and (n.start or exists (select 1 from public.character_unlocks u
		where u.character_id = p_character and u.card_key = p_card and u.tree_id = p_tree and u.node_id = n.id));
	loop
		select coalesce(array_agg(n.id), '{}') into more
		from public.skill_tree_nodes n
		where n.tree_id = p_tree and not n.start and n.cost_amount is null
			and not (n.id = any (owned)) and n.requires <@ owned;
		exit when cardinality(more) = 0;
		owned := owned || more;
	end loop;
	return owned;
end;
$$;

/** Adds a line to the character's evolution log on both sheets. */
create or replace function public.skill_log(p_character uuid, p_summary text, p_earned text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	entry jsonb := jsonb_build_object('date', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
		'summary', p_summary, 'earned', p_earned, 'link', '');
begin
	-- Trusted like a family owner's review, so guard_character keeps the new log line.
	perform set_config('portal.family_review', 'on', true);
	update public.characters set
		sheet = jsonb_set(sheet, '{evolutions}', coalesce(case when jsonb_typeof(sheet -> 'evolutions') = 'array' then sheet -> 'evolutions' end, '[]'::jsonb) || entry),
		approved_sheet = case when approved_sheet is null then null else jsonb_set(approved_sheet, '{evolutions}',
			coalesce(case when jsonb_typeof(approved_sheet -> 'evolutions') = 'array' then approved_sheet -> 'evolutions' end, '[]'::jsonb) || entry) end
	where id = p_character;
	perform set_config('portal.family_review', '', true);
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
	node public.skill_tree_nodes;
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
	select * into tree from public.skill_trees where id = p_tree;
	select e into card from jsonb_array_elements(ch.approved_sheet -> 'systems') e where e ->> 'key' = p_card;
	if tree.id is null or card is null or card ->> 'system' is distinct from tree.system
		or not public.points_applies(tree.show_if, card -> 'fields') then
		raise exception 'That system card doesn''t use this skill tree.' using errcode = 'P0001';
	end if;
	select * into node from public.skill_tree_nodes where tree_id = p_tree and id = p_node;
	if node.id is null then
		raise exception 'That skill isn''t on the tree.' using errcode = 'P0001';
	end if;
	if node.id = any (public.skill_owned(p_character, p_card, p_tree)) then
		raise exception '% is already unlocked.', node.label using errcode = 'P0001';
	end if;
	if not node.requires <@ public.skill_owned(p_character, p_card, p_tree) then
		raise exception 'Unlock what % needs first.', node.label using errcode = 'P0001';
	end if;

	free := p_free or node.cost_amount is null;
	if not free then
		if not exists (select 1 from public.point_currencies where code = node.cost_currency) then
			raise exception '% costs %, which isn''t tracked yet. Ask staff to unlock it.', node.label, node.cost_currency using errcode = 'P0001';
		end if;
		perform public.points_add(p_character, p_card, node.cost_currency, -node.cost_amount, 'unlock',
			format('%s (%s)', node.label, tree.label), auth.uid()::text);
	end if;

	insert into public.character_unlocks (character_id, card_key, tree_id, node_id, cost_amount, cost_currency, actor)
	values (p_character, p_card, p_tree, p_node, case when free then 0 else node.cost_amount end,
		case when free then null else node.cost_currency end, auth.uid()::text);

	perform public.skill_log(p_character,
		format('Unlocked %s on the %s skill tree%s.', node.label, tree.label, case when p_free then ' (given by staff)' else '' end),
		case when free then '' else format('%s %s', node.cost_amount, node.cost_currency) end);
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
begin
	if not public.is_admin() then
		raise exception 'Only admins can take back unlocks.' using errcode = '42501';
	end if;
	select * into u from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = p_tree and node_id = p_node for update;
	if u.node_id is null then
		raise exception 'That skill isn''t unlocked.' using errcode = 'P0001';
	end if;
	select n.label into label from public.skill_tree_nodes n where n.tree_id = p_tree and n.id = p_node;
	delete from public.character_unlocks
	where character_id = p_character and card_key = p_card and tree_id = p_tree and node_id = p_node;
	-- Nothing still unlocked may depend on it.
	if exists (select 1 from public.character_unlocks cu join public.skill_tree_nodes n on n.tree_id = cu.tree_id and n.id = cu.node_id
		where cu.character_id = p_character and cu.card_key = p_card and cu.tree_id = p_tree
			and not n.requires <@ public.skill_owned(p_character, p_card, p_tree)) then
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

revoke execute on function public.skill_owned(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.skill_log(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.unlock_skill(uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.remove_skill_unlock(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.unlock_skill(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.remove_skill_unlock(uuid, text, text, text, boolean) to authenticated;


-- ───────────────────────────── Trees from the wiki ─────────────────────────────

insert into public.skill_trees (id, system, label, show_if, sort) values
	('jjk-cursed-energy', 'jujutsu-kaisen', 'Cursed Energy', null, 30),
	('jjk-cursed-technique', 'jujutsu-kaisen', 'Cursed Technique', '{"key": "start", "in": ["Cursed Technique", ""]}'::jsonb, 31),
	('jjk-barrier', 'jujutsu-kaisen', 'Barrier Techniques', null, 32),
	('jojo-hamon', 'jojo', 'Hamon', '{"key": "path", "in": ["Hamon"]}'::jsonb, 40),
	('jojo-spin', 'jojo', 'Spin', '{"key": "path", "in": ["Spin"]}'::jsonb, 41),
	('jojo-vampire', 'jojo', 'Vampire', '{"key": "path", "in": ["Vampire"]}'::jsonb, 42),
	('fireforce-second-gen', 'fire-force', 'Second Generation', '{"key": "generation", "in": ["Second"]}'::jsonb, 50),
	('fireforce-third-gen', 'fire-force', 'Third Generation', '{"key": "generation", "in": ["Third"]}'::jsonb, 51)
on conflict (id) do update set system = excluded.system, label = excluded.label, show_if = excluded.show_if, sort = excluded.sort;

insert into public.skill_tree_nodes (tree_id, id, label, cost_amount, cost_currency, requires, start, description, sort) values
	('jjk-cursed-energy', 'cursed-energy', 'Cursed Energy', null, null, '{}', true, '', 0),
	('jjk-cursed-energy', 'cursed-energy-control', 'Cursed Energy Control', null, null, '{"cursed-energy"}', true, '', 1),
	('jjk-cursed-energy', 'level-0', 'Level 0', null, null, '{"cursed-energy-control"}', true, '', 2),
	('jjk-cursed-energy', 'level-1', 'Level 1', 2, 'CEUP', '{"level-0"}', false, '', 3),
	('jjk-cursed-energy', 'level-2', 'Level 2', 4, 'CEUP', '{"level-1"}', false, '', 4),
	('jjk-cursed-energy', 'level-3', 'Level 3', 6, 'CEUP', '{"level-2"}', false, '', 5),
	('jjk-cursed-energy', 'level-4', 'Level 4', 8, 'CEUP', '{"level-3"}', false, '', 6),
	('jjk-cursed-energy', 'level-5', 'Level 5', 10, 'CEUP', '{"level-4"}', false, '', 7),
	('jjk-cursed-energy', 'cursed-energy-output', 'Cursed Energy Output', null, null, '{"cursed-energy"}', true, '', 8),
	('jjk-cursed-energy', 'no-ce-output', 'No CE Output', null, null, '{"cursed-energy-output"}', true, '', 9),
	('jjk-cursed-energy', 'extremely-poor-ce-output', 'Extremely Poor CE Output', 1, 'CEUP', '{"no-ce-output"}', false, '', 10),
	('jjk-cursed-energy', 'poor-ce-output', 'Poor CE Output', 1, 'CEUP', '{"extremely-poor-ce-output"}', false, '', 11),
	('jjk-cursed-energy', 'miniscule-ce-output', 'Miniscule CE Output', 2, 'CEUP', '{"poor-ce-output"}', false, '', 12),
	('jjk-cursed-energy', 'small-ce-output', 'Small CE Output', 2, 'CEUP', '{"miniscule-ce-output"}', false, '', 13),
	('jjk-cursed-energy', 'average-ce-output', 'Average CE Output', 3, 'CEUP', '{"small-ce-output"}', false, '', 14),
	('jjk-cursed-energy', 'above-average-ce-output', 'Above Average CE Output', 3, 'CEUP', '{"average-ce-output"}', false, '', 15),
	('jjk-cursed-energy', 'good-ce-output', 'Good CE Output', 4, 'CEUP', '{"above-average-ce-output"}', false, '', 16),
	('jjk-cursed-energy', 'high-ce-output', 'High CE Output', 4, 'CEUP', '{"good-ce-output"}', false, '', 17),
	('jjk-cursed-energy', 'amazing-ce-output', 'Amazing CE Output', 5, 'CEUP', '{"high-ce-output"}', false, '', 18),
	('jjk-cursed-energy', 'extremely-high-ce-output', 'Extremely High CE Output', 5, 'CEUP', '{"amazing-ce-output"}', false, '', 19),
	('jjk-cursed-energy', 'intense-ce-output', 'Intense CE Output', 6, 'CEUP', '{"extremely-high-ce-output"}', false, '', 20),
	('jjk-cursed-energy', 'immense-ce-output', 'Immense CE Output', 6, 'CEUP', '{"intense-ce-output"}', false, '', 21),
	('jjk-cursed-energy', 'maximum-ce-output', 'Maximum CE Output', 10, 'CEUP', '{"immense-ce-output"}', false, '', 22),
	('jjk-cursed-energy', 'black-flash', 'Black Flash', 35, 'CEUP', '{"cursed-energy"}', false, '', 23),
	('jjk-cursed-energy', 'reverse-cursed-energy', 'Reverse Cursed Energy', 1000, 'CEUP', '{"cursed-energy"}', false, '', 24),
	('jjk-cursed-energy', 'reverse-cursed-technique', 'Reverse Cursed Technique', 20, 'CEUP', '{"reverse-cursed-energy"}', false, '', 25),
	('jjk-cursed-energy', 'self-rct', 'Self RCT', null, null, '{"reverse-cursed-technique"}', false, '', 26),
	('jjk-cursed-energy', 'rct-on-others', 'RCT On Others', 50, 'CEUP', '{"self-rct"}', false, 'RCE Prof Trait Req.', 27),
	('jjk-cursed-energy', 'technique-restoration', 'Technique Restoration', 50, 'CEUP', '{"self-rct"}', false, '', 28),
	('jjk-cursed-energy', 'cursed-energy-recharge', 'Cursed Energy Recharge', null, null, '{"cursed-energy"}', true, '', 29),
	('jjk-cursed-energy', 'rp-to-rp-recharge', 'RP To RP Recharge', null, null, '{"cursed-energy-recharge"}', true, '', 30),
	('jjk-cursed-energy', 'level-0-2', 'Level 0', null, null, '{"rp-to-rp-recharge"}', true, '', 31),
	('jjk-cursed-energy', 'level-1-2', 'Level 1', 3, 'CEUP', '{"level-0-2"}', false, '', 32),
	('jjk-cursed-energy', 'level-2-2', 'Level 2', 3, 'CEUP', '{"level-1-2"}', false, '', 33),
	('jjk-cursed-energy', 'level-3-2', 'Level 3', 6, 'CEUP', '{"level-2-2"}', false, '', 34),
	('jjk-cursed-energy', 'level-4-2', 'Level 4', 6, 'CEUP', '{"level-3-2"}', false, '', 35),
	('jjk-cursed-energy', 'complete-recharge', 'Complete Recharge', null, null, '{"cursed-energy-recharge"}', true, '', 36),
	('jjk-cursed-energy', 'level-0-3', 'Level 0', null, null, '{"complete-recharge"}', true, '', 37),
	('jjk-cursed-energy', 'level-1-3', 'Level 1', 3, 'CEUP', '{"level-0-3"}', false, '', 38),
	('jjk-cursed-energy', 'level-2-3', 'Level 2', 3, 'CEUP', '{"level-1-3"}', false, '', 39),
	('jjk-cursed-energy', 'level-3-3', 'Level 3', 6, 'CEUP', '{"level-2-3"}', false, '', 40),
	('jjk-cursed-energy', 'level-4-3', 'Level 4', 6, 'CEUP', '{"level-3-3"}', false, '', 41),
	('jjk-cursed-energy', 'level-x', 'Level X', 9, 'CEUP', '{"level-4-3"}', false, '', 42),
	('jjk-cursed-energy', 'ce-enhancement-skill', 'CE Enhancement Skill', 20, 'CEUP', '{"level-3","high-ce-output"}', false, '', 43),
	('jjk-cursed-technique', 'cursed-technique', 'Cursed Technique', null, null, '{}', true, '', 0),
	('jjk-cursed-technique', 'cursed-technique-range', 'Cursed Technique Range', null, null, '{"cursed-technique"}', true, '', 1),
	('jjk-cursed-technique', 'physical-range', 'Physical Range', null, null, '{"cursed-technique-range"}', true, '', 2),
	('jjk-cursed-technique', 'close-range', 'Close Range', 4, 'CTUP', '{"physical-range"}', false, '', 3),
	('jjk-cursed-technique', 'medium-range', 'Medium Range', 8, 'CTUP', '{"close-range"}', false, '', 4),
	('jjk-cursed-technique', 'long-range', 'Long Range', 12, 'CTUP', '{"medium-range"}', false, '', 5),
	('jjk-cursed-technique', 'cursed-technique-power', 'Cursed Technique Power', null, null, '{"cursed-technique"}', true, '', 6),
	('jjk-cursed-technique', 'below-grade-4', 'Below Grade 4', null, null, '{"cursed-technique-power"}', true, '', 7),
	('jjk-cursed-technique', 'grade-4', 'Grade 4', 3, 'CTUP', '{"below-grade-4"}', false, '', 8),
	('jjk-cursed-technique', 'semi-grade-3', 'Semi-Grade 3', 3, 'CTUP', '{"grade-4"}', false, '', 9),
	('jjk-cursed-technique', 'grade-3', 'Grade 3', 6, 'CTUP', '{"semi-grade-3"}', false, '', 10),
	('jjk-cursed-technique', 'semi-grade-2', 'Semi-Grade 2', 6, 'CTUP', '{"grade-3"}', false, '', 11),
	('jjk-cursed-technique', 'grade-2', 'Grade 2', 9, 'CTUP', '{"semi-grade-2"}', false, '', 12),
	('jjk-cursed-technique', 'semi-grade-1', 'Semi-Grade 1', 9, 'CTUP', '{"grade-2"}', false, '', 13),
	('jjk-cursed-technique', 'grade-1', 'Grade 1', 12, 'CTUP', '{"semi-grade-1"}', false, '', 14),
	('jjk-cursed-technique', 'maximum-technique', 'Maximum Technique', 20, 'CTUP', '{"cursed-technique-power"}', false, '', 15),
	('jjk-cursed-technique', 'cursed-technique-efficiency', 'Cursed Technique Efficiency', null, null, '{"cursed-technique"}', true, '', 16),
	('jjk-cursed-technique', 'extremely-poor-efficiency', 'Extremely Poor Efficiency', null, null, '{"cursed-technique-efficiency"}', true, '', 17),
	('jjk-cursed-technique', 'very-poor-efficiency', 'Very Poor Efficiency', 2, 'CTUP', '{"extremely-poor-efficiency"}', false, '', 18),
	('jjk-cursed-technique', 'poor-efficiency', 'Poor Efficiency', 2, 'CTUP', '{"very-poor-efficiency"}', false, '', 19),
	('jjk-cursed-technique', 'subpar-efficiency', 'Subpar Efficiency', 4, 'CTUP', '{"poor-efficiency"}', false, '', 20),
	('jjk-cursed-technique', 'tolerable-efficiency', 'Tolerable Efficiency', 4, 'CTUP', '{"subpar-efficiency"}', false, '', 21),
	('jjk-cursed-technique', 'average-efficiency', 'Average Efficiency', 6, 'CTUP', '{"tolerable-efficiency"}', false, '', 22),
	('jjk-cursed-technique', 'decent-efficiency', 'Decent Efficiency', 6, 'CTUP', '{"average-efficiency"}', false, '', 23),
	('jjk-cursed-technique', 'adequate-efficiency', 'Adequate Efficiency', 8, 'CTUP', '{"decent-efficiency"}', false, '', 24),
	('jjk-cursed-technique', 'great-efficiency', 'Great Efficiency', 8, 'CTUP', '{"adequate-efficiency"}', false, '', 25),
	('jjk-cursed-technique', 'amazing-efficiency', 'Amazing Efficiency', 10, 'CTUP', '{"great-efficiency"}', false, '', 26),
	('jjk-cursed-technique', 'insane-efficiency', 'Insane Efficiency', 10, 'CTUP', '{"amazing-efficiency"}', false, '', 27),
	('jjk-cursed-technique', 'remarkable-efficiency', 'Remarkable Efficiency', 20, 'CTUP', '{"insane-efficiency"}', false, '', 28),
	('jjk-barrier', 'barrier-techniques', 'Barrier Techniques', null, null, '{}', true, '', 0),
	('jjk-barrier', 'domain-expansion', 'Domain Expansion', null, null, '{"barrier-techniques"}', true, '', 1),
	('jjk-barrier', 'incomplete-domain-expansion', 'Incomplete Domain Expansion', 6, 'BTUP', '{"domain-expansion"}', false, '', 2),
	('jjk-barrier', 'domain-grade', 'Domain Grade', null, null, '{"incomplete-domain-expansion"}', false, '', 3),
	('jjk-barrier', 'grade-4', 'Grade 4', null, null, '{"domain-grade"}', false, '', 4),
	('jjk-barrier', 'semi-grade-3', 'Semi-Grade 3', 1, 'BTUP', '{"grade-4"}', false, '', 5),
	('jjk-barrier', 'grade-3', 'Grade 3', 1, 'BTUP', '{"semi-grade-3"}', false, '', 6),
	('jjk-barrier', 'semi-grade-2', 'Semi-Grade 2', 1, 'BTUP', '{"grade-3"}', false, '', 7),
	('jjk-barrier', 'grade-2', 'Grade 2', 1, 'BTUP', '{"semi-grade-2"}', false, '', 8),
	('jjk-barrier', 'semi-grade-1', 'Semi-Grade 1', 1, 'BTUP', '{"grade-2"}', false, '', 9),
	('jjk-barrier', 'grade-1', 'Grade 1', 1, 'BTUP', '{"semi-grade-1"}', false, '', 10),
	('jjk-barrier', 'complete-domain', 'Complete Domain', null, null, '{"grade-1"}', false, '', 11),
	('jjk-barrier', 'domain-construction-time', 'Domain Construction Time', null, null, '{"complete-domain"}', false, '', 12),
	('jjk-barrier', 'level-0', 'Level 0', null, null, '{"domain-construction-time"}', false, '', 13),
	('jjk-barrier', 'level-1', 'Level 1', 1, 'BTUP', '{"level-0"}', false, '', 14),
	('jjk-barrier', 'level-2', 'Level 2', 1, 'BTUP', '{"level-1"}', false, '', 15),
	('jjk-barrier', 'level-3', 'Level 3', 1, 'BTUP', '{"level-2"}', false, '', 16),
	('jjk-barrier', 'level-4', 'Level 4', 1, 'BTUP', '{"level-3"}', false, '', 17),
	('jjk-barrier', 'level-5', 'Level 5', 2, 'BTUP', '{"level-4"}', false, '', 18),
	('jjk-barrier', 'specialized-barrier-techniques', 'Specialized Barrier Techniques', null, null, '{"complete-domain"}', false, '', 19),
	('jjk-barrier', 'all-or-nothing-domain', 'All or Nothing Domain', 20, 'BTUP', '{"specialized-barrier-techniques"}', false, '', 20),
	('jjk-barrier', 'open-domain', 'Open Domain', 30, 'BTUP', '{"specialized-barrier-techniques"}', false, '', 21),
	('jjk-barrier', 'domain-grade-2', 'Domain Grade', null, null, '{"complete-domain"}', false, '', 22),
	('jjk-barrier', 'grade-4-2', 'Grade 4', null, null, '{"domain-grade-2"}', false, '', 23),
	('jjk-barrier', 'semi-grade-3-2', 'Semi-Grade 3', 2, 'BTUP', '{"grade-4-2"}', false, '', 24),
	('jjk-barrier', 'grade-3-2', 'Grade 3', 2, 'BTUP', '{"semi-grade-3-2"}', false, '', 25),
	('jjk-barrier', 'semi-grade-2-2', 'Semi-Grade 2', 2, 'BTUP', '{"grade-3-2"}', false, '', 26),
	('jjk-barrier', 'grade-2-2', 'Grade 2', 2, 'BTUP', '{"semi-grade-2-2"}', false, '', 27),
	('jjk-barrier', 'semi-grade-1-2', 'Semi-Grade 1', 2, 'BTUP', '{"grade-2-2"}', false, '', 28),
	('jjk-barrier', 'grade-1-2', 'Grade 1', 2, 'BTUP', '{"semi-grade-1-2"}', false, '', 29),
	('jjk-barrier', 'curtain', 'Curtain', 4, 'BTUP', '{"barrier-techniques"}', false, '', 30),
	('jjk-barrier', 'anti-barrier-techniques', 'Anti-Barrier Techniques', null, null, '{"barrier-techniques"}', true, '', 31),
	('jjk-barrier', 'simple-domain', 'Simple Domain', null, null, '{"anti-barrier-techniques"}', true, '', 32),
	('jjk-barrier', 'hollow-wicker-basket', 'Hollow Wicker Basket', null, null, '{"simple-domain"}', true, '', 33),
	('jjk-barrier', 'simple-domain-grade', 'Simple Domain Grade', null, null, '{"hollow-wicker-basket"}', true, '', 34),
	('jjk-barrier', 'grade-4-3', 'Grade 4', null, null, '{"simple-domain-grade"}', true, '', 35),
	('jjk-barrier', 'semi-grade-3-3', 'Semi-Grade 3', 1, 'BTUP', '{"grade-4-3"}', false, '', 36),
	('jjk-barrier', 'grade-3-3', 'Grade 3', 1, 'BTUP', '{"semi-grade-3-3"}', false, '', 37),
	('jjk-barrier', 'semi-grade-2-3', 'Semi-Grade 2', 1, 'BTUP', '{"grade-3-3"}', false, '', 38),
	('jjk-barrier', 'grade-2-3', 'Grade 2', 2, 'BTUP', '{"semi-grade-2-3"}', false, '', 39),
	('jjk-barrier', 'semi-grade-1-3', 'Semi-Grade 1', 2, 'BTUP', '{"grade-2-3"}', false, '', 40),
	('jjk-barrier', 'grade-1-3', 'Grade 1', 2, 'BTUP', '{"semi-grade-1-3"}', false, '', 41),
	('jjk-barrier', 'new-shadow-style', 'New Shadow Style', null, null, '{"simple-domain"}', true, '', 42),
	('jjk-barrier', 'simple-domain-grade-2', 'Simple Domain Grade', null, null, '{"new-shadow-style"}', true, '', 43),
	('jjk-barrier', 'grade-4-4', 'Grade 4', null, null, '{"simple-domain-grade-2"}', true, '', 44),
	('jjk-barrier', 'semi-grade-3-4', 'Semi-Grade 3', 3, 'BTUP', '{"grade-4-4"}', false, '', 45),
	('jjk-barrier', 'grade-3-4', 'Grade 3', 3, 'BTUP', '{"semi-grade-3-4"}', false, '', 46),
	('jjk-barrier', 'semi-grade-2-4', 'Semi-Grade 2', 3, 'BTUP', '{"grade-3-4"}', false, '', 47),
	('jjk-barrier', 'grade-2-4', 'Grade 2', 3, 'BTUP', '{"semi-grade-2-4"}', false, '', 48),
	('jjk-barrier', 'semi-grade-1-4', 'Semi-Grade 1', 3, 'BTUP', '{"grade-2-4"}', false, '', 49),
	('jjk-barrier', 'grade-1-4', 'Grade 1', 3, 'BTUP', '{"semi-grade-1-4"}', false, '', 50),
	('jjk-barrier', 'binding-vows', 'Binding Vows', null, null, '{"new-shadow-style"}', true, '', 51),
	('jjk-barrier', '0-binding-vows', '0 Binding Vows', null, null, '{"binding-vows"}', true, '', 52),
	('jjk-barrier', '1-binding-vow', '+1 Binding Vow', 1, 'BTUP', '{"0-binding-vows"}', false, '', 53),
	('jjk-barrier', '1-binding-vow-2', '+1 Binding Vow', 1, 'BTUP', '{"1-binding-vow"}', false, '', 54),
	('jjk-barrier', '1-binding-vow-3', '+1 Binding Vow', 1, 'BTUP', '{"1-binding-vow-2"}', false, '', 55),
	('jjk-barrier', '1-binding-vow-4', '+1 Binding Vow', 1, 'BTUP', '{"1-binding-vow-3"}', false, '', 56),
	('jjk-barrier', '1-binding-vow-5', '+1 Binding Vow', 1, 'BTUP', '{"1-binding-vow-4"}', false, '', 57),
	('jjk-barrier', 'domain-amplification', 'Domain Amplification', 4, 'BTUP', '{"anti-barrier-techniques"}', false, '', 58),
	('jjk-barrier', 'grade-4-5', 'Grade 4', null, null, '{"domain-amplification"}', false, '', 59),
	('jjk-barrier', 'semi-grade-3-5', 'Semi-Grade 3', 3, 'BTUP', '{"grade-4-5"}', false, '', 60),
	('jjk-barrier', 'grade-3-5', 'Grade 3', 3, 'BTUP', '{"semi-grade-3-5"}', false, '', 61),
	('jjk-barrier', 'semi-grade-2-5', 'Semi-Grade 2', 3, 'BTUP', '{"grade-3-5"}', false, '', 62),
	('jjk-barrier', 'grade-2-5', 'Grade 2', 3, 'BTUP', '{"semi-grade-2-5"}', false, '', 63),
	('jjk-barrier', 'semi-grade-1-5', 'Semi-Grade 1', 3, 'BTUP', '{"grade-2-5"}', false, '', 64),
	('jjk-barrier', 'grade-1-5', 'Grade 1', 3, 'BTUP', '{"semi-grade-1-5"}', false, '', 65),
	('jojo-hamon', 'hamon', 'Hamon', null, null, '{}', true, '', 0),
	('jojo-hamon', 'breathing', 'Breathing', null, null, '{"hamon"}', true, '', 1),
	('jojo-hamon', 'hamon-gain', 'Charge Rate', null, null, '{"breathing"}', true, '', 2),
	('jojo-hamon', 'hg-upgrade-1', 'Charge Rate 1', 10, 'HUP', '{"hamon-gain"}', false, '', 3),
	('jojo-hamon', 'hg-upgrade-2', 'Charge Rate 2', 10, 'HUP', '{"hg-upgrade-1"}', false, '', 4),
	('jojo-hamon', 'hg-upgrade-3', 'Charge Rate 3', 10, 'HUP', '{"hg-upgrade-2"}', false, '', 5),
	('jojo-hamon', 'hg-upgrade-4', 'Charge Rate 4', 10, 'HUP', '{"hg-upgrade-3"}', false, '', 6),
	('jojo-hamon', 'hg-upgrade-5', 'Charge Rate 5', 10, 'HUP', '{"hg-upgrade-4"}', false, '', 7),
	('jojo-hamon', 'hg-upgrade-max', 'Charge Rate Max', 20, 'HUP', '{"hg-upgrade-5"}', false, '', 8),
	('jojo-hamon', 'hamon-capacity', 'Hamon Capacity', null, null, '{"breathing"}', true, '', 9),
	('jojo-hamon', 'hc-upgrade-1', 'Capacity 1', 15, 'HUP', '{"hamon-capacity"}', false, '', 10),
	('jojo-hamon', 'hc-upgrade-2', 'Capacity 2', 15, 'HUP', '{"hc-upgrade-1"}', false, '', 11),
	('jojo-hamon', 'hc-upgrade-3', 'Capacity 3', 25, 'HUP', '{"hc-upgrade-2"}', false, '', 12),
	('jojo-hamon', 'hc-upgrade-4', 'Capacity 4', 25, 'HUP', '{"hc-upgrade-3"}', false, '', 13),
	('jojo-hamon', 'hc-upgrade-5', 'Capacity 5', 35, 'HUP', '{"hc-upgrade-4"}', false, '', 14),
	('jojo-hamon', 'hc-upgrade-6', 'Capacity 6', 35, 'HUP', '{"hc-upgrade-5"}', false, '', 15),
	('jojo-hamon', 'hc-upgrade-7', 'Capacity 7', 45, 'HUP', '{"hc-upgrade-6"}', false, '', 16),
	('jojo-hamon', 'hc-upgrade-max', 'Capacity Max', 75, 'HUP', '{"hc-upgrade-7"}', false, '', 17),
	('jojo-hamon', 'hamon-drain', 'Hamon Drain', null, null, '{"breathing"}', true, '', 18),
	('jojo-hamon', 'hd-upgrade-1', 'Drain 1', 20, 'HUP', '{"hamon-drain"}', false, '', 19),
	('jojo-hamon', 'hd-upgrade-2', 'Drain 2', 20, 'HUP', '{"hd-upgrade-1"}', false, '', 20),
	('jojo-hamon', 'hd-upgrade-3', 'Drain 3', 20, 'HUP', '{"hd-upgrade-2"}', false, '', 21),
	('jojo-hamon', 'hd-upgrade-4', 'Drain 4', 20, 'HUP', '{"hd-upgrade-3"}', false, '', 22),
	('jojo-hamon', 'hd-upgrade-5', 'Drain 5', 20, 'HUP', '{"hd-upgrade-4"}', false, '', 23),
	('jojo-hamon', 'hd-upgrade-6', 'Drain 6', 20, 'HUP', '{"hd-upgrade-5"}', false, '', 24),
	('jojo-hamon', 'hd-upgrade-7', 'Drain 7', 20, 'HUP', '{"hd-upgrade-6"}', false, '', 25),
	('jojo-hamon', 'hd-upgrade-max', 'Drain Max', 35, 'HUP', '{"hd-upgrade-7"}', false, '', 26),
	('jojo-hamon', 'hamon-strike', 'Hamon Strike', null, null, '{"breathing"}', true, '', 27),
	('jojo-hamon', 'ripple-beat', 'Ripple Beat', 5, 'HUP', '{"hamon-strike"}', false, '', 28),
	('jojo-hamon', 'ripple-hair-attack', 'Ripple Hair Attack', 5, 'HUP', '{"ripple-beat"}', false, '', 29),
	('jojo-hamon', 'ripple-cutter', 'Ripple Cutter', 15, 'HUP', '{"ripple-hair-attack"}', false, '', 30),
	('jojo-hamon', 'ripple-detector', 'Ripple Detector', 25, 'HUP', '{"ripple-cutter"}', false, '', 31),
	('jojo-hamon', 'ripple-hypnosis', 'Ripple Hypnosis', 35, 'HUP', '{"ripple-detector"}', false, '', 32),
	('jojo-hamon', 'repel', 'Repel', 10, 'HUP', '{"ripple-beat"}', false, '', 33),
	('jojo-hamon', 'overdrive', 'Overdrive', 20, 'HUP', '{"repel"}', false, '', 34),
	('jojo-hamon', 'rebuff-overdrive', 'Rebuff Overdrive', 10, 'HUP', '{"overdrive"}', false, '', 35),
	('jojo-hamon', 'scarlet-overdrive', 'Scarlet Overdrive', 10, 'HUP', '{"overdrive"}', false, '', 36),
	('jojo-hamon', 'ripple-overdrive', 'Ripple Overdrive', 10, 'HUP', '{"overdrive"}', false, '', 37),
	('jojo-hamon', 'tornado-overdrive', 'Tornado Overdrive', 20, 'HUP', '{"overdrive"}', false, '', 38),
	('jojo-hamon', 'turquoise-blue-overdrive', 'Turquoise Blue Overdrive', 25, 'HUP', '{"overdrive"}', false, '', 39),
	('jojo-hamon', 'metal-silver-overdrive', 'Metal Silver Overdrive', 25, 'HUP', '{"overdrive"}', false, '', 40),
	('jojo-hamon', 'deep-pass-overdrive', 'Deep Pass Overdrive', 1, 'HUP', '{"overdrive"}', false, '', 41),
	('jojo-hamon', 'life-magnetism-overdrive', 'Life Magnetism Overdrive', 25, 'HUP', '{"overdrive"}', false, '', 42),
	('jojo-hamon', 'sendo-wave-kick', 'Sendo Wave Kick', 20, 'HUP', '{"repel"}', false, '', 43),
	('jojo-hamon', 'sendo-ripple-overdrive', 'Sendo Ripple Overdrive', 40, 'HUP', '{"sendo-wave-kick","overdrive"}', false, '', 44),
	('jojo-hamon', 'sunlight-yellow-overdrive', 'Sunlight Yellow Overdrive', 20, 'HUP', '{"scarlet-overdrive"}', false, '', 45),
	('jojo-spin', 'spin', 'Spin', null, null, '{}', true, '', 0),
	('jojo-spin', 'destructive-enhancement', 'Destructive Enhancement', null, null, '{"spin"}', true, '', 1),
	('jojo-spin', 'de-upgrade-1', 'Destructive 1', 15, 'SUP', '{"destructive-enhancement"}', false, '', 2),
	('jojo-spin', 'de-upgrade-2', 'Destructive 2', 25, 'SUP', '{"de-upgrade-1"}', false, '', 3),
	('jojo-spin', 'de-upgrade-3', 'Destructive 3', 35, 'SUP', '{"de-upgrade-2"}', false, '', 4),
	('jojo-spin', 'de-upgrade-max', 'Destructive Max', 45, 'SUP', '{"de-upgrade-3"}', false, '', 5),
	('jojo-spin', 'shielding-enhancement', 'Shielding Enhancement', null, null, '{"spin"}', true, '', 6),
	('jojo-spin', 'se-upgrade-1', 'Shielding 1', 25, 'SUP', '{"shielding-enhancement"}', false, '', 7),
	('jojo-spin', 'se-upgrade-2', 'Shielding 2', 35, 'SUP', '{"se-upgrade-1"}', false, '', 8),
	('jojo-spin', 'se-upgrade-3', 'Shielding 3', 45, 'SUP', '{"se-upgrade-2"}', false, '', 9),
	('jojo-spin', 'su-upgrade-4', 'Shielding 4', 55, 'SUP', '{"se-upgrade-3"}', false, '', 10),
	('jojo-spin', 'su-upgrade-6', 'Shielding 5', 65, 'SUP', '{"su-upgrade-4"}', false, '', 11),
	('jojo-spin', 'su-upgrade-max', 'Shielding Max', 100, 'SUP', '{"su-upgrade-6"}', false, '', 12),
	('jojo-spin', 'spin-gauge', 'Spin Gauge', null, null, '{"spin"}', true, '', 13),
	('jojo-spin', 'sg-upgrade-1', 'Spin Gauge 1', 15, 'SUP', '{"spin-gauge"}', false, '', 14),
	('jojo-spin', 'sg-upgrade-2', 'Spin Gauge 2', 15, 'SUP', '{"sg-upgrade-1"}', false, '', 15),
	('jojo-spin', 'sg-upgrade-3', 'Spin Gauge 3', 15, 'SUP', '{"sg-upgrade-2"}', false, '', 16),
	('jojo-spin', 'sg-upgrade-4', 'Spin Gauge 4', 20, 'SUP', '{"sg-upgrade-3"}', false, '', 17),
	('jojo-spin', 'sg-upgrade-5', 'Spin Gauge 5', 20, 'SUP', '{"sg-upgrade-4"}', false, '', 18),
	('jojo-spin', 'sg-upgrade-6', 'Spin Gauge 6', 20, 'SUP', '{"sg-upgrade-5"}', false, '', 19),
	('jojo-spin', 'sg-upgrade-max', 'Spin Gauge Max', 35, 'SUP', '{"sg-upgrade-6"}', false, '', 20),
	('jojo-vampire', 'vampire', 'Vampire', null, null, '{}', true, '', 0),
	('jojo-vampire', 'blood-gauge', 'Blood Gauge', null, null, '{"vampire"}', true, '', 1),
	('jojo-vampire', 'blood-capacity', 'Blood Capacity', null, null, '{"blood-gauge"}', true, '', 2),
	('jojo-vampire', 'bc-upgrade-1', 'Capacity 1', 5, 'VUP', '{"blood-capacity"}', false, '', 3),
	('jojo-vampire', 'bc-upgrade-2', 'Capacity 2', 5, 'VUP', '{"bc-upgrade-1"}', false, '', 4),
	('jojo-vampire', 'bc-upgrade-3', 'Capacity 3', 5, 'VUP', '{"bc-upgrade-2"}', false, '', 5),
	('jojo-vampire', 'bc-upgrade-4', 'Capacity 4', 5, 'VUP', '{"bc-upgrade-3"}', false, '', 6),
	('jojo-vampire', 'bc-upgrade-5', 'Capacity 5', 10, 'VUP', '{"bc-upgrade-4"}', false, '', 7),
	('jojo-vampire', 'bc-upgrade-6', 'Capacity 6', 10, 'VUP', '{"bc-upgrade-5"}', false, '', 8),
	('jojo-vampire', 'bc-upgrade-7', 'Capacity 7', 10, 'VUP', '{"bc-upgrade-6"}', false, '', 9),
	('jojo-vampire', 'bc-upgrade-8', 'Capacity 8', 10, 'VUP', '{"bc-upgrade-7"}', false, '', 10),
	('jojo-vampire', 'bc-upgrade-9', 'Capacity 9', 15, 'VUP', '{"bc-upgrade-8"}', false, '', 11),
	('jojo-vampire', 'bc-upgrade-10', 'Capacity 10', 15, 'VUP', '{"bc-upgrade-9"}', false, '', 12),
	('jojo-vampire', 'bc-upgrade-max', 'Capacity Max', 20, 'VUP', '{"bc-upgrade-10"}', false, '', 13),
	('jojo-vampire', 'blood-drain', 'Blood Drain', null, null, '{"blood-gauge"}', true, '', 14),
	('jojo-vampire', 'bd-upgrade-1', 'Drain 1', 10, 'VUP', '{"blood-drain"}', false, '', 15),
	('jojo-vampire', 'bd-upgrade-2', 'Drain 2', 10, 'VUP', '{"bd-upgrade-1"}', false, '', 16),
	('jojo-vampire', 'bd-upgrade-3', 'Drain 3', 10, 'VUP', '{"bd-upgrade-2"}', false, '', 17),
	('jojo-vampire', 'bd-upgrade-max', 'Drain Max', 5, 'VUP', '{"bd-upgrade-3"}', false, '', 18),
	('jojo-vampire', 'blood-gain', 'Blood Gain', null, null, '{"blood-gauge"}', true, '', 19),
	('jojo-vampire', 'bg-upgrade-1', 'Gain 1', 10, 'VUP', '{"blood-gain"}', false, '', 20),
	('jojo-vampire', 'bg-upgrade-2', 'Gain 2', 10, 'VUP', '{"bg-upgrade-1"}', false, '', 21),
	('jojo-vampire', 'bg-upgrade-3', 'Gain 3', 10, 'VUP', '{"bg-upgrade-2"}', false, '', 22),
	('jojo-vampire', 'bg-upgrade-4', 'Gain 4', 10, 'VUP', '{"bg-upgrade-3"}', false, '', 23),
	('jojo-vampire', 'bg-upgrade-5', 'Gain 5', 10, 'VUP', '{"bg-upgrade-4"}', false, '', 24),
	('jojo-vampire', 'bg-upgrade-6', 'Gain 6', 20, 'VUP', '{"bg-upgrade-5"}', false, '', 25),
	('jojo-vampire', 'vaporization-freeze', 'Vaporization Freezing', 20, 'VUP', '{"blood-gauge"}', false, '', 26),
	('jojo-vampire', 'freeze-radius', 'Freeze Radius', null, null, '{"vaporization-freeze"}', false, '', 27),
	('jojo-vampire', 'radius-upgrade-1', 'Radius 1', 10, 'VSP', '{"freeze-radius"}', false, '', 28),
	('jojo-vampire', 'radius-upgrade-2', 'Radius 2', 11, 'VSP', '{"radius-upgrade-1"}', false, '', 29),
	('jojo-vampire', 'radius-upgrade-3', 'Radius 3', 12, 'VSP', '{"radius-upgrade-2"}', false, '', 30),
	('jojo-vampire', 'radius-upgrade-4', 'Radius 4', 13, 'VSP', '{"radius-upgrade-3"}', false, '', 31),
	('jojo-vampire', 'radius-upgrade-5', 'Radius 5', 14, 'VSP', '{"radius-upgrade-4"}', false, '', 32),
	('jojo-vampire', 'radius-upgrade-max', 'Radius Max', 20, 'VSP', '{"radius-upgrade-5"}', false, '', 33),
	('jojo-vampire', 'hamon-freeze-threshold', 'Hamon Freeze Threshold', null, null, '{"vaporization-freeze"}', false, '', 34),
	('jojo-vampire', 'threshold-upgrade-1', 'Threshold 1', 40, 'VSP', '{"hamon-freeze-threshold"}', false, '', 35),
	('jojo-vampire', 'threshold-upgrade-2', 'Threshold 2', 50, 'VSP', '{"threshold-upgrade-1"}', false, '', 36),
	('jojo-vampire', 'threshold-upgrade-3', 'Threshold 3', 60, 'VSP', '{"threshold-upgrade-2"}', false, '', 37),
	('jojo-vampire', 'threshold-upgrade-4', 'Threshold 4', 70, 'VSP', '{"threshold-upgrade-3"}', false, '', 38),
	('jojo-vampire', 'threshold-upgrade-5', 'Threshold 5', 80, 'VSP', '{"threshold-upgrade-4"}', false, '', 39),
	('jojo-vampire', 'threshold-upgrade-max', 'Threshold Max', 100, 'VSP', '{"threshold-upgrade-5"}', false, '', 40),
	('jojo-vampire', 'freeze-time', 'Freeze Time', null, null, '{"vaporization-freeze"}', false, '', 41),
	('jojo-vampire', 'ft-upgrade-1', 'Freeze Time 1', 11, 'VSP', '{"freeze-time"}', false, '', 42),
	('jojo-vampire', 'ft-upgrade-2', 'Freeze Time 2', 12, 'VSP', '{"ft-upgrade-1"}', false, '', 43),
	('jojo-vampire', 'ft-upgrade-3', 'Freeze Time 3', 13, 'VSP', '{"ft-upgrade-2"}', false, '', 44),
	('jojo-vampire', 'ft-upgrade-4', 'Freeze Time 4', 14, 'VSP', '{"ft-upgrade-3"}', false, '', 45),
	('jojo-vampire', 'ft-upgrade-5', 'Freeze Time 5', 15, 'VSP', '{"ft-upgrade-4"}', false, '', 46),
	('jojo-vampire', 'ft-upgrade-6', 'Freeze Time 6', 16, 'VSP', '{"ft-upgrade-5"}', false, '', 47),
	('jojo-vampire', 'ft-upgrade-max', 'Freeze Time Max', 20, 'VSP', '{"ft-upgrade-6"}', false, '', 48),
	('jojo-vampire', 'space-ripper-eyes', 'Space Ripper Stingy Eyes', 25, 'VUP', '{"blood-gauge"}', false, '', 49),
	('jojo-vampire', 'range', 'Range', null, null, '{"space-ripper-eyes"}', false, '', 50),
	('jojo-vampire', 'range-upgrade-1', 'Range 1', 10, 'VSP', '{"range"}', false, '', 51),
	('jojo-vampire', 'range-upgrade-2', 'Range 2', 15, 'VSP', '{"range-upgrade-1"}', false, '', 52),
	('jojo-vampire', 'range-upgrade-3', 'Range 3', 20, 'VSP', '{"range-upgrade-2"}', false, '', 53),
	('jojo-vampire', 'range-upgrade-4', 'Range 4', 25, 'VSP', '{"range-upgrade-3"}', false, '', 54),
	('jojo-vampire', 'range-upgrade-5', 'Range 5', 30, 'VSP', '{"range-upgrade-4"}', false, '', 55),
	('jojo-vampire', 'range-upgrade-6', 'Range 6', 35, 'VSP', '{"range-upgrade-5"}', false, '', 56),
	('jojo-vampire', 'range-upgrade-max', 'Range Max', 60, 'VSP', '{"range-upgrade-6"}', false, '', 57),
	('jojo-vampire', 'charge', 'Charge', null, null, '{"space-ripper-eyes"}', false, '', 58),
	('jojo-vampire', 'charge-upgrade-1', 'Charge 1', 20, 'VSP', '{"charge"}', false, '', 59),
	('jojo-vampire', 'charge-upgrade-max', 'Charge Max', 40, 'VSP', '{"charge-upgrade-1"}', false, '', 60),
	('jojo-vampire', 'power', 'Power', null, null, '{"space-ripper-eyes"}', false, '', 61),
	('jojo-vampire', 'power-upgrade-1', 'Power 1', 10, 'VSP', '{"power"}', false, '', 62),
	('jojo-vampire', 'power-upgrade-2', 'Power 2', 20, 'VSP', '{"power-upgrade-1"}', false, '', 63),
	('jojo-vampire', 'power-upgrade-3', 'Power 3', 20, 'VSP', '{"power-upgrade-2"}', false, '', 64),
	('jojo-vampire', 'power-upgrade-4', 'Power 4', 30, 'VSP', '{"power-upgrade-3"}', false, '', 65),
	('jojo-vampire', 'power-upgrade-5', 'Power 5', 30, 'VSP', '{"power-upgrade-4"}', false, '', 66),
	('jojo-vampire', 'power-upgrade-6', 'Power 6', 40, 'VSP', '{"power-upgrade-5"}', false, '', 67),
	('jojo-vampire', 'power-upgrade-max', 'Power Max', 50, 'VSP', '{"power-upgrade-6"}', false, '', 68),
	('jojo-vampire', 'zombie-vamp-creation', 'Zombie Creation', 10, 'VUP', '{"blood-gauge"}', false, '', 69),
	('jojo-vampire', 'fusion', 'Fusion', 40, 'VSP', '{"zombie-vamp-creation"}', false, '', 70),
	('jojo-vampire', 'flesh-bud', 'Flesh Bud', 60, 'VSP', '{"fusion"}', false, '', 71),
	('jojo-vampire', 'hypnosis', 'Hypnosis', 25, 'VUP', '{"zombie-vamp-creation"}', false, '', 72),
	('fireforce-second-gen', 'generation-two', 'Generation Two', null, null, '{}', true, '', 0),
	('fireforce-second-gen', 'pyrokinetic-manipulation', 'Pyrokinetic Manipulation', null, null, '{"generation-two"}', true, '', 1),
	('fireforce-second-gen', 'level-0', 'Level 0', null, null, '{"pyrokinetic-manipulation"}', true, '', 2),
	('fireforce-second-gen', 'level-1', 'Level 1', 4, 'SGUP', '{"level-0"}', false, '', 3),
	('fireforce-second-gen', 'level-2', 'Level 2', 4, 'SGUP', '{"level-1"}', false, '', 4),
	('fireforce-second-gen', 'level-3', 'Level 3', 4, 'SGUP', '{"level-2"}', false, '', 5),
	('fireforce-second-gen', 'level-4', 'Level 4', 4, 'SGUP', '{"level-3"}', false, '', 6),
	('fireforce-second-gen', 'level-5', 'Level 5', 8, 'SGUP', '{"level-4"}', false, '', 7),
	('fireforce-second-gen', 'level-6', 'Level 6', 8, 'SGUP', '{"level-5"}', false, '', 8),
	('fireforce-second-gen', 'level-7', 'Level 7', 8, 'SGUP', '{"level-6"}', false, '', 9),
	('fireforce-second-gen', 'level-8', 'Level 8', 8, 'SGUP', '{"level-7"}', false, '', 10),
	('fireforce-second-gen', 'level-9', 'Level 9', 8, 'SGUP', '{"level-8"}', false, '', 11),
	('fireforce-second-gen', 'level-10', 'Level 10', 12, 'SGUP', '{"level-9"}', false, '', 12),
	('fireforce-second-gen', 'level-11', 'Level 11', 12, 'SGUP', '{"level-10"}', false, '', 13),
	('fireforce-second-gen', 'level-12', 'Level 12', 12, 'SGUP', '{"level-11"}', false, '', 14),
	('fireforce-second-gen', 'level-13', 'Level 13', 12, 'SGUP', '{"level-12"}', false, '', 15),
	('fireforce-second-gen', 'level-14', 'Level 14', 12, 'SGUP', '{"level-13"}', false, '', 16),
	('fireforce-second-gen', 'level-15', 'Level 15', 16, 'SGUP', '{"level-14"}', false, '', 17),
	('fireforce-second-gen', 'level-y', 'Level Y', 20, 'SGUP', '{"level-15"}', false, '', 18),
	('fireforce-third-gen', 'generation-three', 'Generation Three', null, null, '{}', true, '', 0),
	('fireforce-third-gen', 'pyrokinetic-power', 'Pyrokinetic Power', null, null, '{"generation-three"}', true, '', 1),
	('fireforce-third-gen', 'level-0', 'Level 0', null, null, '{"pyrokinetic-power"}', true, '', 2),
	('fireforce-third-gen', 'level-1', 'Level 1', 3, 'TGUP', '{"level-0"}', false, '', 3),
	('fireforce-third-gen', 'level-2', 'Level 2', 3, 'TGUP', '{"level-1"}', false, '', 4),
	('fireforce-third-gen', 'level-3', 'Level 3', 3, 'TGUP', '{"level-2"}', false, '', 5),
	('fireforce-third-gen', 'level-4', 'Level 4', 3, 'TGUP', '{"level-3"}', false, '', 6),
	('fireforce-third-gen', 'level-5', 'Level 5', 6, 'TGUP', '{"level-4"}', false, '', 7),
	('fireforce-third-gen', 'level-6', 'Level 6', 6, 'TGUP', '{"level-5"}', false, '', 8),
	('fireforce-third-gen', 'level-7', 'Level 7', 6, 'TGUP', '{"level-6"}', false, '', 9),
	('fireforce-third-gen', 'level-8', 'Level 8', 6, 'TGUP', '{"level-7"}', false, '', 10),
	('fireforce-third-gen', 'level-9', 'Level 9', 6, 'TGUP', '{"level-8"}', false, '', 11),
	('fireforce-third-gen', 'level-10', 'Level 10', 9, 'TGUP', '{"level-9"}', false, '', 12),
	('fireforce-third-gen', 'level-11', 'Level 11', 9, 'TGUP', '{"level-10"}', false, '', 13),
	('fireforce-third-gen', 'level-12', 'Level 12', 9, 'TGUP', '{"level-11"}', false, '', 14),
	('fireforce-third-gen', 'level-13', 'Level 13', 9, 'TGUP', '{"level-12"}', false, '', 15),
	('fireforce-third-gen', 'level-14', 'Level 14', 9, 'TGUP', '{"level-13"}', false, '', 16),
	('fireforce-third-gen', 'level-15', 'Level 15', 12, 'TGUP', '{"level-14"}', false, '', 17),
	('fireforce-third-gen', 'level-y', 'Level Y', 20, 'TGUP', '{"level-15"}', false, 'Adolla Burst only', 18),
	('fireforce-third-gen', 'oxygen-tank-size', 'Oxygen Tank Size', null, null, '{"generation-three"}', true, '', 19),
	('fireforce-third-gen', 'level-0-2', 'Level 0', null, null, '{"oxygen-tank-size"}', true, '', 20),
	('fireforce-third-gen', 'level-1-2', 'Level 1', 6, 'TGUP', '{"level-0-2"}', false, '', 21),
	('fireforce-third-gen', 'level-2-2', 'Level 2', 6, 'TGUP', '{"level-1-2"}', false, '', 22),
	('fireforce-third-gen', 'level-3-2', 'Level 3', 6, 'TGUP', '{"level-2-2"}', false, '', 23),
	('fireforce-third-gen', 'level-4-2', 'Level 4', 6, 'TGUP', '{"level-3-2"}', false, '', 24),
	('fireforce-third-gen', 'level-5-2', 'Level 5', 12, 'TGUP', '{"level-4-2"}', false, '', 25),
	('fireforce-third-gen', 'level-6-2', 'Level 6', 12, 'TGUP', '{"level-5-2"}', false, '', 26),
	('fireforce-third-gen', 'level-7-2', 'Level 7', 12, 'TGUP', '{"level-6-2"}', false, '', 27),
	('fireforce-third-gen', 'level-8-2', 'Level 8', 12, 'TGUP', '{"level-7-2"}', false, '', 28),
	('fireforce-third-gen', 'level-9-2', 'Level 9', 12, 'TGUP', '{"level-8-2"}', false, '', 29),
	('fireforce-third-gen', 'level-10-2', 'Level 10', 18, 'TGUP', '{"level-9-2"}', false, '', 30),
	('fireforce-third-gen', 'pyrokinetic-efficiency', 'Pyrokinetic Efficiency', null, null, '{"generation-three"}', true, '', 31),
	('fireforce-third-gen', 'level-0-3', 'Level 0', null, null, '{"pyrokinetic-efficiency"}', true, '', 32),
	('fireforce-third-gen', 'level-1-3', 'Level 1', 7, 'TGUP', '{"level-0-3"}', false, '', 33),
	('fireforce-third-gen', 'level-2-3', 'Level 2', 7, 'TGUP', '{"level-1-3"}', false, '', 34),
	('fireforce-third-gen', 'level-3-3', 'Level 3', 7, 'TGUP', '{"level-2-3"}', false, '', 35),
	('fireforce-third-gen', 'level-4-3', 'Level 4', 7, 'TGUP', '{"level-3-3"}', false, '', 36),
	('fireforce-third-gen', 'level-5-3', 'Level 5', 14, 'TGUP', '{"level-4-3"}', false, '', 37),
	('fireforce-third-gen', 'level-6-3', 'Level 6', 14, 'TGUP', '{"level-5-3"}', false, '', 38),
	('fireforce-third-gen', 'level-7-3', 'Level 7', 14, 'TGUP', '{"level-6-3"}', false, '', 39),
	('fireforce-third-gen', 'oxygen-absorption-rate', 'Oxygen Absorption Rate', null, null, '{"generation-three"}', true, '', 40),
	('fireforce-third-gen', 'level-0-4', 'Level 0', null, null, '{"oxygen-absorption-rate"}', true, '', 41),
	('fireforce-third-gen', 'level-1-4', 'Level 1', 5, 'TGUP', '{"level-0-4"}', false, '', 42),
	('fireforce-third-gen', 'level-2-4', 'Level 2', 5, 'TGUP', '{"level-1-4"}', false, '', 43),
	('fireforce-third-gen', 'level-3-4', 'Level 3', 5, 'TGUP', '{"level-2-4"}', false, '', 44),
	('fireforce-third-gen', 'level-4-4', 'Level 4', 5, 'TGUP', '{"level-3-4"}', false, '', 45),
	('fireforce-third-gen', 'level-5-4', 'Level 5', 10, 'TGUP', '{"level-4-4"}', false, '', 46),
	('fireforce-third-gen', 'level-6-4', 'Level 6', 10, 'TGUP', '{"level-5-4"}', false, '', 47),
	('fireforce-third-gen', 'level-7-4', 'Level 7', 10, 'TGUP', '{"level-6-4"}', false, '', 48),
	('fireforce-third-gen', 'level-8-3', 'Level 8', 10, 'TGUP', '{"level-7-4"}', false, '', 49),
	('fireforce-third-gen', 'level-9-3', 'Level 9', 10, 'TGUP', '{"level-8-3"}', false, '', 50),
	('fireforce-third-gen', 'level-10-3', 'Level 10', 15, 'TGUP', '{"level-9-3"}', false, '', 51),
	('fireforce-third-gen', 'level-11-2', 'Level 11', 15, 'TGUP', '{"level-10-3"}', false, '', 52),
	('fireforce-third-gen', 'level-12-2', 'Level 12', 15, 'TGUP', '{"level-11-2"}', false, '', 53),
	('fireforce-third-gen', 'level-13-2', 'Level 13', 15, 'TGUP', '{"level-12-2"}', false, '', 54),
	('fireforce-third-gen', 'level-14-2', 'Level 14', 15, 'TGUP', '{"level-13-2"}', false, '', 55),
	('fireforce-third-gen', 'level-15-2', 'Level 15', 20, 'TGUP', '{"level-14-2"}', false, '', 56)
on conflict (tree_id, id) do update set label = excluded.label, cost_amount = excluded.cost_amount, cost_currency = excluded.cost_currency,
	requires = excluded.requires, start = excluded.start, description = excluded.description, sort = excluded.sort;
