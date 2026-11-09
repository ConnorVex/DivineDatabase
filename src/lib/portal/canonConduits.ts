// Canon Conduit powers: their class, element, canon user and what they do (canon-conduits.json).
// A card that claims one takes its class and element.
import data from '../../data/portal/canon-conduits.json' with { type: 'json' };
import type { Fields } from './systems.ts';

export interface CanonConduit {
	category: string;
	class: string;
	element?: string;
	user: string;
	blurb: string;
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_KEY = new Map(Object.entries(data.conduits as Record<string, CanonConduit>).map(([name, c]) => [key(name), c]));

export const canonConduit = (name: string | undefined) => (name ? BY_KEY.get(key(name)) : undefined);

/** The fields a claimed canon Conduit fixes: its class, and its element when it has one. */
export function canonConduitFields(name: string | undefined): Fields {
	const c = canonConduit(name);
	return c ? { class: c.class, ...(c.element ? { element: c.element } : {}) } : {};
}
