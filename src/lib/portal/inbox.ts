// The player's inbox: how everything they sent was decided and why, staff actions on their things,
// and to-dos for family owners. Filled by triggers in the database (20261218100000_inbox.sql).
import { supabase } from '../supabase.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};
const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export type InboxKind =
	| 'character' | 'evolution' | 'equipment' | 'family' | 'perks' | 'join' | 'tryout' | 'inheritance'
	| 'sealed_access' | 'mafo' | 'encryption' | 'override' | 'note' | 'removed' | 'roll_lock' | 'grant' | 'points'
	| 'todo_join' | 'todo_tryout' | 'todo_pick';
export type InboxOutcome = 'approved' | 'needs_correction' | 'denied' | 'partial' | 'info' | 'todo';

export interface InboxItem {
	id: number;
	kind: InboxKind;
	outcome: InboxOutcome;
	title: string;
	subtitle: string;
	body: string;
	link: string;
	created_at: string;
	read_at: string | null;
}

/** What each message is about, shown as a small label above its title. */
export const KIND_LABEL: Record<InboxKind, string> = {
	character: 'Character',
	evolution: 'Evolution',
	equipment: 'Equipment',
	family: 'Family',
	perks: 'Family perks',
	join: 'Family membership',
	tryout: 'Tryout',
	inheritance: 'Inheritance roll',
	sealed_access: 'Sealed family',
	mafo: 'M:AFO',
	encryption: 'Encryption',
	override: 'Staff override',
	note: 'Staff note',
	removed: 'Removed',
	roll_lock: 'Rolling',
	grant: 'Granted',
	points: 'Points',
	todo_join: 'Join request',
	todo_tryout: 'Tryout to review',
	todo_pick: 'Character to review',
};

const OUTCOME_LABEL: Record<InboxOutcome, string> = {
	approved: 'Approved',
	needs_correction: 'Needs correction',
	denied: 'Denied',
	partial: 'Partly approved',
	info: '',
	todo: 'To do',
};
const KIND_OUTCOME: Partial<Record<InboxKind, Partial<Record<InboxOutcome, string>>>> = {
	join: { approved: 'Accepted', denied: 'Declined' },
	tryout: { approved: 'Accepted', denied: 'Declined' },
	inheritance: { approved: 'Won', denied: 'Lost' },
	sealed_access: { approved: 'Let in', denied: 'Declined' },
	encryption: { approved: 'Encrypted', denied: 'Declined' },
};
export const OUTCOME_TONE: Record<InboxOutcome, string> = {
	approved: 'good',
	needs_correction: 'warn',
	denied: 'bad',
	partial: 'warn',
	info: 'info',
	todo: 'todo',
};

/** The outcome as the player reads it ("Accepted", "Won"), or '' for a plain notice. */
export function outcomeLabel(item: Pick<InboxItem, 'kind' | 'outcome'>): string {
	return KIND_OUTCOME[item.kind]?.[item.outcome] ?? OUTCOME_LABEL[item.outcome];
}

/** The button text for a message's link. */
export function actionLabel(item: Pick<InboxItem, 'kind' | 'outcome'>): string {
	if (item.outcome === 'needs_correction') return 'Fix and resend';
	if (item.kind === 'todo_pick') return 'Review it';
	if (item.kind === 'todo_join' || item.kind === 'todo_tryout') return 'Open the family';
	return 'Open';
}

export const PAGE_SIZE = 50;

/** One page of the player's messages, newest first. */
export async function loadInbox(offset = 0): Promise<InboxItem[]> {
	const { data, error } = await db()
		.from('inbox')
		.select('id, kind, outcome, title, subtitle, body, link, created_at, read_at')
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.range(offset, offset + PAGE_SIZE - 1);
	fail(error);
	return (data ?? []) as InboxItem[];
}

export async function unreadCount(): Promise<number> {
	const { data, error } = await db().rpc('inbox_unread_count');
	fail(error);
	return Number(data ?? 0);
}

/** Marks everything read and tells the top bar to clear its badge. */
export async function markAllRead(): Promise<void> {
	fail((await db().rpc('inbox_mark_read')).error);
	window.dispatchEvent(new CustomEvent('dd-inbox-count', { detail: 0 }));
}
