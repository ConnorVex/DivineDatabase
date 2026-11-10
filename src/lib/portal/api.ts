// Database calls used by the portal pages. Row-level security decides what each one may see.
import { supabase } from '../supabase.ts';
import type { Balance, Conversion, Currency, LedgerRow, SkillNode, SkillTree, Unlock } from './points.ts';
import { normalizeSheet, type Sheet } from './sheet.ts';
import { normalizePins, type PinnedNote } from './pins.ts';
import type { StaffOverrides } from './rules.ts';
import type { EvolutionRoll, EvolutionRollKind } from './evolutionRolls.ts';

export type Status = 'draft' | 'pending' | 'approved' | 'needs_correction' | 'denied';

export interface CharacterDraft {
	id: string | null;
	kind: 'oc' | 'canon';
	name: string;
	canonUniverse: string | null;
	sheet: Sheet;
	requestedClaims: string[];
	status: Status | null;
	approvedAt: string | null;
	approvedSheet: Sheet | null;
	extraTraitSlots: number;
	bonusPtp: number;
	/** Values staff set (players can't change them). */
	staffOverrides: StaffOverrides;
	/** Staff marked it as already progressed: no starting limits. */
	progressed: boolean;
	/** Notes reviewers pinned to parts of the form. */
	pinnedNotes: PinnedNote[];
	/** An admin's own character: no rule checks, approved as soon as it's sent. */
	adminCharacter: boolean;
	/** 🔑 items an admin approved; they show as approved from then on. */
	approvedPermissions: string[];
	/** The owner asks staff to encrypt it, and why. */
	encryptionRequested: boolean;
	encryptionReason: string;
	/** Staff approved it: only the owner, admins and listed viewers can see it. */
	encrypted: boolean;
}

export interface Universe {
	slug: string;
	name: string;
	ability_label: string | null;
}

export interface ClaimRow {
	id: string;
	universe: string;
	claim_type: 'character' | 'ability' | 'ocular';
	category: string;
	name: string;
	max_users: number | null;
	used_slots: number;
	note: string;
}

export interface Combo {
	name: string;
	requires: string[][];
	perks: string;
	/** Power systems this combination lets the character have more of, e.g. { system: 3 }. */
	system_limits?: Record<string, number>;
}

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}

const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export const newDraft = (): CharacterDraft => ({
	id: null,
	kind: 'oc',
	name: '',
	canonUniverse: null,
	sheet: normalizeSheet({}),
	requestedClaims: [],
	status: null,
	approvedAt: null,
	approvedSheet: null,
	extraTraitSlots: 0,
	bonusPtp: 0,
	staffOverrides: {},
	progressed: false,
	pinnedNotes: [],
	adminCharacter: false,
	approvedPermissions: [],
	encryptionRequested: false,
	encryptionReason: '',
	encrypted: false,
});

export async function loadCharacter(id: string): Promise<CharacterDraft> {
	const { data, error } = await db().from('characters').select('*').eq('id', id).maybeSingle();
	fail(error);
	if (!data) throw new Error('Character not found, or it isn’t yours.');
	return {
		id: data.id,
		kind: data.kind,
		name: data.name,
		canonUniverse: data.canon_universe,
		sheet: normalizeSheet(data.sheet),
		requestedClaims: data.requested_claims ?? [],
		status: data.status,
		approvedAt: data.approved_at,
		approvedSheet: data.approved_sheet ? normalizeSheet(data.approved_sheet) : null,
		extraTraitSlots: data.extra_trait_slots ?? 0,
		bonusPtp: data.bonus_ptp ?? 0,
		staffOverrides: data.staff_overrides ?? {},
		progressed: data.progressed ?? false,
		pinnedNotes: normalizePins(data.pinned_notes),
		adminCharacter: data.admin_character ?? false,
		approvedPermissions: data.approved_permissions ?? [],
		encryptionRequested: data.encryption_requested ?? false,
		encryptionReason: data.encryption_reason ?? '',
		encrypted: data.encrypted ?? false,
	};
}

