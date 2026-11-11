// The rule checks for a whole character, shared by the form and the evolution page.
import type { CharacterDraft, ClaimRow, Combo } from './api.ts';
import type { LinkablePerk } from './families.ts';
import type { BoardPerk } from '../families/api.ts';
import { inheritanceEffects, inheritanceIssues, inheritedOptions, inheritedPerks, type InheritanceRoll } from './inheritance.ts';
import { applyApproved, applyIgnored, checkSheet, type Issue } from './rules.ts';
import { systemById } from './systems.ts';
import type { MyPowerGrant } from './powerCards.ts';

export interface CheckData {
	board: ClaimRow[];
	/** Claims this character already holds. */
	held: Set<string>;
	combos: Combo[];
	/** Families the character is in, asking to join, or picked in the form. */
	familyIds: string[];
	/** Ability and trait perks of those families, for checking linked cards. */
	familyPerks?: LinkablePerk[];
	/** The Heavenly Restriction granted for this character (null: none; undefined: not known). */
	heavenlyGrant?: string | null;
	/** For a character made in a family's Inheritance: the family's perks and the owner's rolls. */
	inheritance?: { familyName: string; perks: BoardPerk[]; rolls: InheritanceRoll[] } | null;
	/** The owner's granted powers, for checking granted cards (undefined: not known). */
	powerGrants?: MyPowerGrant[];
}

/** Canon picks only count for systems the character still has. */
export function effectiveClaims(d: CharacterDraft, board: ClaimRow[]): string[] {
	const universesInUse = new Set(d.sheet.systems.map((e) => systemById.get(e.system)?.universe).filter(Boolean));
	return d.requestedClaims.filter((id) => universesInUse.has(board.find((r) => r.id === id)?.universe));
}

export function characterIssues(draft: CharacterDraft, data: CheckData): Issue[] {
	const { board, held, combos } = data;
	const inh = draft.sheet.inheritance && data.inheritance && !draft.approvedAt ? data.inheritance : null;
	const got = inh ? inheritedPerks(inh.perks, draft.sheet.inheritance!, inh.rolls) : [];
	const effects = inheritanceEffects(got);
	const familyIssues = inh ? inheritanceIssues(draft.sheet, got, inheritedOptions(got, draft.sheet.inheritance!, inh.rolls), inh.familyName) : [];
	const claims = new Map(board.map((r) => [r.id, { name: r.name, usedSlots: r.used_slots, maxUsers: r.max_users, category: r.category, universe: r.universe, claimType: r.claim_type }]));
	const list = applyApproved(checkSheet(draft.sheet, {
		kind: draft.kind,
		name: draft.name,
		canonUniverse: draft.canonUniverse,
		isEvolution: Boolean(draft.approvedAt),
		extraTraitSlots: (draft.extraTraitSlots ?? 0) + effects.extraTraitSlots,
		bonusPtp: (draft.bonusPtp ?? 0) + effects.bonusPtp,
		inheritedPerks: new Set(got.map((p) => p.id)),
		approvedSheet: draft.approvedSheet,
		claims,
		heldClaimIds: held,
		requestedClaims: effectiveClaims(draft, board),
		comboSystemLimits: combos.map((c) => c.system_limits ?? {}),
		combos: combos.map((c) => c.name),
		families: [...draft.sheet.families, ...data.familyIds],
		familyPerks: data.familyPerks && new Map(data.familyPerks.map((p) => [p.id, p])),
		heavenlyGrant: data.heavenlyGrant,
		powerGrants: data.powerGrants,
		characterId: draft.id,
		staffOverrides: { ...effects.overrides, ...draft.staffOverrides },
		progressed: draft.progressed,
		adminCharacter: draft.adminCharacter,
		encryptionRequest: draft.encryptionRequested && !draft.encrypted && !draft.adminCharacter ? { reason: draft.encryptionReason } : null,
	}).concat(familyIssues), draft.approvedPermissions);
	if (draft.kind === 'canon' && draft.canonUniverse && draft.name.trim()) {
		const taken = board.find((r) => r.claim_type === 'character' && r.universe === draft.canonUniverse && r.name.toLowerCase() === draft.name.trim().toLowerCase());
		if (taken && !held.has(taken.id) && taken.max_users !== null && taken.used_slots >= taken.max_users) {
			list.unshift({ level: 'error', section: 'Basics', message: `${taken.name} is already claimed.` });
		}
	}
	return applyIgnored(list, draft.ignoredChecks);
}
