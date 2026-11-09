// inFAMOUS numbers from the Index (Elemental, Energy, Psychic, Biologically Enhanced, Karma System,
// Conduit Evolution).
import type { DefaultMove, Field, Fields, Option } from './systems.ts';

const opt = (value: string, label = value): Option => ({ value, label });
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export const isElemental = (f: Fields) => f.class === 'Elemental';
export const isEnergy = (f: Fields) => f.class === 'Energy';
/** Classes with Blasts, Specials and new moves from Core Relays. */
export const growsMoves = (f: Fields) => ['Elemental', 'Energy', 'Meta', 'Quantum'].includes(String(f.class));

/** Power: 17 levels. Each "x.x" level covers the whole Defense Tier the plain level reaches up to C. */
export const POWER_LEVELS = ['0', '0.1', '1', '1.1', '2', '2.2', '3', '3.3', '4', '4.4', '5', '5.5', '6', '6.6', '7', '7.7', 'X'];
/** The Defense it gets through: Elementals start at Tier 2, Energy one Tier ahead. */
export function powerBeats(level: string, energy: boolean) {
	if (level === 'X') return `all of Tier ${energy ? 20 : 14}`;
	const i = POWER_LEVELS.indexOf(level);
	const tier = Math.floor(Math.max(0, i) / 2) + (energy ? 3 : 2);
	return i % 2 ? `all of Tier ${tier}` : `Tier ${tier} up to C`;
}
export const powerOptions = POWER_LEVELS.map((v) => opt(v, `Lv ${v}${v === '0' ? ' (Start)' : ''}`));

/** Elemental Drain: 5 (start) to 1. */
export const DRAIN: Record<string, { gain: string; turns: number }> = {
	'5': { gain: '+10 EP a source', turns: 5 },
	'4': { gain: '+20 EP a source', turns: 4 },
	'3': { gain: '+30 EP a source', turns: 3 },
	'2': { gain: '+40 EP a source', turns: 2 },
	'1': { gain: 'Full tank', turns: 1 },
};
export const drainOptions = ['5', '4', '3', '2', '1'].map((v) => opt(v, `Lv ${v} — ${DRAIN[v].gain}, ${DRAIN[v].turns} turn${DRAIN[v].turns === 1 ? '' : 's'}${v === '5' ? ' (Start)' : ''}`));

/** Heal: 6.6 (start) to 1.1; what you heal on yourself and on others. */
export const HEAL: [string, string][] = [
	['6.6', 'NL-Class 3'],
	['5.5', 'NL-Class 2'],
	['4.4', 'NL-Class 1'],
	['3.3', 'L-Class 3'],
	['2.2', 'L-Class 2'],
	['1.1', 'L-Class 1'],
];
export const healOptions = HEAL.map(([v, injury], i) => opt(v, `Lv ${v} — ${injury} or below${i === 0 ? ' (Start)' : ''}`));

/** Tanks: EP and Specials by level (the last is Max). */
export const ELEMENTAL_TANK = [60, 90, 120, 150, 180];
export const ENERGY_TANK = [100, 110, 120, 130];
const tankOptions = (tank: number[]) => tank.map((ep, i) => opt(String(i), `${i === tank.length - 1 ? 'Max' : `Lv ${i}`} — ${ep} EP, ${2 + i} Specials${i === 0 ? ' (Start)' : ''}`));

/** Psychic phases. */
export const PHASES: { id: string; lifts: string; takeover: string; resist: string; breakFree: string }[] = [
	{ id: '5', lifts: 'Strength +1', takeover: '5 turns', resist: 'every 3 commands (1d60, 30+)', breakFree: 'every RP (1d100, 50+)' },
	{ id: '4', lifts: 'Strength +2', takeover: '4 turns', resist: 'every 6 commands (1d60, 40+)', breakFree: 'every 2 RPs (1d100, 60+)' },
	{ id: '3', lifts: 'Strength +4', takeover: '3 turns (2 if unconscious)', resist: 'every 9 commands (1d60, 55+)', breakFree: 'every 6 RPs (1d100, 90+)' },
	{ id: '2', lifts: 'Strength +6', takeover: '2 turns (instant if unconscious)', resist: 'can’t', breakFree: 'can’t' },
	{ id: 'X', lifts: 'Strength +20 (a building)', takeover: 'instant on contact', resist: 'can’t', breakFree: 'can’t' },
];