/** Saves the character. `status` defaults to keeping 'pending', otherwise 'draft'. */
export async function saveCharacter(c: CharacterDraft, status?: 'draft' | 'pending'): Promise<{ id: string; status: Status }> {
	const row = {
		kind: c.kind,
		name: c.name.trim(),
		canon_universe: c.kind === 'canon' ? c.canonUniverse : null,
		sheet: c.sheet,
		requested_claims: c.requestedClaims,
		status: status ?? (c.status === 'pending' ? 'pending' : 'draft'),
		// Only admins can set it; the database ignores it for everyone else.
		...(c.adminCharacter ? { admin_character: true } : {}),
		encryption_requested: c.encryptionRequested && !c.encrypted,
		encryption_reason: c.encryptionRequested ? c.encryptionReason.trim().slice(0, 1000) : '',
	};
	const query = c.id ? db().from('characters').update(row).eq('id', c.id) : db().from('characters').insert(row);
	const { data, error } = await query.select('id, status').single();
	fail(error);
	return data as { id: string; status: Status };
}

export async function discoverCombos(characterId: string): Promise<Combo[]> {
	const { data, error } = await db().rpc('discover_combos', { p_character_id: characterId });
	fail(error);
	return (data ?? []) as Combo[];
}

export async function loadUniverses(): Promise<Universe[]> {
	const { data, error } = await db().from('universes').select('slug, name, ability_label').order('sort_order');
	fail(error);
	return data ?? [];
}

export async function loadClaimBoard(): Promise<ClaimRow[]> {
	const { data, error } = await db().from('claim_board').select('*').order('sort_order');
	fail(error);
	return data ?? [];
}

/** Claimables this character already holds. */
export async function loadHeldClaims(characterId: string): Promise<Set<string>> {
	const { data, error } = await db().from('claims').select('claimable_id').eq('character_id', characterId);
	fail(error);
	return new Set((data ?? []).map((r) => r.claimable_id));
}

// ───────────────────────────── Claims (admin) ─────────────────────────────

/** A claimable as the admin Claims tab edits it: the raw row, not the claim board's totals. */
export interface Claimable {
	id: string;
	universe: string;
	claim_type: ClaimRow['claim_type'];
	category: string;
	name: string;
	max_users: number | null;
	/** Holders tracked by hand, e.g. everyone who claimed before the Divine Database. */
	manual_users: number;
	note: string;
	sort_order: number;
}

/** One character holding a claimable, added when the character is approved. */
export interface ClaimHolder {
	id: string;
	claimable_id: string;
	character_id: string | null;
	holder_name: string;
	counts_toward_limit: boolean;
}

export async function loadClaimAdmin(): Promise<{ claimables: Claimable[]; holders: ClaimHolder[] }> {
	const [k, h] = await Promise.all([
		db().from('claimables').select('id, universe, claim_type, category, name, max_users, manual_users, note, sort_order').order('sort_order'),
		db().from('claims').select('id, claimable_id, character_id, holder_name, counts_toward_limit').order('created_at'),
	]);
	fail(k.error);
	fail(h.error);
	return { claimables: k.data ?? [], holders: h.data ?? [] };
}

/** Adds (no id) or updates a claimable (admins only). */
export async function adminSaveClaimable(c: Omit<Claimable, 'id'> & { id?: string }): Promise<Claimable> {
	const row = {
		universe: c.universe,
		claim_type: c.claim_type,
		category: c.category.trim(),
		name: c.name.trim(),
		max_users: c.max_users,
		manual_users: Math.max(0, Math.floor(c.manual_users)),
		note: c.note.trim(),
		sort_order: Math.floor(c.sort_order),
	};
	const q = c.id ? db().from('claimables').update(row).eq('id', c.id) : db().from('claimables').insert(row);
	const { data, error } = await q.select('id, universe, claim_type, category, name, max_users, manual_users, note, sort_order').single();
	if (error?.code === '23505') throw new Error(`There’s already a claim called “${row.name}” here.`);
	fail(error);
	return data as Claimable;
}

/** Removes a claimable and everyone holding it (admins only). */
export async function adminDeleteClaimable(id: string) {
	const { error } = await db().from('claimables').delete().eq('id', id);
	fail(error);
}

/** Whether a holder takes up a slot (admins only). */
export async function adminSetHolderCounts(id: string, counts: boolean) {
	const { error } = await db().from('claims').update({ counts_toward_limit: counts }).eq('id', id);
	fail(error);
}

