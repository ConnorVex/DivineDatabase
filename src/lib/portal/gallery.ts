// The character gallery: every approved character, as the public `gallery` view hands them out.
// Encrypted characters (and sealed families' members) come with their name and player only:
// the view itself leaves their sheet out, so nothing about them reaches the browser.
import { supabase } from '../supabase.ts';
import { systemById } from './systems.ts';

export interface GalleryCharacter {
	id: string;
	name: string;
	kind: 'oc' | 'canon';
	universe: string | null;
	approvedAt: string;
	player: string;
	playerAvatar: string | null;
	encrypted: boolean;
	image: string | null;
	/** Power system ids, in sheet order (none when encrypted). */
	systems: string[];
	/** Card titles, e.g. "Omni-Energy Death Blasts", for search. */
	abilityNames: string[];
	potential: string;
	familyIds: string[];
}

export interface GalleryFamily {
	id: string;
	name: string;
	colour: string;
}

interface Row {
	id: string;
	kind: 'oc' | 'canon';
	canon_universe: string | null;
	name: string | null;
	approved_at: string;
	player_name: string | null;
	player_avatar: string | null;
	encrypted: boolean;
	image: string | null;
	systems: { system?: string; fields?: { name?: unknown } }[] | null;
	potential: string | null;
	families: unknown;
}

export async function loadGallery(): Promise<{ characters: GalleryCharacter[]; families: GalleryFamily[] }> {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	const [chars, fams] = await Promise.all([
		supabase
			.from('gallery')
			.select(
				'id, kind, canon_universe, name, approved_at, player_name, player_avatar, encrypted, image:sheet->appearance->>image, systems:sheet->systems, potential:sheet->potential->>grade, families:sheet->families',
			)
			.order('approved_at', { ascending: false }),
		supabase.from('families').select('id, name, colour').eq('status', 'approved'),
	]);
	if (chars.error) throw new Error(chars.error.message);
	const characters = ((chars.data ?? []) as Row[]).map((r): GalleryCharacter => {
		const systems = Array.isArray(r.systems) && !r.encrypted ? r.systems : [];
		return {
			id: r.id,
			name: r.name ?? 'Unnamed',
			kind: r.kind,
			universe: r.canon_universe,
			approvedAt: r.approved_at,
			player: r.player_name ?? 'A player',
			playerAvatar: r.player_avatar,
			encrypted: r.encrypted,
			image: !r.encrypted && r.image && /^https:\/\//.test(r.image) ? r.image : null,
			systems: [...new Set(systems.map((e) => String(e.system ?? '')).filter((id) => systemById.has(id)))],
			abilityNames: systems.map((e) => String(e.fields?.name ?? '').trim()).filter(Boolean),
			potential: r.encrypted ? '' : (r.potential ?? ''),
			familyIds: !r.encrypted && Array.isArray(r.families) ? r.families.map(String) : [],
		};
	});
	return { characters, families: (fams.data ?? []) as GalleryFamily[] };
}
