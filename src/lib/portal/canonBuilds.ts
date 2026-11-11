// Canon power builds: the skills an admin designed for a canon ability (Engine, a Stand, a Pillar's
// Ignition…), and the extra skills each Quirk Variant adds. A card holding the claim shows them live;
// they aren't copied onto the sheet and don't count toward the player's own skills.
import type { Skill } from './sheet.ts';
import { QUIRK_VARIANTS, type Fields } from './systems.ts';

export interface VariantBuild {
	about: string;
	skills: Skill[];
}

export interface CanonBuild {
	claimable_id: string;
	about: string;
	skills: Skill[];
	/** By variant name, e.g. { Plus: {...}, Maximum: {...} }. */
	variants: Record<string, VariantBuild>;
	updated_at: string;
}

/** The variants a series' canon abilities can have, in order (only Quirks have them). */
export const variantsFor = (system: string | undefined): readonly string[] => (system === 'quirk' ? QUIRK_VARIANTS : []);

export const blankVariant = (): VariantBuild => ({ about: '', skills: [] });

export interface CanonGroup {
	/** '' for the base skills, else the variant, e.g. 'Plus'. */
	variant: string;
	label: string;
	about: string;
	skills: Skill[];
	/** The card has reached this variant (the base always is). */
	reached: boolean;
}

/** What a card holding the claim gets: the base skills, then each variant's, marked reached or not. */
export function canonGroups(build: CanonBuild | null | undefined, system: string | undefined, fields: Fields): CanonGroup[] {
	if (!build) return [];
	const order = variantsFor(system);
	const has = order.indexOf(String(fields.variant ?? ''));
	const out: CanonGroup[] = [];
	if (build.skills.length || build.about.trim()) out.push({ variant: '', label: 'Canon skills', about: build.about, skills: build.skills, reached: true });
	order.forEach((v, i) => {
		const vb = build.variants?.[v];
		if (vb && (vb.skills.length || vb.about.trim())) out.push({ variant: v, label: `${v} Variant`, about: vb.about, skills: vb.skills, reached: has >= i });
	});
	return out;
}

/** Drops empty variants and fills in missing parts, for saving. */
export function cleanBuild(b: Pick<CanonBuild, 'about' | 'skills' | 'variants'>, system: string | undefined) {
	const variants: Record<string, VariantBuild> = {};
	for (const v of variantsFor(system)) {
		const vb = b.variants?.[v];
		if (vb && (vb.skills.length || vb.about.trim())) variants[v] = { about: vb.about, skills: vb.skills };
	}
	return { about: b.about, skills: b.skills, variants };
}