/** An approved character staff can give a claim to. */
export interface ClaimCharacter {
	id: string;
	name: string;
	player: string;
}

export async function loadClaimCharacters(): Promise<ClaimCharacter[]> {
	const { data, error } = await db()
		.from('characters')
		.select('id, approved_name, owner:profiles!characters_owner_id_fkey(display_name)')
		.not('approved_at', 'is', null)
		.neq('status', 'denied')
		.order('approved_name');
	fail(error);
	return (data ?? []).map((r: any) => ({ id: r.id, name: r.approved_name ?? 'Unnamed', player: (Array.isArray(r.owner) ? r.owner[0] : r.owner)?.display_name ?? '' }));
}

/** Staff mark a spot as claimed by a character (admins only). It counts toward the limit. */
export async function adminGiveClaim(claimableId: string, c: ClaimCharacter) {
	const { error } = await db()
		.from('claims')
		.insert({ claimable_id: claimableId, character_id: c.id, holder_name: c.player ? `${c.name} (${c.player})` : c.name });
	if (error?.code === '23505') throw new Error(`${c.name} already holds this.`);
	fail(error);
}

/** Frees a holder's slot (admins only). The character's sheet isn't changed. */
export async function adminRemoveHolder(id: string) {
	const { error } = await db().from('claims').delete().eq('id', id);
	fail(error);
}

// ───────────────────────────── Rolls ─────────────────────────────

export type RollKind = 'potential' | 'cursed_energy';

export interface RollResult {
	roll?: number | null;
	grade?: string;
	classRoll?: number | null;
	class?: string;
	amountRoll?: number;
	level?: string;
	cep?: number;
	/** The character already had this roll. */
	existing?: boolean;
	/** An unsettled roll moved over from a deleted or denied character. */
	carried?: boolean;
}

export interface RollRow {
	id: string;
	kind: RollKind;
	result: RollResult;
	status: 'active' | 'consumed' | 'void';
	character_id: string | null;
	created_at: string;
}

export interface PendingOverride {
	roll_id: string;
	kind: RollKind;
	character_id: string | null;
	expires_at: string;
}

export interface MyRolls {
	/** Unsettled rolls, with the character each is tied to (if it still exists and isn't denied). */
	active: Partial<Record<RollKind, { row: RollRow; heldBy: { id: string; name: string } | null }>>;
	lock: { reason: string } | null;
	/** Rolls an admin has made an override code for (the code itself stays with the admin). */
	pending: PendingOverride[];
}

/** Rolls through the 'roll' Edge Function, which checks Singularity membership first. */
export async function rollFor(kind: RollKind, characterId: string): Promise<RollResult> {
	const { data, error } = await db().functions.invoke('roll', { body: { kind, characterId } });
	if (error) {
		let message = error.message;
		try {
			const body = await (error as { context?: Response }).context?.json();
			if (body?.error) message = body.error;
		} catch {
			// keep the generic message
		}
		throw new Error(message);
	}
	return (data as { roll: RollResult }).roll;
}

export async function loadMyRolls(): Promise<MyRolls> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id ?? '';
	const [rolls, lock, chars, pending] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('owner_id', uid).eq('status', 'active'),
		db().from('roll_locks').select('reason').eq('owner_id', uid).maybeSingle(),
		db().from('characters').select('id, name, status').eq('owner_id', uid),
		db().rpc('my_pending_overrides'),
	]);
	fail(rolls.error);
	fail(lock.error);
	fail(chars.error);
	const active: MyRolls['active'] = {};
	for (const row of (rolls.data ?? []) as RollRow[]) {
		const c = (chars.data ?? []).find((x) => x.id === row.character_id && x.status !== 'denied');
		active[row.kind] = { row, heldBy: c ? { id: c.id, name: c.name } : null };
	}
	return { active, lock: lock.data, pending: pending.error ? [] : ((pending.data ?? []) as PendingOverride[]) };
}

/** This character's own rolls (any not thrown away), newest first per kind. They stick to the
 * character even when the card that shows them is removed and added again. */
