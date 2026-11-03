// System upgrade points (AUP, JJUUP, CEUP, …). The wallets live in the database (character_points);
// this file names the cards they belong to and which sheet fields only the wallets may change.
import type { Sheet, SystemEntry } from './sheet.ts';
import { systemById } from './systems.ts';

/** Sheet fields that show a wallet balance, by system (see point_currencies.field). */
export const TRACKED_FIELDS: Record<string, string[]> = {
	abilities: ['upgradePoints'],
	quirk: ['upgradePoints'],
	'jujutsu-kaisen': ['ceUpgradePoints', 'ctUpgradePoints'],
	jojo: ['hamonMastery', 'spinMastery', 'vampireUpgradePoints'],
};

export const isTrackedField = (system: string, key: string) => TRACKED_FIELDS[system]?.includes(key) ?? false;

export const TRACKED_HELP = 'Tracked by Ultron: earn it with /training log, convert it on the evolve page.';

/** "Abilities", or "Abilities 2" when the sheet has more than one card of that system. */
export function cardLabel(sheet: Sheet, entry: SystemEntry | string): string {
	const card = typeof entry === 'string' ? sheet.systems.find((e) => e.key === entry) : entry;
	if (!card) return 'Removed card';
	const same = sheet.systems.filter((e) => e.system === card.system);
	const name = systemById.get(card.system)?.label ?? card.system;
	return same.length > 1 ? `${name} ${same.indexOf(card) + 1}` : name;
}

export interface Currency {
	code: string;
	system: string;
	label: string;
	earn: number;
	field: string | null;
	show_if: { key: string; in: string[] } | null;
	sort: number;
}

export interface Conversion {
	id: number;
	from_code: string;
	from_amount: number;
	to_code: string;
	to_amount: number;
}

export interface Balance {
	card_key: string;
	currency: string;
	balance: number;
}

export interface LedgerRow {
	id: number;
	card_key: string;
	currency: string;
	change: number;
	balance_after: number;
	source: 'training' | 'convert' | 'staff' | 'sheet';
	reason: string;
	created_at: string;
}

/** Whether a currency applies to a card (its show_if matches the card's fields). */
export const applies = (c: { show_if: Currency['show_if'] }, entry: SystemEntry) => !c.show_if || c.show_if.in.includes(String(entry.fields[c.show_if.key] ?? ''));

/** The currencies each card of the sheet uses, in order. */
export const cardCurrencies = (sheet: Sheet, currencies: Currency[]) =>
	sheet.systems
		.map((entry) => ({ entry, currencies: currencies.filter((c) => c.system === entry.system && applies(c, entry)).sort((a, b) => a.sort - b.sort) }))
		.filter((c) => c.currencies.length);

export interface SkillTree {
	id: string;
	system: string;
	label: string;
	show_if: { key: string; in: string[] } | null;
	sort: number;
}

export interface SkillNode {
	tree_id: string;
	id: string;
	label: string;
	cost_amount: number | null;
	cost_currency: string | null;
	requires: string[];
	start: boolean;
	description: string;
	sort: number;
}

export interface Unlock {
	card_key: string;
	tree_id: string;
	node_id: string;
	cost_amount: number;
	cost_currency: string | null;
	created_at: string;
}

/** Node ids a card owns: starting points, bought nodes, and free nodes whose requirements are owned. */
export function ownedNodes(nodes: SkillNode[], bought: Set<string>): Set<string> {
	const owned = new Set(nodes.filter((n) => n.start || bought.has(n.id)).map((n) => n.id));
	for (let grew = true; grew; ) {
		grew = false;
		for (const n of nodes) {
			if (!owned.has(n.id) && !n.start && n.cost_amount === null && n.requires.every((r) => owned.has(r))) {
				owned.add(n.id);
				grew = true;
			}
		}
	}
	return owned;
}

const PALETTE = ['#e5484d', '#f76b15', '#e2a336', '#30a46c', '#12a594', '#0090ff', '#8e4ec6', '#d6409f'];

export interface Branch {
	/** The starting point the branch grows from; null for the tree's base. */
	head: SkillNode | null;
	color: string | null;
	/** The branch's nodes in rows by how many requirements deep they are. */
	rows: SkillNode[][];
}

/** The tree split into branches like the wiki colors them: a starting point that has starting-point
 * siblings begins a branch, and every node follows its first requirement into one. */
export function treeBranches(nodes: SkillNode[]): Branch[] {
	const sorted = [...nodes].sort((a, b) => a.sort - b.sort);
	const byId = new Map(sorted.map((n) => [n.id, n]));
	const startKids = new Map<string, SkillNode[]>();
	for (const n of sorted) {
		const parent = n.requires[0];
		if (parent && n.start) (startKids.get(parent) ?? startKids.set(parent, []).get(parent)!).push(n);
	}
	const heads = sorted.filter((n) => n.start && (startKids.get(n.requires[0] ?? '')?.length ?? 0) > 1);
	const headOf = new Map<string, SkillNode | null>();
	const branchOf = (n: SkillNode, seen = new Set<string>()): SkillNode | null => {
		if (headOf.has(n.id)) return headOf.get(n.id)!;
		if (heads.includes(n)) return headOf.set(n.id, n).get(n.id)!;
		const parent = byId.get(n.requires[0] ?? '');
		const head = parent && !seen.has(parent.id) ? branchOf(parent, seen.add(n.id)) : null;
		headOf.set(n.id, head);
		return head;
	};
	const depths = new Map<string, number>();
	const depth = (n: SkillNode): number => {
		if (!depths.has(n.id)) {
			depths.set(n.id, 0);
			const reqs = n.requires.map((r) => byId.get(r)).filter((r): r is SkillNode => r !== undefined);
			depths.set(n.id, reqs.length ? 1 + Math.max(...reqs.map(depth)) : 0);
		}
		return depths.get(n.id)!;
	};
	const groups = new Map<string, SkillNode[]>();
	for (const n of sorted) {
		const key = branchOf(n)?.id ?? '';
		(groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
	}
	return [...groups].map(([key, members]) => {
		const head = key ? byId.get(key)! : null;
		const base = Math.min(...members.map(depth));
		const rows: SkillNode[][] = [];
		for (const n of members) (rows[depth(n) - base] ??= []).push(n);
		return { head, color: head ? PALETTE[heads.indexOf(head) % PALETTE.length] : null, rows: rows.filter(Boolean) };
	});
}
