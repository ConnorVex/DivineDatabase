// Override Mode's save: an admin's changes are laid over the character as it is when they save, so
// whatever the player changed meanwhile (or their unsent evolution changes) is kept where staff
// didn't touch it. No database calls, so tests can use it.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const keyed = (v: unknown): v is { key: string }[] => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.key === 'string' && x.key !== '');

/**
 * Three-way merge: `base` is what staff started from, `mine` what they made of it, `theirs` the
 * value now. Where staff changed nothing, theirs is kept; where only staff changed it, staff's
 * wins; where both changed an object, it merges key by key (cards by their key), and staff win
 * any clash.
 */
export function mergeOverride<T>(base: T, mine: T, theirs: T): T {
	if (same(mine, base)) return theirs;
	if (same(theirs, base) || same(theirs, mine)) return mine;
	if (isObject(base) && isObject(mine) && isObject(theirs)) {
		const out: Record<string, unknown> = {};
		for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
			const merged = mergeOverride(base[k], mine[k], theirs[k]);
			if (merged !== undefined) out[k] = merged;
		}
		return out as T;
	}
	if (keyed(base) && keyed(mine) && keyed(theirs)) {
		const find = (list: { key: string }[], key: string) => list.find((x) => x.key === key);
		const out: unknown[] = [];
		// Staff's order and cards first, merged with theirs; a card staff removed stays removed.
		for (const m of mine) {
			const b = find(base, m.key);
			const t = find(theirs, m.key);
			if (!b) out.push(m);
			else if (t) out.push(mergeOverride(b, m, t));
			else if (!same(b, m)) out.push(m);
		}
		// Cards the player added meanwhile.
		for (const t of theirs) if (!find(base, t.key) && !find(mine, t.key)) out.push(t);
		return out as T;
	}
	return mine;
}
