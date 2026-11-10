// Maximum All For One (M:AFO): a custom Quirk that steals Quirks, Abilities and Conduits, stores them
// and gives them to others. The database does the moving (see the maximum_all_for_one migration);
// this file is the card, the storage maths and the wording, with no database calls, so tests can use it.
import type { SystemEntry } from './sheet.ts';

export const MAFO_TREE = 'mha-mafo';
export type MafoKind = 'quirk' | 'ability' | 'conduit';
export const MAFO_KINDS: { id: MafoKind; label: string; plural: string }[] = [
	{ id: 'quirk', label: 'Quirk', plural: 'Quirks' },
	{ id: 'ability', label: 'Ability', plural: 'Abilities' },
	{ id: 'conduit', label: 'Conduit', plural: 'Conduits' },
];

export interface MafoCapacity {
	quirk: number;
	ability: number;
	conduit: number;
	/** Infinite Capacity: no storage limits. */
	unlimited: boolean;
	/** RP (days) before a stolen Ability decays. */
	decayRp: number;
	/** When Ability Stabilization was bought (Abilities stop decaying from then). */
	stableSince: string | null;
	conduitTransfer: boolean;
}

export interface MafoItem {
	id: number;
	kind: MafoKind;
	tier: string;
	slots: number;
	mqp: number;
	name: string;
	source_name: string;
	status: 'stored' | 'transferred';
	stolen_at: string;
	transferred_at: string | null;
	transferred_to: string | null;
	decayed: boolean;
	decays_at: string | null;
	card: SystemEntry;
}

export interface MafoRequest {
	id: number;
	action: 'steal' | 'transfer';
	status: 'pending' | 'approved' | 'denied';
	note: string;
	reason: string;
	requested_at: string;
	victim_name: string | null;
	card_name: string | null;
	item_name: string | null;
	target_name: string | null;
}

export interface MafoState {
	card_key: string;
	weaker: boolean;
	/** Only for the owner and admins. */
	free_actions: boolean | null;
	capacity: MafoCapacity;
	items: MafoItem[];
	/** Only for the owner and admins (null otherwise). */
	requests: MafoRequest[] | null;
}

/** A card M:AFO could take, and what it's worth (or why it can't). */
export interface MafoTargetCard {
	key: string;
	system: string;
	kind?: MafoKind;
	tier?: string;
	slots?: number;
	mqp?: number;
	name?: string;
	error?: string;
}

export interface MafoTarget {
	id: string;
	name: string;
	owner: string | null;
	cards: MafoTargetCard[];
}

export interface MafoQueueItem {
	id: number;
	action: 'steal' | 'transfer';
	note: string;
	requested_at: string;
	holder_id: string;
	holder_name: string;
	weaker: boolean;
	victim_name: string | null;
	card: (MafoTargetCard & { system: string }) | null;
	item: { name: string; kind: MafoKind; tier: string; slots: number } | null;
	target_name: string | null;
}

export interface MafoHolder {
	character_id: string;
	card_key: string;
	weaker: boolean;
	free_actions: boolean;
	name: string;
	granted_at: string;
}

const ABOUT_FULL = `A Maximum Variant Quirk: every upgrade on its tree can be unlocked, and it never goes through Instability. It takes Quirks, Abilities and Conduits from others, stores them, and can give them to someone else.

**Storage:** 100 Quirk slots (Regular 1, Plus 2, Maximum 3, Infinite 50), 50 Ability slots (1 each) and 86 Conduit slots (Elemental 1, Energy 4, Psychic 8, Meta 40, Quantum 73). Upgrades on the M:AFO skill tree add more.

**Meta Quirk Points (MQP):** every steal gives MQP, which traits don't change. Quirks: Regular 1, Plus 2, Maximum 4, Infinite 10. Abilities: Production 3, Controller 6, Accumulation 8, Transformation 15. Conduits: Elemental 5, Energy 10, Psychic 20, Meta 30, Quantum 50. Spend them on the M:AFO skill tree.`;

const DRAWBACKS_FULL = `A stolen Ability decays 3 RP after it's taken, unless upgrades preserve or stabilise it.

Conduits can't be given to others without Conduit Transference.

God class Abilities, Biologically Enhanced Conduits, Adolla Bursts, Graces, Blessings and Limited Abilities can't be taken.

**Singularity:** storing more than M:AFO can hold maxes every stat except Intelligence, and the user dies in 4 turns.`;

