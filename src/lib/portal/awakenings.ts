// Quirk Awakenings as a log: each one, how it happened and what it gave (Index: Quirk Evolution).
// The card's `awakenings` count (and `rolledAwakenings`, the ones from Spontaneous Evolution) follow
// the log, so the rules can check each new one.
import type { Field, Fields } from './systems.ts';

export const AWAKENING_GAINS = ['Higher Quirk Power', 'Expanded Quirk rules'] as const;
export const AWAKENING_HOW = ['Event', 'Spontaneous Evolution'] as const;
/** QUP stored for each Awakening from an event. */
export const AWAKENING_QUP = 90;

export interface AwakeningEntry {
	how: (typeof AWAKENING_HOW)[number];
	gain: string;
	/** What it gave: the new Quirk Power, or the expanded rules. */
	detail: string;
	/** For an event: what helped them understand their Quirk. */
	event: string;
	/** When it was logged (YYYY-MM-DD). */
	date: string;
}

export const AWAKENING_LOG_FIELD: Field = {
	key: 'awakeningLog',
	label: 'Awakening log',
	type: 'list',
	columns: [
		{ key: 'how', label: 'How', type: 'select', options: AWAKENING_HOW.map((v) => ({ value: v })) },
		{ key: 'gain', label: 'Gave', type: 'select', options: AWAKENING_GAINS.map((v) => ({ value: v })) },
		{ key: 'detail', label: 'Details', type: 'text' },
		{ key: 'event', label: 'Event', type: 'text' },
		{ key: 'date', label: 'Date', type: 'text' },
	],
};

export const awakeningLog = (f: Fields): AwakeningEntry[] => (Array.isArray(f.awakeningLog) ? (f.awakeningLog as unknown as AwakeningEntry[]) : []);
export const today = () => new Date().toISOString().slice(0, 10);
export const newAwakening = (how: AwakeningEntry['how']): AwakeningEntry => ({ how, gain: '', detail: '', event: '', date: today() });

/** Keeps the counts the rules read in step with the log. */
export function withAwakenings(f: Fields, log: AwakeningEntry[]): Fields {
	return { ...f, awakeningLog: log as unknown as Fields[string], awakenings: log.length, rolledAwakenings: log.filter((e) => e.how === 'Spontaneous Evolution').length };
}

/** Cards from before the log had a count and one text box: each Awakening becomes an entry. */
export function awakeningsFromOld(fields: Fields): Fields {
	if (Array.isArray(fields.awakeningLog)) return fields;
	const count = Math.max(0, Number(fields.awakenings) || 0);
	const rolled = Math.min(count, Math.max(0, Number(fields.rolledAwakenings) || 0));
	const { awakeningGains, ...rest } = fields;
	if (!count) return rest;
	const log = Array.from({ length: count }, (_, i): AwakeningEntry => ({
		how: i >= count - rolled ? 'Spontaneous Evolution' : 'Event',
		gain: '',
		detail: i === 0 ? String(awakeningGains ?? '') : '',
		event: '',
		date: '',
	}));
	return withAwakenings(rest, log);
}
