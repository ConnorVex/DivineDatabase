// Canon Quirks have a fixed class and Quirk Factor: a card that claims one can't change them.
import data from '../../data/portal/canon-quirks.json' with { type: 'json' };

export interface CanonQuirk {
	class: 'Emitter' | 'Transformation' | 'Mutation';
	/** Left out when it isn't known: the player fills it in. */
	factor?: string;
	/** New claimables from 20261126100000_more_canon_quirks.sql. */
	added?: string;
	slots?: number;
	blurb?: string;
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const QUIRKS = data.quirks as Record<string, CanonQuirk>;
const BY_KEY = new Map(Object.entries(QUIRKS).map(([name, q]) => [key(name), q]));
// The same Quirk under its other name.
BY_KEY.set(key('Half-Cold Half-Hot'), QUIRKS['Half Hot Half Cold']);

export const canonQuirk = (name: string | undefined) => (name ? BY_KEY.get(key(name)) : undefined);
/** Canon Quirks added after the first claim list, with their blurbs. */
export const ADDED_QUIRKS = Object.entries(QUIRKS).filter(([, q]) => q.added);
