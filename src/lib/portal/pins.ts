// Pinned review notes: a reviewer pins a note to one part of the form (a step, a stat or a power
// system card), and the player sees it as a red box right there.
import { systemById } from './systems.ts';
import type { Sheet } from './sheet.ts';

export interface PinnedNote {
	id: string;
	/** The form step it belongs to. */
	step: string;
	/** Optional: a stat key (strength, phase, …) or card:<card key>. */
	target?: string;
	text: string;
	by?: string;
	at?: string;
}

export const PIN_STEPS: { id: string; label: string; ocOnly?: boolean }[] = [
	{ id: 'basics', label: 'Basics' },
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'lore', label: 'Lore' },
	{ id: 'stats', label: 'Stats', ocOnly: true },
	{ id: 'traits', label: 'Traits', ocOnly: true },
	{ id: 'combat', label: 'Combat', ocOnly: true },
	{ id: 'systems', label: 'Systems', ocOnly: true },
	{ id: 'storage', label: 'Storage', ocOnly: true },
	{ id: 'families', label: 'Families' },
];

const STAT_TARGETS: [string, string][] = [
	['strength', 'Strength'],
	['speed', 'Speed'],
	['defense', 'Defense'],
	['stamina', 'Stamina'],
	['intelligence', 'Intelligence'],
	['phase', 'Phase'],
	['potential', 'Potential'],
	['ptp', 'PTP'],
];

/** What a note on a step can point at more precisely. */
export function pinTargets(step: string, sheet: Sheet): { value: string; label: string }[] {
	if (step === 'stats') return STAT_TARGETS.map(([value, label]) => ({ value, label }));
	if (step === 'systems')
		return sheet.systems.map((e) => ({ value: `card:${e.key}`, label: `${systemById.get(e.system)?.label ?? 'Removed system'} card` }));
	return [];
}

export function pinLabel(note: Pick<PinnedNote, 'step' | 'target'>, sheet: Sheet) {
	const step = PIN_STEPS.find((s) => s.id === note.step)?.label ?? note.step;
	const target = note.target ? pinTargets(note.step, sheet).find((t) => t.value === note.target)?.label : '';
	return target ? `${step} · ${target}` : step;
}

/** Cleans what comes from the database: drops anything that isn't a note. */
export function normalizePins(raw: unknown): PinnedNote[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((n): n is PinnedNote => !!n && typeof n === 'object' && typeof n.id === 'string' && typeof n.step === 'string' && typeof n.text === 'string')
		.map((n) => ({ id: n.id, step: n.step, target: typeof n.target === 'string' && n.target ? n.target : undefined, text: n.text, by: n.by, at: n.at }));
}

export const pinsFor = (notes: PinnedNote[], step: string, target?: string) =>
	notes.filter((n) => n.step === step && (target === undefined ? true : n.target === target));

/** Which step a rule check's section belongs to (Issue.section → step id). */
export const STEP_OF_SECTION: Record<string, string> = {
	Basics: 'basics',
	Appearance: 'appearance',
	Lore: 'lore',
	Tryout: 'lore',
	Stats: 'stats',
	Traits: 'traits',
	Combat: 'combat',
	Systems: 'systems',
	Storage: 'storage',
	Families: 'families',
};

export const newPinId = () => Math.random().toString(36).slice(2, 10);