export async function loadCharacterRolls(characterId: string): Promise<Partial<Record<RollKind, RollResult>>> {
	const { data, error } = await db()
		.from('player_rolls')
		.select('kind, result, created_at')
		.eq('character_id', characterId)
		.neq('status', 'void')
		.order('created_at', { ascending: false });
	fail(error);
	const out: Partial<Record<RollKind, RollResult>> = {};
	for (const r of data ?? []) out[r.kind as RollKind] ??= r.result as RollResult;
	return out;
}

/** Uses an override code; with rollId, the code must be the one made for that roll. */
export async function redeemOverride(code: string, rollId?: string): Promise<{ ok: boolean; message: string }> {
	const { data, error } = await db().rpc('redeem_roll_override', { p_code: code, p_roll: rollId ?? null });
	fail(error);
	return data as { ok: boolean; message: string };
}

// ───────────────────────────── Admin: rolls ─────────────────────────────

export interface PlayerSummary {
	id: string;
	discord_id: string;
	display_name: string;
	avatar_url: string | null;
}

export interface ActiveCode {
	id: string;
	roll_id: string | null;
	kind: RollKind | null;
	character_id: string | null;
	code_plain: string | null;
	expires_at: string;
}

export interface PlayerRollInfo {
	rolls: RollRow[];
	lock: { reason: string; locked_at: string } | null;
	events: { id: number; action: string; detail: Record<string, unknown>; created_at: string; actor_id: string | null }[];
	characters: { id: string; name: string; status: Status; kind: 'oc' | 'canon'; systems: { system: string }[] | null }[];
	codes: ActiveCode[];
}

export async function listPlayers(): Promise<PlayerSummary[]> {
	const { data, error } = await db().from('profiles').select('id, discord_id, display_name, avatar_url').order('display_name');
	fail(error);
	return data ?? [];
}

export async function loadPlayerRolls(ownerId: string): Promise<PlayerRollInfo> {
	const [rolls, lock, events, characters, codes] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('owner_id', ownerId).order('created_at', { ascending: false }),
		db().from('roll_locks').select('reason, locked_at').eq('owner_id', ownerId).maybeSingle(),
		db().from('roll_events').select('id, action, detail, created_at, actor_id').eq('owner_id', ownerId).order('id', { ascending: false }).limit(40),
		db().from('characters').select('id, name, status, kind, systems:sheet->systems').eq('owner_id', ownerId).order('created_at', { ascending: false }),
		db()
			.from('roll_override_codes')
			.select('id, roll_id, kind, character_id, code_plain, expires_at')
			.eq('owner_id', ownerId)
			.is('used_at', null)
			.is('cancelled_at', null)
			.gt('expires_at', new Date().toISOString()),
	]);
	for (const r of [rolls, lock, events, characters, codes]) fail(r.error);
	return {
		rolls: (rolls.data ?? []) as RollRow[],
		lock: lock.data,
		events: (events.data ?? []) as PlayerRollInfo['events'],
		characters: (characters.data ?? []) as PlayerRollInfo['characters'],
		codes: (codes.data ?? []) as ActiveCode[],
	};
}

export async function createOverrideCode(ownerId: string, hours: number): Promise<{ code: string; expires: string }> {
	const { data, error } = await db().rpc('create_roll_override', { p_owner: ownerId, p_hours: hours });
	fail(error);
	return data as { code: string; expires: string };
}

/** A single-use code that lets the player re-roll this one roll. */
export async function createOverrideFor(rollId: string, hours: number): Promise<{ id: string; code: string; expires: string }> {
	const { data, error } = await db().rpc('create_roll_override_for', { p_roll: rollId, p_hours: hours });
	fail(error);
	return data as { id: string; code: string; expires: string };
}

export async function cancelOverride(codeId: string) {
	const { error } = await db().rpc('cancel_roll_override', { p_code_id: codeId });
	fail(error);
}

export async function setRollLock(ownerId: string, locked: boolean, reason: string) {
	const { error } = await db().rpc('set_roll_lock', { p_owner: ownerId, p_locked: locked, p_reason: reason });
	fail(error);
}

export async function adminSetRoll(ownerId: string, kind: RollKind, value: string, characterId: string | null) {
	const { error } = await db().rpc('admin_set_roll', { p_owner: ownerId, p_kind: kind, p_value: value, p_character: characterId });
	fail(error);
}

