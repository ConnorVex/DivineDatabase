// Fire Force numbers from the Index (Second Generation, Third Generation, Tephrosis, Pyrokinetic
// Techniques, Adolla). Levels Y and Z are stored as 16 and 17.
import type { Field, Fields, Option } from './systems.ts';

export interface PyroLevel {
	name: string;
	standard: number | string;
	ultimate: number | string;
}

const NAMES = ['No Power', 'Miniscule', 'Inconsequential', 'Minute', 'Trivial', 'Little', 'Small', 'Average', 'Above Average', 'Decent', 'Good', 'Great', 'Amazing', 'Insane', 'Immense', 'Pyrokinetic Master', 'Hybrid Power', 'Adolla Grace'];
const SHARED: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 5], [6, 8], [10, 10], [15, 20], [25, 30], [40, 50], [50, 60], [70, 80], [90, 100], [110, 120]];

const table = (start: number, master: number, y: number): PyroLevel[] =>
	[[start, start] as [number, number], ...SHARED, [master, master] as [number, number], [y, y] as [number, number]]
		.map(([s, u], i): PyroLevel => ({ name: NAMES[i], standard: s, ultimate: u }))
		.concat({ name: NAMES[17], standard: '150+', ultimate: '150+' });

/** Second Generation: Pyrokinetic Manipulation. */
export const MANIPULATION = table(0.5, 130, 142);
/** Third Generation: Pyrokinetic Power. */
export const POWER = table(0, 125, 130);

/** Level 16 is Y, 17 is Z. */
export const levelTag = (n: number) => (n === 16 ? 'Y' : n === 17 ? 'Z' : String(n));
export const levelOptions = (levels: PyroLevel[]): Option[] => levels.map((l, i) => ({ value: String(i), label: `Lv ${levelTag(i)} — ${l.name} (${l.standard} Standard / ${l.ultimate} Ult)` }));

/** Oxygen Tank levels 1–10: OP stored. */
export const OXYGEN_TANK = [60, 80, 100, 120, 140, 160, 180, 200, 220, 250];
/** Pyrokinetic Efficiency 0–7: OP per Standard / Ultimate skill. */
export const EFFICIENCY: [number, number][] = [[45, 55], [40, 50], [35, 45], [30, 40], [25, 35], [20, 30], [15, 25], [10, 20]];
/** Oxygen Absorption 0–15: +5 OP a turn at 0, +1 per level. */
export const absorptionRate = (level: number) => 5 + level;
export const ABSORPTION_MAX = 15;

export const numberOptions = (from: number, to: number, label?: (n: number) => string): Option[] =>
	Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: label?.(from + i) }));

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export const isSecond = (f: Fields) => f.generation === 'Second' || f.generation === 'XO';
export const isThird = (f: Fields) => f.generation === 'Third' || f.generation === 'XO';
export const hasBurst = (f: Fields) => f.adollaBurst === 'Yes';
export const hasGrace = (f: Fields) => hasBurst(f) && String(f.adollaEntity ?? '').trim() !== '';

/** What the card's levels work out to. */
export function fireStats(f: Fields) {
	const manip = Math.min(17, Math.max(0, num(f.manipulation)));
	const power = Math.min(17, Math.max(0, num(f.power)));
	const tank = Math.min(10, Math.max(1, num(f.oxygenTank) || 1));
	const eff = Math.min(7, Math.max(0, num(f.efficiency)));
	const abs = Math.min(ABSORPTION_MAX, Math.max(0, num(f.absorption)));
	return {
		manipulation: isSecond(f) ? { level: manip, ...MANIPULATION[manip] } : null,
		power: isThird(f) ? { level: power, ...POWER[power] } : null,
		oxygen: isThird(f) ? { op: OXYGEN_TANK[tank - 1], cost: EFFICIENCY[eff], refill: absorptionRate(abs) } : null,
	};
}