/** Mental Domination by phase: how often a victim may resist commands or break free (null: they can't). */
export const DOMINATION: Record<string, { resistEvery: number | null; resistRoll: string; breakEvery: number | null; breakRoll: string }> = {
	'5': { resistEvery: 3, resistRoll: '1d60, 30+', breakEvery: 1, breakRoll: '1d100, 50+' },
	'4': { resistEvery: 6, resistRoll: '1d60, 40+', breakEvery: 2, breakRoll: '1d100, 60+' },
	'3': { resistEvery: 9, resistRoll: '1d60, 55+', breakEvery: 6, breakRoll: '1d100, 90+' },
	'2': { resistEvery: null, resistRoll: '', breakEvery: null, breakRoll: '' },
	X: { resistEvery: null, resistRoll: '', breakEvery: null, breakRoll: '' },
};
export const PUPPET_KINDS = ['OC', 'Canon', 'NPC'] as const;
/** Who a Psychic can take over: Bio-Conduits and lower-phase Psychics only at Phase X. */
export const PUPPET_TARGETS = ['Human or other', 'Bio-Enhanced Conduit', 'Lower-phase Psychic'] as const;
export interface Puppet {
	name: string;
	kind: string;
	target: string;
	how: string;
	commands: string;
	rps: string;
}
export const puppetsOf = (f: Fields): Puppet[] => (Array.isArray(f.puppets) ? (f.puppets as unknown as Puppet[]) : []);
/** Whether a puppet's resist or break-free roll is due now, at the card's phase. */
export function puppetRolls(p: Puppet, phase: string) {
	const d = DOMINATION[phase] ?? DOMINATION['5'];
	const commands = num(p.commands);
	const rps = num(p.rps);
	return {
		resist: d.resistEvery !== null && commands > 0 && commands % d.resistEvery === 0 ? d.resistRoll : null,
		breakFree: d.breakEvery !== null && rps > 0 && rps % d.breakEvery === 0 ? d.breakRoll : null,
		nextResist: d.resistEvery === null ? null : d.resistEvery - (commands % d.resistEvery),
		nextBreak: d.breakEvery === null ? null : d.breakEvery - (rps % d.breakEvery),
	};
}

/** Bio-Conduits: Physical Points per item absorbed, +5 per Efficiency Node level. */
export const BIO_ITEMS: { key: string; item: string; base: number }[] = [
	{ key: 'bioShardNode', item: 'Blast Shard', base: 3 },
	{ key: 'bioCoreNode', item: 'Blast Core', base: 5 },
	{ key: 'bioRelayNode', item: 'Core Relay', base: 10 },
];

/** Karma ranks: the first needs 100, each after +30 more than the last. */
export const KARMA_RANKS: Record<string, string[]> = {
	Good: ['Protector', 'Guardian', 'Champion', 'Paragon', 'True Hero'],
	Evil: ['Thug', 'Criminal', 'Bio-Terrorist', 'Most Wanted', 'Infamous'],
};
export const KARMA_THRESHOLDS = [100, 230, 390, 580, 800];
export function karmaRank(f: Fields) {
	const points = num(f.karmaPoints);
	const ranks = KARMA_RANKS[String(f.karma)] ?? null;
	const reached = KARMA_THRESHOLDS.filter((t) => points >= t).length;
	return { points, ranks, reached, next: KARMA_THRESHOLDS[reached] ?? null, name: ranks && reached ? ranks[reached - 1] : null };
}