const ABOUT_WEAKER = `A weaker Maximum All For One, still a Maximum Variant that never goes through Instability. It takes Quirks, Abilities and Conduits from others, stores them, and can give them to someone else, with half the storage: 50 Quirk slots, 25 Ability slots and 43 Conduit slots.`;

const DRAWBACKS_WEAKER = `No upgrades and no Meta Quirk Points.

Only 2 Weaker M:AFOs can exist at a time.

A stolen Ability decays 3 RP after it's taken. Conduits can't be given to others.

God class Abilities, Biologically Enhanced Conduits, Adolla Bursts, Graces, Blessings and Limited Abilities can't be taken.

**Singularity:** storing more than it can hold maxes every stat except Intelligence, and the user dies in 4 turns.`;

/** Fields the holder still fills in on their M:AFO card. */
const OWN_FIELDS = ['subclass', 'power', 'range', 'factor', 'upgradePoints', 'awakenings', 'awakeningLog', 'variantCapabilities'];

export const MAFO_TITLE = 'Maximum: All For One';
export const mafoTitle = (weaker: boolean) => (weaker ? 'Weaker Maximum: All For One' : MAFO_TITLE);

/** The M:AFO Quirk card Tatsuya's grant adds to a sheet. It's locked like a granted power and sits on top of the card limit. */
export function mafoCard(weaker: boolean, key = Math.random().toString(36).slice(2, 10)): SystemEntry {
	return {
		key,
		system: 'quirk',
		fields: { name: mafoTitle(weaker), type: 'Emitter', subclass: 'None', power: 'No Power', range: 'Physical', variant: 'Maximum', mafo: weaker ? 'Weaker' : 'Full' },
		description: '',
		skills: [],
		rollProofs: {},
		powerLink: {
			powerId: 'mafo',
			grantId: null,
			title: mafoTitle(weaker),
			own: OWN_FIELDS,
			ownSkills: true,
			about: weaker ? ABOUT_WEAKER : ABOUT_FULL,
			drawbacks: weaker ? DRAWBACKS_WEAKER : DRAWBACKS_FULL,
		},
	};
}

export const isMafoCard = (e: Pick<SystemEntry, 'fields'>) => e.fields.mafo === 'Full' || e.fields.mafo === 'Weaker';

/** Slots used per kind by what's still stored (a decayed Ability no longer takes a slot). */
export function mafoUsage(state: Pick<MafoState, 'items' | 'capacity'>) {
	return MAFO_KINDS.map((k) => {
		const used = state.items.filter((i) => i.kind === k.id && i.status === 'stored' && !i.decayed).reduce((n, i) => n + i.slots, 0);
		const cap = state.capacity[k.id];
		return { ...k, used, cap, over: !state.capacity.unlimited && used > cap };
	});
}

/** Over capacity in any storage: the holder is in Singularity. */
export const inSingularity = (state: Pick<MafoState, 'items' | 'capacity'>) => mafoUsage(state).some((u) => u.over);

/** "2 RP left", "less than 1 RP left", or null when the item doesn't decay. */
export function decayLeft(item: Pick<MafoItem, 'kind' | 'status' | 'decayed' | 'decays_at' | 'stolen_at'>, cap: Pick<MafoCapacity, 'stableSince'>, now = Date.now()): string | null {
	if (item.kind !== 'ability' || item.status !== 'stored' || item.decayed || !item.decays_at) return null;
	if (cap.stableSince && Date.parse(cap.stableSince) <= Date.parse(item.decays_at)) return null;
	const days = (Date.parse(item.decays_at) - now) / 86_400_000;
	if (days < 1) return 'less than 1 RP left';
	return `${Math.ceil(days)} RP left`;
}

/** What a stolen card is, in a few words: "Maximum Quirk · 3 slots · 4 MQP". */
export function worth(c: { kind?: MafoKind; tier?: string; slots?: number; mqp?: number }, withMqp = true): string {
	const kind = MAFO_KINDS.find((k) => k.id === c.kind)?.label ?? '';
	return [`${c.tier} ${kind}`.trim(), `${c.slots} slot${c.slots === 1 ? '' : 's'}`, withMqp ? `${c.mqp} MQP` : ''].filter(Boolean).join(' · ');
}