/** Tephrosis, from the Index. */
export const TEPHROSIS: { id: string; badge: string; effects: string[] }[] = [
	{ id: 'Initial Overheat', badge: '2 RPs', effects: ['No debuffs yet: your abilities are quietly burning your flesh for fuel'] },
	{ id: 'Charring', badge: '5 RPs', effects: ['Physical stats −8 Sub-Tiers', 'Pyrokinetic Power −4 levels', 'Painful, permanent charring where your ability shows most'] },
	{ id: 'End Stage', badge: 'Until death', effects: ['Reduced to the Human Phase', 'Pyrokinetic Power drops to Level 2', 'You need a caretaker for your burns'] },
	{ id: 'Adaptation', badge: 'Body Of Adaptation', effects: ['All debuffs removed', 'Your Pyrokinetics turn to smoke', 'A Tephrosis-based ability'] },
];
export const ADAPTATION_TRAIT = 'Body Of Adaptation';

/** Breath of Life and Press of Death: levels 1–3 cost 10 / 20 / 30 of your generation's points. */
export const TECHNIQUE_COST = [0, 10, 20, 30];
export const BREATH = ['+2 Sub-Tiers', '+4 Sub-Tiers', '+6 Sub-Tiers', '+8 Sub-Tiers'];
export const PRESS = [
	['+3 Sub-Tiers', '+2 levels'],
	['+6 Sub-Tiers', '+4 levels'],
	['+9 Sub-Tiers', '+6 levels'],
	['+12 Sub-Tiers', '+8 levels'],
];
/** All or Nothing: the Stamina needed for each level and its bonus. */
export const ALL_OR_NOTHING: { stamina: string; bonus: number }[] = [
	{ stamina: '2A', bonus: 5 },
	{ stamina: '4A', bonus: 10 },
	{ stamina: '6A', bonus: 15 },
	{ stamina: '8A', bonus: 20 },
	{ stamina: '10A', bonus: 25 },
];
export const TECHNIQUES = ['Breath of Life', 'Press of Death', 'All or Nothing', 'Crimson Technique'] as const;

/** The generation's points, e.g. TGUP. */
export const pointsOf = (f: Fields) => (f.generation === 'Second' ? 'SGUP' : 'TGUP');

/** Fire Force card fields beyond the starting levels: Adolla, Techniques and Tephrosis. */
export const FIRE_FORCE_FIELDS: Field[] = [
	{ key: 'stigma', label: 'Stigma', type: 'select', options: [{ value: '' , label: 'None' }, { value: 'Yes', label: 'Scarred by an Adolla Link' }] },
	{ key: 'stigmaMark', label: 'Where the Stigma is', type: 'text', showIf: { key: 'stigma', in: ['Yes'] } },
	{ key: 'adollaBurst', label: 'Adolla Burst', type: 'select', options: [{ value: '', label: 'None' }, { value: 'Yes', label: 'Has an Adolla Burst' }] },
	{ key: 'pillar', label: 'Pillar emotion (if a Pillar)', type: 'text', showIf: { key: 'adollaBurst', in: ['Yes'] } },
	{ key: 'adollaEntity', label: 'Adolla Entity who granted the Grace', type: 'text' },
	{ key: 'fourthAbility', label: 'Fourth Generation ability', type: 'textarea', help: 'Theme-based, and it breaks the laws of physics.', showIf: { key: 'adollaBurst', in: ['Yes'] } },
	// Kept in step with the technique log (who taught each one) and the Crimson list.
	{ key: 'techniques', label: 'Techniques taught', type: 'multiselect', options: TECHNIQUES.map((value) => ({ value })) },
	{ key: 'breathLevel', label: 'Breath of Life level', type: 'select', options: numberOptions(0, 3), default: '0', showIf: { key: 'techniques', in: ['Breath of Life'] } },
	{ key: 'pressLevel', label: 'Press of Death level', type: 'select', options: numberOptions(0, 3), default: '0', showIf: { key: 'techniques', in: ['Press of Death'] } },
	{
		key: 'crimson',
		label: 'Crimson Techniques',
		type: 'list',
		help: '8 exist. Each one is learned from its inventor.',
		columns: [
			{ key: 'name', label: 'Technique', type: 'text', required: true },
			{ key: 'inventor', label: 'Learned from (its inventor)', type: 'text', required: true },
		],
	},
	{ key: 'tephrosis', label: 'Tephrosis stage', type: 'select', options: [{ value: '', label: 'None' }, ...TEPHROSIS.map((t) => ({ value: t.id }))] },
];

/** The technique fields the Techniques tab shows (the log itself is the guide's). */
export const TECHNIQUE_KEYS = ['breathLevel', 'pressLevel', 'crimson'];