export async function adminVoidRoll(ownerId: string, kind: RollKind) {
	const { error } = await db().rpc('admin_void_roll', { p_owner: ownerId, p_kind: kind });
	fail(error);
}

// ───────────────────────────── My Characters ─────────────────────────────

export interface CharacterSummary {
	id: string;
	name: string;
	kind: 'oc' | 'canon';
	canon_universe: string | null;
	status: Status;
	approved_at: string | null;
	submitted_at: string | null;
	updated_at: string;
	created_at: string;
	image: string | null;
	encrypted: boolean;
	role: string | null;
	potential: string | null;
	admin_character: boolean;
}

export interface ReviewNote {
	id: string;
	character_id: string;
	outcome: 'approved' | 'needs_correction' | 'denied' | null;
	body: string;
	created_at: string;
}

/** The logged-in player's own characters, newest activity first. (Admins can read everyone's,
 * so this filters to the player explicitly.) */
export async function loadMyCharacters(): Promise<CharacterSummary[]> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) return [];
	const { data, error } = await db()
		.from('characters')
		.select(
			'id, name, kind, canon_universe, status, encrypted, admin_character, approved_at, submitted_at, updated_at, created_at, image:sheet->appearance->>image, role:sheet->>role, potential:sheet->potential->>grade',
		)
		.eq('owner_id', uid)
		.order('updated_at', { ascending: false });
	fail(error);
	return (data ?? []) as CharacterSummary[];
}

export async function loadReviewNotes(characterIds: string[]): Promise<ReviewNote[]> {
	if (characterIds.length === 0) return [];
	const { data, error } = await db()
		.from('review_notes')
		.select('id, character_id, outcome, body, created_at')
		.in('character_id', characterIds)
		.order('created_at', { ascending: false });
	fail(error);
	return (data ?? []) as ReviewNote[];
}

export async function deleteCharacter(id: string) {
	const { data, error } = await db().from('characters').delete().eq('id', id).select('id');
	fail(error);
	if (!data?.length) throw new Error('This character can’t be deleted.');
}

// ───────────────────────────── Admin: review ─────────────────────────────

export interface AdminCharacter {
	id: string;
	owner_id: string;
	name: string;
	kind: 'oc' | 'canon';
	canon_universe: string | null;
	status: Status;
	hidden: boolean;
	extra_trait_slots: number;
	bonus_ptp: number;
	staff_overrides: StaffOverrides;
	progressed: boolean;
	pinned_notes: PinnedNote[];
	admin_character: boolean;
	encryption_requested: boolean;
	encryption_reason: string;
	encrypted: boolean;
	approved_permissions: string[];
	requested_claims: string[];
	sheet: Sheet;
	approved_sheet: Sheet | null;
	approved_at: string | null;
	submitted_at: string | null;
	reviewed_at: string | null;
	updated_at: string;
	created_at: string;
}

/** Every character (admins only; row-level security returns just your own otherwise). */
export async function loadAllCharacters(): Promise<AdminCharacter[]> {
	const { data, error } = await db()
		.from('characters')
		.select(ADMIN_CHARACTER_COLUMNS)
		.order('submitted_at', { ascending: true, nullsFirst: false });
	fail(error);
	return (data ?? []).map(toAdminCharacter);
}

const ADMIN_CHARACTER_COLUMNS =
	'id, owner_id, name, kind, canon_universe, status, hidden, extra_trait_slots, bonus_ptp, staff_overrides, progressed, pinned_notes, admin_character, encryption_requested, encryption_reason, encrypted, approved_permissions, requested_claims, sheet, approved_sheet, approved_at, submitted_at, reviewed_at, updated_at, created_at';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAdminCharacter = (c: any): AdminCharacter => ({
	...c,
	approved_permissions: c.approved_permissions ?? [],
	sheet: normalizeSheet(c.sheet),
	pinned_notes: normalizePins(c.pinned_notes),
	approved_sheet: c.approved_sheet ? normalizeSheet(c.approved_sheet) : null,
});

/** Admins: remember these 🔑 items as approved on the character. */
export async function rememberPermissions(id: string, approved: string[]) {
	const { error } = await db().from('characters').update({ approved_permissions: [...new Set(approved)] }).eq('id', id);
	fail(error);
}

