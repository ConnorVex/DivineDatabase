// Canon Ignitions: what a Fire Force card that claims one can't change, who holds it in canon, and
// how its canon card looks (canon-ignitions.json).
import data from '../../data/portal/canon-ignitions.json' with { type: 'json' };
import type { Fields } from './systems.ts';

export type IgnitionLook = [fx: string, a: string, b: string];
interface Ignition {
	holder?: string;
	theme?: string;
	generation?: string;
	look?: IgnitionLook;
}
type Claim = { name: string; category?: string | null } | undefined;

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_CATEGORY = data.categories as Record<string, Fields>;
const BY_NAME = new Map(Object.entries(data.ignitions as unknown as Record<string, Ignition>).map(([name, v]) => [key(name), v]));
/** Categories that hold one character each (Pillars), with their own section in the claim menu. */
export const ONE_USER_CATEGORIES: readonly string[] = data.oneUser;

export const ignitionInfo = (name: string | undefined): Ignition | undefined => (name ? BY_NAME.get(key(name)) : undefined);

/** The fields a claimed canon Ignition fixes ({} when it fixes nothing): a Pillar's Burst, its theme, a Generation. */
export function canonIgnition(claim: Claim): Fields {
	if (!claim) return {};
	const own = ignitionInfo(claim.name);
	return {
		...(BY_CATEGORY[claim.category ?? ''] ?? {}),
		...(own?.theme ? { theme: own.theme } : {}),
		...(own?.generation ? { generation: own.generation } : {}),
	};
}
