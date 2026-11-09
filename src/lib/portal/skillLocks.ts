// Starting skills vs. skills still to learn. A new character starts with the skills its system
// grants (e.g. 3 Standard, 2 Ultimate for a Quirk); anything more from the custom skill tree is
// locked, and unlocked later with points on the Evolve page (which adds it to the evolution log).
import type { SystemEntry } from './sheet.ts';
import type { MoveLimits } from './systems.ts';

/** How many of a skill type a card can start with (no limit when the system sets none). */
export function startingMax(type: 'standard' | 'ultimate', limits: MoveLimits | undefined): number {
	const max = limits?.[type] ?? Infinity;
	return type === 'ultimate' ? Math.min(max, limits?.ultimateCap ?? Infinity) : max;
}

/**
 * Marks which skills a new character starts with (in order, up to the starting limits) and locks the
 * rest; tree nodes for starting skills are marked known so they're owned once approved. After
 * approval the locks are left alone: they only open by unlocking on the tree.
 */
export function lockPastStart(entry: SystemEntry, limits: MoveLimits | undefined, isEvolution: boolean) {
	if (isEvolution) return;
	const used = { standard: 0, ultimate: 0 };
	for (const skill of entry.skills) {
		if (skill.type === 'passive') {
			delete skill.locked;
			continue;
		}
		if (used[skill.type] < startingMax(skill.type, limits)) {
			used[skill.type]++;
			delete skill.locked;
		} else skill.locked = true;
	}
	for (const node of entry.customTree?.nodes ?? []) {
		if (node.start) continue;
		const skill = entry.skills.find((s) => s.treeNodeId === node.id);
		if (skill && !skill.locked) node.known = true;
		else delete node.known;
	}
}

/** Skills the character can use now. */
export const usableSkills = (entry: Pick<SystemEntry, 'skills'>) => entry.skills.filter((s) => !s.locked);