/** One character with everything the review page and staff tools need (admins). */
export async function loadAdminCharacter(id: string): Promise<AdminCharacter | null> {
	const { data, error } = await db().from('characters').select(ADMIN_CHARACTER_COLUMNS).eq('id', id).maybeSingle();
	fail(error);
	return data ? toAdminCharacter(data) : null;
}

export async function reviewCharacter(id: string, outcome: 'approved' | 'needs_correction' | 'denied', note: string) {
	const { error } = await db().rpc('review_character', { p_character_id: id, p_outcome: outcome, p_note: note });
	fail(error);
}

export async function setCharacterHidden(id: string, hidden: boolean) {
	const { error } = await db().from('characters').update({ hidden }).eq('id', id);
	fail(error);
}

export async function setExtraTraitSlots(id: string, slots: number) {
	const { error } = await db().from('characters').update({ extra_trait_slots: slots }).eq('id', id);
	fail(error);
}

/** Staff edit: saves the sheet with the values staff set (admins only). */
export async function staffEditCharacter(id: string, sheet: Sheet, overrides: StaffOverrides) {
	const { error } = await db().from('characters').update({ sheet, staff_overrides: overrides }).eq('id', id);
	fail(error);
}

/** Admin characters: approve a new one, or put the edits live on an approved one. */
export async function publishAdminCharacter(id: string, _approved?: boolean) {
	// Approves a new one or puts the edits live, and hands out its claims (an Ocular while a spot is open).
	fail((await db().rpc('publish_admin_character', { p_character: id })).error);
}

export async function setPinnedNotes(id: string, notes: PinnedNote[]) {
	const { error } = await db().rpc('set_pinned_notes', { p_character: id, p_notes: notes });
	fail(error);
}

export async function setProgressed(id: string, progressed: boolean) {
	const { error } = await db().from('characters').update({ progressed }).eq('id', id);
	fail(error);
}

export async function setBonusPtp(id: string, points: number) {
	const { error } = await db().from('characters').update({ bonus_ptp: points }).eq('id', id);
	fail(error);
}

/** Deletes a character and frees its canon claims (admins only). */
export async function adminDeleteCharacter(id: string): Promise<{ name: string; releasedClaims: string[] }> {
	const { data, error } = await db().rpc('admin_delete_character', { p_character_id: id });
	fail(error);
	return data as { name: string; releasedClaims: string[] };
}

// ───────────────────────────── Evolutions ─────────────────────────────

export type EvolutionStatus = 'pending' | 'approved' | 'needs_correction' | 'denied';

export interface EvolutionRequest {
	id: string;
	character_id: string;
	summary: string;
	earned: string;
	links: string;
	status: EvolutionStatus;
	review_note: string;
	submitted_at: string;
	reviewed_at: string | null;
}

/** Evolution submissions for these characters, newest first. */
export async function loadEvolutions(characterIds: string[]): Promise<EvolutionRequest[]> {
	if (characterIds.length === 0) return [];
	const { data, error } = await db()
		.from('evolution_requests')
		.select('id, character_id, summary, earned, links, status, review_note, submitted_at, reviewed_at')
		.in('character_id', characterIds)
		.order('submitted_at', { ascending: false });
	fail(error);
	return (data ?? []) as EvolutionRequest[];
}

/** Sends an approved character's saved changes for review as an evolution. */
export async function submitEvolution(characterId: string, summary: string, earned: string, links: string) {
	const { error } = await db().rpc('submit_evolution', { p_character_id: characterId, p_summary: summary, p_earned: earned, p_links: links });
	fail(error);
}

/** Approve (changes + log entry), send back, or deny (back to the last approved version). */
export async function reviewEvolution(requestId: string, outcome: Exclude<EvolutionStatus, 'pending'>, note: string) {
	const { error } = await db().rpc('review_evolution', { p_request: requestId, p_outcome: outcome, p_note: note });
	fail(error);
}

export interface CharacterPoints {
	currencies: Currency[];
	conversions: Conversion[];
	balances: Balance[];
	ledger: LedgerRow[];
	trees: SkillTree[];
	nodes: SkillNode[];
	unlocks: Unlock[];
}