/** Evolution items, and what Core Relays give. */
export const ITEMS = [
	{ key: 'blastShards', label: 'Blast Shards', rarity: 'Common' },
	{ key: 'blastCores', label: 'Blast Cores', rarity: 'Very rare' },
	{ key: 'coreRelays', label: 'Core Relays', rarity: 'Rarest (Mainland only)' },
];
export const ITEM_KEYS = ITEMS.map((i) => i.key);
export const KARMA_BOMB_RELAYS = 5;
export const relayMoves = (f: Fields) => ({ standard: num(f.coreRelays), specials: Math.floor(num(f.coreRelays) / 2) });

/** Conduit Tier Points spent: one per level past the start, on any stat but Tank. */
export function ctpSpent(f: Fields) {
	if (!isElemental(f) && !isEnergy(f)) return 0;
	const power = Math.max(0, POWER_LEVELS.indexOf(String(f.power ?? '0')));
	const heal = Math.max(0, HEAL.findIndex(([v]) => v === String(f.heal ?? '6.6')));
	const drain = isElemental(f) ? Math.max(0, 5 - (num(f.drain) || 5)) : 0;
	const charge = isEnergy(f) ? num(f.chargeUpgrades) : 0;
	return power + heal + drain + charge;
}

/** Bio-Conduits: Physical Points from absorbing each item now. */
export const bioGain = (f: Fields) => BIO_ITEMS.map((b) => ({ ...b, nodes: num(f[b.key]), gain: b.base + 5 * num(f[b.key]) }));

/** What the card works out to, for the stat tiles. */
export function conduitStats(f: Fields) {
	const tankLevels = isElemental(f) ? ELEMENTAL_TANK : isEnergy(f) ? ENERGY_TANK : null;
	const tank = tankLevels ? Math.min(tankLevels.length - 1, num(isElemental(f) ? f.tank : f.energyTank)) : 0;
	return {
		tank: tankLevels ? { ep: tankLevels[tank], specials: 2 + tank, max: tank === tankLevels.length - 1 } : null,
		power: isElemental(f) || isEnergy(f) ? { level: String(f.power ?? '0'), beats: powerBeats(String(f.power ?? '0'), isEnergy(f)) } : null,
		drain: isElemental(f) ? DRAIN[String(f.drain ?? '5')] ?? DRAIN['5'] : null,
		heal: isElemental(f) || isEnergy(f) ? HEAL.find(([v]) => v === String(f.heal ?? '6.6')) ?? HEAL[0] : null,
		charge: isEnergy(f) ? 10 + 10 * num(f.chargeUpgrades) : null,
		phase: f.class === 'Psychic' ? PHASES.find((p) => p.id === String(f.psychicPhase ?? '5')) ?? PHASES[0] : null,
	};
}

/** The moves every Elemental or Energy Conduit has (Index skill tables). */
export function conduitMoves(f: Fields): DefaultMove[] {
	if (!isElemental(f) && !isEnergy(f)) return [];
	const kind = isElemental(f) ? 'Elemental' : 'Energy';
	const what = String(f.element ?? '').trim() || (isElemental(f) ? 'your element' : 'your energy');
	const specials = conduitStats(f).tank?.specials ?? 2;
	return [
		{ name: `${kind} Blast`, type: 'standard', cost: isElemental(f) ? '30 EP' : '50 EP', effect: isElemental(f) ? `Ranged blasts of ${what}, continuous or machine-gun style.` : `Ranged blasts of ${what}. Its damage can be upgraded.` },
		...(isElemental(f) ? [{ name: 'Elemental Dash', type: 'standard' as const, cost: '15-turn cooldown', effect: `For one turn, become ${what} for a unique property, like more speed or durability (your choice).` }] : []),
		{ name: `${kind} Special`, type: 'ultimate', cost: '1 Special', effect: `3× your ${kind} Power. You have ${specials} (+1 per Tank upgrade); used ones come back when your tank is ${isElemental(f) ? 'refilled with Drain' : 'full again'}.` },
	];
}

