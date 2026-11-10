// The Inheritance builder's data: starting a family character, its rolls, and the owner's side.
import { supabase } from '../supabase.ts';
import { loadCharacter, newDraft, saveCharacter, type CharacterDraft } from '../portal/api.ts';
import type { InheritanceRoll } from '../portal/inheritance.ts';
import type { BoardPerk } from './api.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};
const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

/** The player's unapproved characters started for this family. */
export interface InheritanceDraft {
	id: string;
	name: string;
	status: 'draft' | 'pending' | 'needs_correction' | 'denied';
}

export async function loadMyInheritanceDrafts(familyId: string): Promise<InheritanceDraft[]> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) return [];
	const { data, error } = await db()
		.from('characters')
		.select('id, name, status')
		.eq('owner_id', uid)
		.is('approved_at', null)
		.eq('sheet->inheritance->>familyId', familyId)
		.order('updated_at', { ascending: false });
	fail(error);
	return (data ?? []) as InheritanceDraft[];
}

/** Starts a new character for the family: a saved draft carrying its inheritance. */
export async function startInheritance(familyId: string, name: string): Promise<string> {
	const draft = newDraft();
	draft.name = name.trim();
	draft.sheet.families = [familyId];
	draft.sheet.inheritance = { familyId, picks: [], options: [], potential: '' };
	return (await saveCharacter(draft, 'draft')).id;
}

export const loadInheritanceCharacter = (id: string): Promise<CharacterDraft> => loadCharacter(id);
export const saveInheritanceCharacter = (c: CharacterDraft) => saveCharacter(c);

export async function loadCharacterInheritanceRolls(characterId: string): Promise<InheritanceRoll[]> {
	const { data, error } = await db().from('family_inheritance_rolls').select('*').eq('character_id', characterId).order('created_at');
	fail(error);
	return (data ?? []) as InheritanceRoll[];
}

/** Every roll asked of a family, newest first (the owner and admins). */
export async function loadFamilyInheritanceRolls(familyId: string): Promise<InheritanceRoll[]> {
	const { data, error } = await db().from('family_inheritance_rolls').select('*').eq('family_id', familyId).order('created_at', { ascending: false });
	fail(error);
	return (data ?? []) as InheritanceRoll[];
}

export async function requestInheritanceRoll(characterId: string, perkId: string, option = ''): Promise<InheritanceRoll> {
	const { data, error } = await db().rpc('request_inheritance_roll', { p_character: characterId, p_perk: perkId, p_option: option });
	fail(error);
	return data as InheritanceRoll;
}

export async function withdrawInheritanceRoll(id: string) {
	fail((await db().rpc('withdraw_inheritance_roll', { p_roll: id })).error);
}

export async function decideInheritanceRoll(id: string, won: boolean, proof: string, note: string): Promise<InheritanceRoll> {
	const { data, error } = await db().rpc('decide_inheritance_roll', { p_roll: id, p_won: won, p_proof: proof.trim(), p_note: note.trim() });
	fail(error);
	return data as InheritanceRoll;
}

/** The family a character is inheriting from, with its perks as the player may see them. */
export interface InheritanceFamily {
	id: string;
	name: string;
	slug: string;
	colour: string;
	perks: BoardPerk[];
}

export async function loadInheritanceFamily(familyId: string): Promise<InheritanceFamily | null> {
	const [family, perks] = await Promise.all([
		db().from('families').select('id, name, slug, colour').eq('id', familyId).maybeSingle(),
		db().from('family_perk_board').select('*').eq('family_id', familyId).order('sort').order('created_at'),
	]);
	fail(family.error);
	fail(perks.error);
	return family.data ? { ...(family.data as Omit<InheritanceFamily, 'perks'>), perks: (perks.data ?? []) as BoardPerk[] } : null;
}

// ───────────────────────────── Opening the Inheritance ─────────────────────────────

export type AccessStatus = 'pending' | 'allowed' | 'declined';

/** The player's request to see a family's hidden perks, if any. */
export async function loadMyInheritanceAccess(familyId: string): Promise<{ status: AccessStatus } | null> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) return null;
	const { data, error } = await db().from('family_inheritance_access').select('status').eq('family_id', familyId).eq('player_id', uid).maybeSingle();
	fail(error);
	return (data as { status: AccessStatus } | null) ?? null;
}

export async function askInheritanceAccess(familyId: string, message: string) {
	fail((await db().rpc('ask_inheritance_access', { p_family: familyId, p_message: message.trim() })).error);
}

export interface AccessRequest {
	player_id: string;
	display_name: string;
	avatar_url: string | null;
	status: AccessStatus;
	message: string;
	created_at: string;
	decided_at: string | null;
}

export async function loadInheritanceAccessList(familyId: string): Promise<AccessRequest[]> {
	const { data, error } = await db().rpc('inheritance_access_list', { p_family: familyId });
	fail(error);
	return (data ?? []) as AccessRequest[];
}

/** Let in (true), decline (false), or close it again (null). */
export async function decideInheritanceAccess(familyId: string, playerId: string, allow: boolean | null) {
	fail((await db().rpc('decide_inheritance_access', { p_family: familyId, p_player: playerId, p_allow: allow })).error);
}
