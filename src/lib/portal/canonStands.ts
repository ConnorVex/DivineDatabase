// Canon Stands (Parts 3 to 7): who holds them in canon, their stats, what they are and their
// Esoteric Ability (canon-stands.json). A card that claims one takes its canon stats.
import data from '../../data/portal/canon-stands.json' with { type: 'json' };
import type { Fields } from './systems.ts';

export interface CanonStand {
	part: string;
	user?: string;
	/** Destructive Power, Speed, Range, Durability, Precision, Developmental Potential (∅ none, ? unknown). */
	stats: string[];
	about: string;
	ability: string;
}

/** The card fields a canon Stand's stats fill, in order. */
export const STAND_STAT_KEYS = ['standDestructivePower', 'standSpeed', 'standRange', 'standDurability', 'standPrecision', 'standDevelopmentalPotential'];
export const STAND_STAT_LABELS = ['Power', 'Speed', 'Range', 'Durability', 'Precision', 'Potential'];
/** Shorter labels for narrow screens. */
export const STAND_STAT_SHORT = ['PWR', 'SPD', 'RNG', 'DUR', 'PRC', 'POT'];

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const STANDS = data.stands as Record<string, CanonStand>;
const BY_KEY = new Map(Object.entries(STANDS).map(([name, s]) => [key(name), s]));
for (const [alias, name] of Object.entries(data.aliases as Record<string, string>)) if (STANDS[name]) BY_KEY.set(key(alias), STANDS[name]);

export const canonStand = (name: string | undefined) => (name ? BY_KEY.get(key(name)) : undefined);

/** The canon stats a claimed Stand fixes on its card ({} when it isn't a listed canon Stand). */
export function canonStandFields(name: string | undefined): Fields {
	const s = canonStand(name);
	if (!s) return {};
	return Object.fromEntries(STAND_STAT_KEYS.map((k, i) => [k, s.stats[i] === '∅' ? 'None' : s.stats[i]]));
}
