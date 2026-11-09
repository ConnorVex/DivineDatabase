// JoJo's Bizarre Adventure from the Index: a character starts with a Stand; Hamon, Spin and
// Vampirism are learned (or started with permission). Hamon and Vampirism can't go together, as
// Hamon is deadly to Vampires; Spin goes with either, and anyone can have a Stand.
import type { Field, Fields, Option } from './systems.ts';

const yes = (v: unknown) => v === 'Yes';
export const hasStand = (f: Fields) => f.hasStand !== 'No';
export const hasHamon = (f: Fields) => yes(f.hamon);
export const hasSpin = (f: Fields) => yes(f.spin);
export const isVampire = (f: Fields) => yes(f.vampire) || yes(f.ulf);
export const isUltimate = (f: Fields) => yes(f.ulf);

/** Cards from before the rework had one `path`; they become the matching flags. */
export function jojoFromPath(fields: Fields): Fields {
	const path = fields.path;
	if (typeof path !== 'string' || 'hasStand' in fields) return fields;
	const { path: _old, ...rest } = fields;
	return {
		...rest,
		hasStand: path === 'Stand' ? 'Yes' : 'No',
		...(path === 'Hamon' ? { hamon: 'Yes' } : {}),
		...(path === 'Spin' ? { spin: 'Yes' } : {}),
		...(path === 'Vampire' ? { vampire: 'Yes' } : {}),
		...(path === 'Ultimate Life Form' ? { vampire: 'Yes', ulf: 'Yes' } : {}),
	};
}

/** An upgrade track: each step's change, the last one being Max. */
export interface Track {
	key: string;
	label: string;
	/** The starting value, for numeric tracks. */
	base?: number;
	unit?: string;
	steps: (number | string)[];
}

export const HAMON_TRACKS: Track[] = [
	{ key: 'hamonGaugeUp', label: 'Capacity', base: 200, unit: 'HP', steps: [10, 10, 15, 15, 20, 20, 25, 55] },
	{ key: 'hamonDrainUp', label: 'Drain', base: 50, unit: 'HP a post', steps: [-5, -5, -5, -5, -5, -5, -5, -10] },
	{ key: 'hamonChargeUp', label: 'Charge Rate', base: 50, unit: 'HP a Breathing Post', steps: [10, 10, 10, 10, 10, 10] },
];
export const SPIN_TRACKS: Track[] = [
	{ key: 'spinGaugeUp', label: 'Spin Gauge', base: 100, unit: 'charge', steps: [10, 10, 20, 20, 30, 30, 50] },
	{ key: 'spinDestructiveUp', label: 'Destructive Enhancement', steps: ['+5', '+10', '+15', '+20'] },
	{ key: 'spinShieldingUp', label: 'Shielding', steps: ['+1 Sub-Tier', '+1 Sub-Tier', '+1 Sub-Tier', '+1 Primary Tier', '+2 Primary Tiers', '+3 Primary + 2 Sub-Tiers'] },
];
export const TRACK_KEYS = [...HAMON_TRACKS, ...SPIN_TRACKS].map((t) => t.key);

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export const trackLevel = (t: Track, f: Fields) => Math.max(0, Math.min(t.steps.length, Math.floor(num(f[t.key]))));
/** A numeric track's value now (e.g. 230 HP), or the reached step's text. */
export function trackValue(t: Track, f: Fields): string {
	const level = trackLevel(t, f);
	if (t.base === undefined) return level ? String(t.steps[level - 1]) : 'None yet';
	const total = t.base + t.steps.slice(0, level).reduce<number>((n, s) => n + Number(s), 0);
	return `${total} ${t.unit}`;
}

/** Stand gauges (Creating & Mastering). */
export const STAND_AWAKENING = 180;
/** Starts with the Esoteric Ability awake (and +5 Stand Points, in rules.json). */
export const STAND_PRODIGY = 'Stand Prodigy';
/** The only trait a new character can start with Spin with (JoJo: Spin Basics). */
export const SPIN_TRAIT = 'Spinning Soul';
export const STAND_MASTERY = 110;
export const ENLIGHTENMENT = 250;
/** Developmental Potential grades: the points of growth each gives. */
export const DEV_POTENTIAL: Record<string, string> = { E: '5', D: '10', C: '20', B: '25', A: '30', S: '40', '∞': '∞' };

const flag = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
	key,
	label,
	type: 'select',
	options: [{ value: '', label: 'No' }, { value: 'Yes', label: 'Yes' }] as Option[],
	...extra,
});

/** The fields the learned styles add to the card. */
export const JOJO_GROWTH_FIELDS: Field[] = [
	flag('hamon', 'Hamon user'),
	{ key: 'hamonTeacher', label: 'Who taught you Hamon', type: 'text', showIf: { key: 'hamon', in: ['Yes'] } },
	flag('spin', 'Spin user'),
	{ key: 'spinTeacher', label: 'Who taught you Spin', type: 'text', showIf: { key: 'spin', in: ['Yes'] } },
	{ key: 'goldenSpin', label: 'Golden & Cavalry Spin', type: 'select', options: [{ value: '', label: 'Neither' }, { value: 'Golden Spin' }, { value: 'Golden and Cavalry Spin' }] },
	{ key: 'enlightenment', label: `Enlightenment (out of ${ENLIGHTENMENT})`, type: 'number', default: 0, min: 0, help: '+2 each time you use Spin riding a healthy horse, once you’re told Cavalry Spin exists.' },
	flag('vampire', 'Vampire'),
	{ key: 'stoneMask', label: 'How you were turned', type: 'text', showIf: { key: 'vampire', in: ['Yes'] } },
	flag('ulf', 'Ultimate Life Form'),
	{ key: 'standEvolution', label: 'Stand Evolution', type: 'select', options: [{ value: '', label: 'None' }, { value: 'Evolved' }, { value: 'Requiem' }, { value: 'ACT' }] },
	{ key: 'standEvolutionNotes', label: 'What it gave your Stand', type: 'textarea', showIf: { key: 'standEvolution', in: ['Evolved', 'Requiem', 'ACT'] } },
	...TRACK_KEYS.map((key): Field => ({ key, label: key, type: 'number', default: 0, min: 0 })),
];