/** A character's upgrade point wallets and their recent history (owner or admin). */
export async function loadPoints(characterId: string): Promise<CharacterPoints> {
	const [currencies, conversions, balances, ledger, trees, nodes, unlocks] = await Promise.all([
		db().from('point_currencies').select('*').order('sort'),
		db().from('point_conversions').select('*').order('id'),
		db().from('character_points').select('card_key, currency, balance').eq('character_id', characterId),
		db()
			.from('point_ledger')
			.select('id, card_key, currency, change, balance_after, source, reason, created_at')
			.eq('character_id', characterId)
			.order('created_at', { ascending: false })
			.limit(30),
		db().from('skill_trees').select('*').order('sort'),
		db().from('skill_tree_nodes').select('*').order('sort'),
		db().from('character_unlocks').select('card_key, tree_id, node_id, cost_amount, cost_currency, created_at').eq('character_id', characterId),
	]);
	for (const r of [currencies, conversions, balances, ledger, trees, nodes, unlocks]) fail(r.error);
	return {
		currencies: (currencies.data ?? []) as Currency[],
		conversions: (conversions.data ?? []) as Conversion[],
		balances: (balances.data ?? []) as Balance[],
		ledger: (ledger.data ?? []) as LedgerRow[],
		trees: (trees.data ?? []) as SkillTree[],
		nodes: (nodes.data ?? []) as SkillNode[],
		unlocks: (unlocks.data ?? []) as Unlock[],
	};
}

export async function convertPoints(characterId: string, card: string, conversion: number, times: number) {
	const { error } = await db().rpc('convert_points', { p_character: characterId, p_card: card, p_conversion: conversion, p_times: times });
	fail(error);
}

export async function adjustPoints(characterId: string, card: string, currency: string, change: number, reason: string) {
	const { error } = await db().rpc('adjust_points', { p_character: characterId, p_card: card, p_currency: currency, p_change: change, p_reason: reason });
	fail(error);
}

export async function unlockSkill(characterId: string, card: string, tree: string, node: string, free = false) {
	const { error } = await db().rpc('unlock_skill', { p_character: characterId, p_card: card, p_tree: tree, p_node: node, p_free: free });
	fail(error);
}

export async function removeSkillUnlock(characterId: string, card: string, tree: string, node: string, refund: boolean) {
	const { error } = await db().rpc('remove_skill_unlock', { p_character: characterId, p_card: card, p_tree: tree, p_node: node, p_refund: refund });
	fail(error);
}

export async function convertCustomPoints(characterId: string, card: string, times: number) {
	const { error } = await db().rpc('convert_custom_points', { p_character: characterId, p_card: card, p_times: times });
	fail(error);
}

// ───────────────────────────── Heavenly Restrictions ─────────────────────────────

/** The Heavenly Restriction a character may use: the one it used, else the owner's unused grant. */
export async function heavenlyGrantFor(ownerId: string, characterId: string | null): Promise<string | null> {
	const { data, error } = await db().from('heavenly_grants').select('restriction, character_id').eq('profile_id', ownerId);
	fail(error);
	const rows = (data ?? []) as { restriction: string; character_id: string | null }[];
	return (characterId && rows.find((r) => r.character_id === characterId)?.restriction) || rows.find((r) => !r.character_id)?.restriction || null;
}

export interface HeavenlyGrantRow {
	id: number;
	restriction: string;
	twin_name: string | null;
	character_name: string | null;
	used_at: string | null;
	note: string;
	granted_at: string;
}

export async function heavenlyGrantsOf(profileId: string): Promise<HeavenlyGrantRow[]> {
	const { data, error } = await db().rpc('heavenly_grants_of', { p_profile: profileId });
	fail(error);
	return (data ?? []) as HeavenlyGrantRow[];
}

export async function grantHeavenly(profileId: string, restriction: string, twinId: string | null, note: string) {
	const { error } = await db().rpc('grant_heavenly', { p_profile: profileId, p_restriction: restriction, p_twin: twinId, p_note: note });
	fail(error);
}

export async function revokeHeavenly(grantId: number) {
	const { error } = await db().rpc('revoke_heavenly', { p_grant: grantId });
	fail(error);
}

