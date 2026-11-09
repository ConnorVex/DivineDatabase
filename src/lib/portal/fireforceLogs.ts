// Fire Force as it grows after approval: who taught each technique, the Adolla Links a Stigma holder
// peers into (1d10, 5+, 2 tries per Link), and Tephrosis moving through its stages over real-life
// days until RPs are tracked (Index: Pyrokinetic Techniques, Adolla, Tephrosis).
import { RP_MS, type EvolutionRoll } from './evolutionRolls.ts';
import { TECHNIQUES, TEPHROSIS } from './fireforce.ts';
import type { Field, Fields, FieldValue } from './systems.ts';

export const today = () => new Date().toISOString().slice(0, 10);
const rows = (f: Fields, key: string) => (Array.isArray(f[key]) ? (f[key] as Record<string, string>[]) : []);

// ── Techniques ──
/** Techniques with a teacher (Crimson Techniques keep their own list, learned from each inventor). */
export const TAUGHT = TECHNIQUES.filter((t) => t !== 'Crimson Technique');
export interface TechniqueEntry {
	technique: string;
	teacher: string;
	date: string;
}
export const techniqueLog = (f: Fields) => rows(f, 'techniqueLog') as unknown as TechniqueEntry[];
/** The log decides which techniques the card has (Crimson ones come from their list). */
export function withTechniques(f: Fields, log: TechniqueEntry[]): Fields {
	const taught = TECHNIQUES.filter((t) => (t === 'Crimson Technique' ? rows(f, 'crimson').length > 0 : log.some((e) => e.technique === t)));
	return { ...f, techniqueLog: log as unknown as FieldValue, techniques: taught };
}
/** Old cards: a list of techniques and one "who taught you" box. */
export function techniquesFromOld(fields: Fields): Fields {
	if (Array.isArray(fields.techniqueLog)) return fields;
	const { techniqueTeachers, ...rest } = fields;
	const old = Array.isArray(fields.techniques) ? (fields.techniques as string[]) : [];
	const log = old.filter((t) => (TAUGHT as readonly string[]).includes(t)).map((technique) => ({ technique, teacher: String(techniqueTeachers ?? ''), date: '' }));
	return withTechniques(rest, log);
}

// ── Adolla Links ──
export const PEEK_TRIES = 2;
export interface LinkEntry {
	date: string;
	/** Who the Link connected you with. */
	who: string;
	/** What it showed: their emotions, intent, something that happened. */
	revealed: string;
	/** The ids of this Link's peek rolls, comma separated. */
	peeks: string;
}
export const linkLog = (f: Fields) => rows(f, 'adollaLinks') as unknown as LinkEntry[];
export const peekIds = (e: LinkEntry) => String(e.peeks ?? '').split(',').filter(Boolean).map(Number);
export const newLink = (): LinkEntry => ({ date: today(), who: '', revealed: '', peeks: '' });
/**
 * Until RPs are tracked, a Link is one RP: a card peeks at most twice in a day (same as roll_evolution),
 * so the cooldown ends a day after the earlier of its last 2 peeks.
 */
export function peekCooldown(rolls: EvolutionRoll[], now = Date.now(), rpMs = RP_MS) {
	const recent = rolls.filter((r) => r.kind === 'adolla_peek' && now - Date.parse(r.created_at) < rpMs).sort((a, b) => a.id - b.id);
	return recent.length >= PEEK_TRIES ? Date.parse(recent[recent.length - PEEK_TRIES].created_at) + rpMs : null;
}

// ── Tephrosis ──
/** How long each stage lasts, in RPs (End Stage lasts until death). */
export const TEPHROSIS_RPS = [2, 5];
/** The stage the time since it started has reached (0 Initial Overheat, 1 Charring, 2 End Stage). */
export function tephrosisStage(since: string | undefined, now = Date.now(), rpMs = RP_MS) {
	if (!since) return null;
	const rps = Math.max(0, (now - Date.parse(since)) / rpMs);
	const stage = rps < TEPHROSIS_RPS[0] ? 0 : rps < TEPHROSIS_RPS[0] + TEPHROSIS_RPS[1] ? 1 : 2;
	const nextAt = stage < 2 ? Date.parse(since) + TEPHROSIS_RPS.slice(0, stage + 1).reduce((n, r) => n + r, 0) * rpMs : null;
	return { stage, id: TEPHROSIS[stage].id, rps: Math.floor(rps), nextAt };
}

export const FIRE_FORCE_LOG_FIELDS: Field[] = [
	{
		key: 'techniqueLog',
		label: 'Techniques taught',
		type: 'list',
		columns: [
			{ key: 'technique', label: 'Technique', type: 'select', options: TAUGHT.map((value) => ({ value })) },
			{ key: 'teacher', label: 'Taught by', type: 'text' },
			{ key: 'date', label: 'Date', type: 'text' },
		],
	},
	{
		key: 'adollaLinks',
		label: 'Adolla Links',
		type: 'list',
		columns: [
			{ key: 'date', label: 'Date', type: 'text' },
			{ key: 'who', label: 'With', type: 'text' },
			{ key: 'revealed', label: 'What it showed', type: 'text' },
			{ key: 'peeks', label: 'Peek rolls', type: 'text' },
		],
	},
	{ key: 'tephrosisSince', label: 'Tephrosis started', type: 'text', help: 'When your oxygen went into the negatives.' },
];
