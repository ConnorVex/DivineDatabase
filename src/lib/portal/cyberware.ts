// Cyberware slots and the pieces that fit them (Index: Cyberpunk 2077 › Cyberware; the item list is
// src/data/portal/cyberware.json). A character starts without Cyberware and gets access once approved.
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import cyberwareData from '../../data/portal/cyberware.json' with { type: 'json' };
import type { Fields } from './systems.ts';

export const OTHER_CYBERWARE = 'Other (not on the list)';
export const CYBER_GRADES = rulesData.cyberware.grades as ('Civilian' | 'Military' | 'Modified')[];
export const CYBER_TIERS = rulesData.cyberware.tiers;

/** What each grade offers, from the Index. */
export const GRADE_ABOUT: Record<string, string> = {
	Civilian: 'Every Ripperdoc has it, and it’s cheap. Only the base benefits of its class.',
	Military: 'Few Ripperdocs stock it. Built for combat, with extra perks like faster use or more damage.',
	Modified: 'Can’t be bought: scavenge it or make it. Making your own needs Genius Intelligence.',
};

export interface CyberSlot {
	id: string;
	/** Slots the Index gives everyone. */
	base: number;
	/** Extra slots from the Skill Tree (upgradeable slots only). */
	extra: number;
	upgradeable: boolean;
}

/** One installed piece, as stored in the card's `cyberware` list. */
export interface CyberPiece {
	name: string;
	custom?: string;
	slot: string;
	grade: string;
	tier: string;
}

/** The body, top to bottom, for laying out the slots. */
export const CYBER_REGIONS: { label: string; slots: string[] }[] = [
	{ label: 'Head', slots: ['Frontal Cortex', 'Operating System', 'Ocular', 'Face'] },
	{ label: 'Core', slots: ['Nervous System', 'Circulatory System', 'Skeleton', 'Integumentary System'] },
	{ label: 'Limbs', slots: ['Arms', 'Hands', 'Legs'] },
];

export const SLOT_ICON: Record<string, string> = {
	'Frontal Cortex': '🧠',
	'Operating System': '💾',
	Ocular: '👁️',
	Face: '🎭',
	'Nervous System': '⚡',
	'Circulatory System': '🫀',
	Skeleton: '🦴',
	'Integumentary System': '🛡️',
	Arms: '🦾',
	Hands: '🖐️',
	Legs: '🦿',
};

/** Pieces on the list, by slot. */
export const CATALOG: Record<string, { name: string; source: string }[]> = {};
for (const i of cyberwareData.items) (CATALOG[i.slot] ??= []).push({ name: i.name, source: i.source });

export const pieceName = (p: Pick<CyberPiece, 'name' | 'custom'>) => (p.name === OTHER_CYBERWARE ? p.custom?.trim() || 'Unnamed' : p.name);

export const piecesOf = (f: Fields) => (Array.isArray(f.cyberware) ? (f.cyberware as unknown as CyberPiece[]) : []);

/** Upgradeable slots bought on the Skill Tree, one entry per extra slot. */
export const extraSlotsOf = (f: Fields) => (Array.isArray(f.extraSlots) ? (f.extraSlots as string[]) : []);

export function slotsOf(f: Fields): CyberSlot[] {
	const extras = extraSlotsOf(f);
	return rulesData.cyberware.slots.map((s) => {
		const upgradeable = 'upgradeable' in s && Boolean(s.upgradeable);
		return { id: s.id, base: s.count, extra: upgradeable ? extras.filter((x) => x === s.id).length : 0, upgradeable };
	});
}

export const slotTotal = (s: CyberSlot) => s.base + s.extra;
