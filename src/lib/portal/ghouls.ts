// Tokyo Ghoul numbers from the Index (Ghoul Basics, Kagunes, One-Eyed & Quinx, Kakuja).
import type { Field, Fields } from './systems.ts';

export const isGhoul = (f: Fields) => f.path === 'Ghoul';
export const isOneEyed = (f: Fields) => f.oneEyed === 'Yes';
export const isQuinx = (f: Fields) => f.quinx === 'Yes';
/** Ghouls, One-Eyed Ghouls and Quinx have a Kagune. */
export const hasKagune = (f: Fields) => isGhoul(f) || isOneEyed(f) || isQuinx(f);

export interface KaguneType {
	id: string;
	deploy: string;
	regen: string;
	boosts: string;
	recoil: boolean;
	restricted: boolean;
	about: string;
}

export const KAGUNES: KaguneType[] = [
	{ id: 'Ukaku', deploy: '100', regen: '100', boosts: 'Speed +8, Defense +4', recoil: true, restricted: false, about: 'Feather-like wings from the shoulders: fast, fires high-speed projectiles, weak at melee.' },
	{ id: 'Koukaku', deploy: '263', regen: '300', boosts: 'Shield 10B, Speed −5', recoil: false, restricted: false, about: 'From the shoulder blade: the densest type, shields or sharp weapons. Needs 9A Strength to lift.' },
	{ id: 'Bikaku', deploy: '350', regen: '400', boosts: 'Speed +5, Defense +5', recoil: true, restricted: false, about: 'A tail from the tailbone: the balanced type for close and mid-range.' },
	{ id: 'Ashiaku', deploy: '400', regen: '500', boosts: 'Speed +15', recoil: true, restricted: false, about: 'Wraps around the legs: evolved to outrun super-speed investigators.' },
	{ id: 'Rinkaku', deploy: '800', regen: '100 per tendril', boosts: 'Speed, Strength, Defense +3 each, +4 Striking Power', recoil: false, restricted: true, about: 'Tentacles from behind the waist: one of the most powerful types, starting with 4+.' },
	{ id: 'Udeaku', deploy: '850', regen: '500 per limb', boosts: 'Strength +12', recoil: true, restricted: true, about: 'Forms around the arms: massively boosts lifting strength.' },
	{ id: 'Chimera', deploy: 'Parents’ average +200', regen: 'Parents’ average +200', boosts: 'Both parents’ benefits', recoil: false, restricted: true, about: 'Very rare: can appear in the children of two Ghouls.' },
];
export const kaguneOf = (f: Fields) => KAGUNES.find((k) => k.id === f.kagune);

/** Rc Tank upgrades 1–12: size added and GEP cost. */
export const TANK_STEPS = [50, 50, 50, 100, 100, 100, 150, 150, 150, 200, 200, 200].map((add, i) => ({ add, cost: [5, 10, 15, 20][Math.floor(i / 3)] }));
export const RC_START = 460;

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export const tankLevel = (f: Fields) => Math.max(0, Math.min(TANK_STEPS.length, Math.floor(num(f.tankUpgrades))));
export const gepSpent = (f: Fields) => TANK_STEPS.slice(0, tankLevel(f)).reduce((n, s) => n + s.cost, 0);

/** What the card's sub-species and upgrades work out to. */
export function ghoulStats(f: Fields) {
	const oneEyed = isOneEyed(f);
	const quinx = isQuinx(f);
	const tank = quinx ? num(f.rcTank) : RC_START + TANK_STEPS.slice(0, tankLevel(f)).reduce((n, s) => n + s.add, 0);
	return {
		kind: quinx ? 'Quinx' : oneEyed ? 'One-Eyed Ghoul' : 'Ghoul',
		base: quinx ? null : oneEyed ? { rank: '6B', power: 36 } : { rank: '4C', power: 23 },
		multiplier: quinx ? null : oneEyed ? '4× (+4 with traits)' : '2× (+2 with traits)',
		growCost: oneEyed ? '50 Rc a Sub-Tier, 200 a Primary Tier' : '100 Rc a Sub-Tier, 500 a Primary Tier',
		lostPerRp: quinx ? 13 : oneEyed ? 8 : 18,
		tank,
		starves: !quinx,
		frames: quinx ? Math.max(0, Math.min(5, num(f.quinxFrames ?? 5))) : null,
	};
}

/** Kakuja stages and the M-Rc each needs. */
export const KAKUJA: { id: string; mrc: number; boost: string }[] = [
	{ id: 'Incomplete Kakuja', mrc: 500, boost: '+10 Sub-Tiers to Strength, Speed, Defense and Stamina while deployed' },
	{ id: 'Complete Kakuja', mrc: 1000, boost: '+20 Sub-Tiers to Strength, Speed, Defense and Stamina while deployed' },
];
export const AFFINITY_TRAIT = 'Ghoulish Affinity';

const opt = (value: string, label = value) => ({ value, label });

/** Fields the card grows into after approval (or with permission). */
export const GHOUL_GROWTH_FIELDS: Field[] = [
	{ key: 'tankUpgrades', label: 'Rc Tank upgrades', type: 'number', default: 0, min: 0 },
	{ key: 'mutatedRc', label: 'Mutated Rc (M-Rc)', type: 'number', default: 0, min: 0, help: 'Half the Rc you gain from eating another Ghoul.' },
	{ key: 'kakuja', label: 'Kakuja stage', type: 'select', options: [opt('', 'None'), ...KAKUJA.map((k) => opt(k.id))] },
	{ key: 'kakujaForm', label: 'What your Kakuja looks like', type: 'textarea', showIf: { key: 'kakuja', in: KAKUJA.map((k) => k.id) } },
	{ key: 'specialRc', label: 'Special Rc ability', type: 'textarea', help: 'Much like a Cursed Energy Property.' },
	{ key: 'oneEyed', label: 'One-Eyed Ghoul', type: 'select', options: [opt('', 'No'), opt('Yes')] },
	{ key: 'oneEyedHow', label: 'How it happened', type: 'text', showIf: { key: 'oneEyed', in: ['Yes'] } },
	{ key: 'quinx', label: 'Quinx', type: 'select', options: [opt('', 'No'), opt('Yes')] },
	{ key: 'quinxFrames', label: 'Frames left', type: 'select', options: ['5', '4', '3', '2', '1', '0'].map((n) => opt(n, `${n} (−${Number(n) * 2} Sub-Tiers on all boosts)`)), default: '5', showIf: { key: 'quinx', in: ['Yes'] } },
];

/** Cards from before the rework kept sub-species as a Permission Based pick. */
export function ghoulFromOld(fields: Fields): Fields {
	if (!('subspecies' in fields)) return fields;
	const { subspecies, ...rest } = fields;
	return { ...rest, ...(subspecies === 'One-Eyed' ? { oneEyed: 'Yes' } : {}), ...(subspecies === 'Quinx' ? { quinx: 'Yes' } : {}) };
}
