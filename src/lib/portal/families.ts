// Family data the character form needs: which families a character can join and the
// character's current memberships. Row-level security limits every read.
import type { PerkAccess, PerkDetails, PerkKind } from '../families/api.ts';
import { supabase } from '../supabase.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};

export interface JoinableFamily {
	id: string;
	slug: string;
	name: string;
	description: string;
	colour: string;
	banner_url: string;
	recruiting: 'open' | 'closed';
}

export interface CharacterMembership {
	family_id: string;
	status: 'requested' | 'active';
}

export interface FamilyChoices {
	families: JoinableFamily[];
	memberships: CharacterMembership[];
}

/** The families a character is in or may join. Families came after the portal, so a missing table
 * just means an empty step. */
export async function loadFamilyChoices(characterId: string | null): Promise<FamilyChoices> {
	const [families, memberships] = await Promise.all([
		db().from('families').select('id, slug, name, description, colour, banner_url, recruiting').eq('status', 'approved').order('name'),
		characterId ? db().from('family_members').select('family_id, status').eq('character_id', characterId) : Promise.resolve({ data: [], error: null }),
	]);
	return {
		families: (families.data ?? []) as JoinableFamily[],
		memberships: (memberships.data ?? []) as CharacterMembership[],
	};
}

/** A family perk a character can link: a Family ability or a Family trait. */
export interface LinkablePerk {
	id: string;
	family_id: string;
	kind: PerkKind;
	access: PerkAccess;
	title: string;
	description: string;
	details: PerkDetails;
}

/** The approved, readable ability and trait perks of these families. Members-only perks come
 * back only when the player can see them (they're a member, the owner or an admin). */
export async function loadLinkablePerks(familyIds: string[]): Promise<LinkablePerk[]> {
	if (!familyIds.length) return [];
	const { data, error } = await db()
		.from('family_perk_board')
		.select('id, family_id, kind, access, title, description, details')
		.in('family_id', familyIds)
		.in('kind', ['locked_power', 'trait'])
		.eq('unlocked', true)
		.order('created_at');
	if (error) throw new Error(error.message);
	return ((data ?? []) as LinkablePerk[]).filter((p) => (p.kind === 'trait' ? p.details?.trait : p.details?.ability));
}