// ───────────────────────────── Character pages & encryption ─────────────────────────────

/** What character_page sends: everything for allowed viewers, only the name for everyone else. */
export interface CharacterPageData {
	id: string;
	name: string;
	owner: string | null;
	encrypted: boolean;
	/** False: encrypted (or sealed) and this viewer isn't allowed, so there's no sheet. */
	allowed: boolean;
	/** The sealed family this character is a member of: only the family sees the sheet. */
	sealed_by?: string | null;
	owner_id?: string;
	kind?: 'oc' | 'canon';
	canon_universe?: string | null;
	admin_character?: boolean;
	mine?: boolean;
	approved?: boolean;
	sheet?: Sheet;
}

/** One character's public page, or null when it doesn't exist or isn't public yet. */
export async function loadCharacterPage(id: string): Promise<CharacterPageData | null> {
	const { data, error } = await db().rpc('character_page', { p_character: id });
	fail(error);
	if (!data) return null;
	const page = data as CharacterPageData;
	return page.sheet ? { ...page, sheet: normalizeSheet(page.sheet) } : page;
}

export interface Viewer {
	profile_id: string;
	display_name: string;
	avatar_url: string | null;
	added_at?: string;
}

export async function characterViewers(id: string): Promise<Viewer[]> {
	const { data, error } = await db().rpc('character_viewer_list', { p_character: id });
	fail(error);
	return (data ?? []) as Viewer[];
}

export async function findViewerCandidates(query: string): Promise<Viewer[]> {
	if (query.trim().length < 2) return [];
	const { data, error } = await db().rpc('find_viewer_candidates', { p_query: query });
	fail(error);
	return (data ?? []) as Viewer[];
}

export async function addCharacterViewer(id: string, profile: string) {
	const { error } = await db().rpc('add_character_viewer', { p_character: id, p_profile: profile });
	fail(error);
}

export async function removeCharacterViewer(id: string, profile: string) {
	const { error } = await db().rpc('remove_character_viewer', { p_character: id, p_profile: profile });
	fail(error);
}

/** Admins: encrypt a character (approving its request) or decrypt it. */
export async function setEncryption(id: string, on: boolean) {
	const { error } = await db().rpc('set_encryption', { p_character: id, p_on: on });
	fail(error);
}

/** The owner (or an admin) switches encryption off. */
export async function stopEncryption(id: string) {
	const { error } = await db().rpc('stop_encryption', { p_character: id });
	fail(error);
}

export const characterPageHref = (id: string) => `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}character/?id=${id}`;

// ───────────────────────────── Evolution rolls ─────────────────────────────

/** A card's evolution rolls (e.g. Quirk Instability), oldest first. Staff-reset rolls are left out. */
export async function loadEvolutionRolls(characterId: string): Promise<EvolutionRoll[]> {
	const { data, error } = await db()
		.from('evolution_rolls')
		.select('id, card_key, kind, sides, roll, result, created_at')
		.eq('character_id', characterId)
		.eq('void', false)
		.order('id');
	fail(error);
	return (data ?? []) as EvolutionRoll[];
}

/** Rolled by the database, which checks the card can roll it and writes it to the evolution log. */
export async function rollEvolution(characterId: string, card: string, kind: EvolutionRollKind): Promise<EvolutionRoll> {
	const { data, error } = await db().rpc('roll_evolution', { p_character: characterId, p_card: card, p_kind: kind });
	fail(error);
	return data as EvolutionRoll;
}

/** Uploads a picture of an Ocular's eye into the player's own folder and returns its public link. */
export async function uploadOcularImage(file: File): Promise<string> {
	if (!file.type.startsWith('image/')) throw new Error('That isn’t an image.');
	if (file.size > 5 * 1024 * 1024) throw new Error('Pictures can be up to 5 MB.');
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) throw new Error('Sign in to upload a picture.');
	const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
	const path = `${uid}/${crypto.randomUUID()}.${ext}`;
	const { error } = await db().storage.from('ocular-images').upload(path, file, { contentType: file.type, upsert: false });
	fail(error);
	return db().storage.from('ocular-images').getPublicUrl(path).data.publicUrl;
}