export const CONDUIT_FIELDS: Field[] = [
	{ key: 'power', label: 'Power', type: 'select', options: powerOptions, default: '0', showIf: { key: 'class', in: ['Elemental', 'Energy'] } },
	{ key: 'drain', label: 'Drain', type: 'select', options: drainOptions, default: '5', showIf: { key: 'class', in: ['Elemental'] } },
	{ key: 'heal', label: 'Heal', type: 'select', options: healOptions, default: '6.6', showIf: { key: 'class', in: ['Elemental', 'Energy'] } },
	{ key: 'tank', label: 'Elemental Tank', type: 'select', options: tankOptions(ELEMENTAL_TANK), default: '0', startsAt: ['0'], showIf: { key: 'class', in: ['Elemental'] } },
	{ key: 'energyTank', label: 'Energy Tank', type: 'select', options: tankOptions(ENERGY_TANK), default: '0', startsAt: ['0'], showIf: { key: 'class', in: ['Energy'] } },
	{ key: 'chargeUpgrades', label: 'Charge upgrades', type: 'number', default: 0, min: 0, showIf: { key: 'class', in: ['Energy'] }, help: 'Each adds +10 EP a turn (1 CTP each).' },
	{
		key: 'psychicPhase',
		label: 'Psychic Phase',
		type: 'select',
		options: PHASES.map((p) => ({ value: p.id, label: `Phase ${p.id}${p.id === '5' ? ' (Start)' : ''}`, permission: p.id === 'X' })),
		default: '5',
		startsAt: ['5'],
		showIf: { key: 'class', in: ['Psychic'] },
	},
	// Psychics: the OCs, Canons and NPCs under their Mental Domination (tracked on the Mind tab).
	{
		key: 'puppets',
		label: 'Under your influence',
		type: 'list',
		showIf: { key: 'class', in: ['Psychic'] },
		columns: [
			{ key: 'name', label: 'Who', type: 'text' },
			{ key: 'kind', label: 'OC, Canon or NPC', type: 'select', options: PUPPET_KINDS.map((value) => ({ value })) },
			{ key: 'target', label: 'What they are', type: 'select', options: PUPPET_TARGETS.map((value) => ({ value })) },
			{ key: 'how', label: 'Taken over by', type: 'text' },
			{ key: 'commands', label: 'Commands given', type: 'text' },
			{ key: 'rps', label: 'RPs held', type: 'text' },
		],
	},
	...BIO_ITEMS.map((b): Field => ({ key: b.key, label: `${b.item} Efficiency Node`, type: 'number', default: 0, min: 0, startsAt: 0, showIf: { key: 'class', in: ['Biologically Enhanced'] } })),
	...ITEMS.map((i): Field => ({ key: i.key, label: `${i.label} absorbed`, type: 'number', default: 0, min: 0 })),
	{ key: 'karmaPoints', label: 'Karma on your bar', type: 'number', default: 0, min: 0, startsAt: 0 },
	{ key: 'karmaBomb', label: 'Your Karma Bomb', type: 'textarea', help: 'What it looks like and does.' },
	{ key: 'karmicStreak', label: 'Karmic Streak (out of 100)', type: 'number', default: 0, min: 0, help: 'Fill it with acts that fit your path, 100 PK or NK. It carries over between RPs.' },
];

/** Cards from before the rework: Power and Tank were plain numbers, and Energy shared the Elemental Tank. */
export function conduitFromOld(fields: Fields): Fields {
	const out = { ...fields };
	if (typeof out.power === 'number') out.power = POWER_LEVELS[Math.min(POWER_LEVELS.length - 1, Math.max(0, out.power))];
	if (typeof out.tank === 'number') out.tank = String(out.tank);
	if (out.class === 'Energy' && out.tank !== undefined && !('energyTank' in out)) {
		out.energyTank = out.tank;
		delete out.tank;
	}
	return out;
}
