// Custom skill trees: a player designs one for any system card and sends it with the character.
// Nodes cost the card's own upgrade points (e.g. AUP) or a custom currency the player names; a
// custom currency's rates (per session, and converting from the card's points) need staff approval.
import type { SkillNode } from './points.ts';
import type { SystemEntry } from './sheet.ts';

export interface CustomTreeNode {
	id: string;
	label: string;
	description: string;
	/** In the tree's currency; 0 is free (owned once its requirements are). */
	cost: number;
	requires: string[];
	/** Owned from the start, like the root of a wiki tree. */
	start: boolean;
	/** One of the character's starting skills: owned once approved, nothing to unlock. */
	known?: boolean;
}

export interface CustomCurrency {
	name: string;
	code: string;
	/** Earned per approved training session that used the card. */
	gain: number;
	/** Converting from one of the card's currencies ('' for none): convertFromAmount → convertToAmount. */
	convertFrom: string;
	convertFromAmount: number;
	convertToAmount: number;
}

export interface CustomTree {
	name: string;
	/** A currency code of the card's system, or CUSTOM for the player's own. */
	currency: string;
	custom: CustomCurrency;
	nodes: CustomTreeNode[];
}

export const CUSTOM = 'CUSTOM';
export const MAX_NODES = 60;

/** The wallets each system's cards have (mirrors point_currencies). */
const SYSTEM_CURRENCIES: Record<string, { code: string; when?: (f: SystemEntry['fields']) => boolean }[]> = {
	abilities: [{ code: 'AUP' }],
	quirk: [{ code: 'QUP' }],
	'jujutsu-kaisen': [
		{ code: 'JJUUP' },
		{ code: 'CEUP' },
		{ code: 'CTUP', when: (f) => ['Cursed Technique', ''].includes(String(f.start ?? '')) },
		{ code: 'BTUP' },
	],
	jojo: [
		{ code: 'HUP', when: (f) => f.hamon === 'Yes' || f.path === 'Hamon' },
		{ code: 'SUP', when: (f) => f.spin === 'Yes' || f.path === 'Spin' },
		{ code: 'VUP', when: (f) => f.vampire === 'Yes' || f.path === 'Vampire' },
	],
	'fire-force': [
		{ code: 'SGUP', when: (f) => f.generation === 'Second' },
		{ code: 'TGUP', when: (f) => f.generation === 'Third' },
	],
};

/** The upgrade point currencies a card has, e.g. ['AUP']. */
export const cardCurrencyCodes = (entry: SystemEntry) => (SYSTEM_CURRENCIES[entry.system] ?? []).filter((c) => !c.when || c.when(entry.fields)).map((c) => c.code);

export const newNodeId = () => Math.random().toString(36).slice(2, 9);

export function blankTree(entry: SystemEntry): CustomTree {
	const root = newNodeId();
	return {
		name: '',
		currency: cardCurrencyCodes(entry)[0] ?? CUSTOM,
		custom: { name: '', code: '', gain: 0, convertFrom: '', convertFromAmount: 5, convertToAmount: 1 },
		nodes: [{ id: root, label: 'Start', description: '', cost: 0, requires: [], start: true }],
	};
}

/** What the tree's nodes cost in: the card's currency code, or the custom currency's code. */
export const treeCurrencyLabel = (tree: CustomTree) => (tree.currency === CUSTOM ? tree.custom.code || 'points' : tree.currency);

/** Problems that stop the tree being sent (empty when it's fine). */
export function treeProblems(tree: CustomTree, entry: SystemEntry): string[] {
	const out: string[] = [];
	const ids = new Set(tree.nodes.map((n) => n.id));
	if (!tree.name.trim()) out.push('name the custom skill tree.');
	if (!tree.nodes.some((n) => !n.start)) out.push('add at least one skill to unlock on the custom tree.');
	if (tree.nodes.length > MAX_NODES) out.push(`a custom tree can have at most ${MAX_NODES} skills.`);
	if (tree.currency !== CUSTOM && !cardCurrencyCodes(entry).includes(tree.currency)) out.push(`the custom tree’s currency (${tree.currency}) isn’t one this card has.`);
	if (tree.currency === CUSTOM) {
		const c = tree.custom;
		if (!c.name.trim()) out.push('name the custom currency.');
		if (!/^[A-Za-z]{1,6}$/.test(c.code)) out.push('give the custom currency a short code of 1 to 6 letters.');
		if (!Number.isInteger(c.gain) || c.gain < 0 || c.gain > 50) out.push('the custom currency earns 0 to 50 per session.');
		if (c.convertFrom && !cardCurrencyCodes(entry).includes(c.convertFrom)) out.push(`the custom currency converts from ${c.convertFrom}, which this card doesn’t have.`);
		if (c.convertFrom && !(c.convertFromAmount >= 1 && c.convertToAmount >= 1)) out.push('both sides of the conversion need at least 1.');
		if (!c.gain && !c.convertFrom) out.push('the custom currency needs a way to earn it: points per session or a conversion.');
	}
	for (const n of tree.nodes) {
		if (!n.label.trim()) out.push('a custom tree skill is missing its name.');
		if (!Number.isInteger(n.cost) || n.cost < 0 || n.cost > 10000) out.push(`“${n.label || 'unnamed'}” needs a cost from 0 to 10000.`);
		if (n.requires.some((r) => r === n.id || !ids.has(r))) out.push(`“${n.label || 'unnamed'}” requires a skill that isn’t on the tree.`);
	}
	// Requirements must not loop back on themselves.
	const byId = new Map(tree.nodes.map((n) => [n.id, n]));
	const state = new Map<string, 'visiting' | 'done'>();
	const loops = (id: string): boolean => {
		if (state.get(id) === 'done') return false;
		if (state.get(id) === 'visiting') return true;
		state.set(id, 'visiting');
		const hit = (byId.get(id)?.requires ?? []).some(loops);
		state.set(id, 'done');
		return hit;
	};
	if (tree.nodes.some((n) => loops(n.id))) out.push('the custom tree’s requirements go in a circle.');
	return [...new Set(out)];
}

/** Whether a custom currency's rates differ from the approved ones (and so need staff approval). */
export const currencyChanged = (tree: CustomTree, approved?: CustomTree | null) =>
	tree.currency === CUSTOM && (approved?.currency !== CUSTOM || JSON.stringify(tree.custom) !== JSON.stringify(approved.custom));

/** The tree as skill tree nodes (costs in the card's currency code, or CUSTOM); a cost of 0 is free. */
export const customTreeNodes = (tree: CustomTree): SkillNode[] =>
	tree.nodes.map((n, i) => ({
		tree_id: 'custom',
		id: n.id,
		label: n.label || 'Unnamed',
		cost_amount: n.start || n.known || !n.cost ? null : n.cost,
		cost_currency: n.start || n.known || !n.cost ? null : tree.currency,
		requires: n.requires,
		start: n.start || Boolean(n.known),
		description: n.description,
		sort: i,
	}));
