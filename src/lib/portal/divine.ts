// The Divine S.T.S: the tiers past 20A (Kappa, Gamma, Lambda, Omega). Only characters with
// Divine Potential reach them, and admin characters. From the Divine S.T.S board.

export interface DivineRank {
	rank: string;
	tier: number;
	phase: number;
	value: number;
	strength: string;
	speed: string;
	defense: string;
	stamina: string;
}

export const DIVINE_TIERS = [
	{ letter: 'Κ', name: 'Kappa' },
	{ letter: 'Γ', name: 'Gamma' },
	{ letter: 'Λ', name: 'Lambda' },
	{ letter: 'Ω', name: 'Omega' },
] as const;

/** Phase 4: Divine. */
export const DIVINE_PHASE = 4;

export const DIVINE_RANKS: DivineRank[] = [
	{ rank: 'ΚF', tier: 21, phase: 4, value: 124, strength: 'Ganymede (50.79 Teratons)', speed: '2C (FTL)', defense: '100 Gigatons of TNT', stamina: '25K Points' },
	{ rank: 'ΚE', tier: 21, phase: 4, value: 125, strength: '100 Teratons', speed: '5C', defense: '200 Gigatons of TNT', stamina: '30K Points' },
	{ rank: 'ΚD', tier: 21, phase: 4, value: 126, strength: '400 Teratons', speed: '6C', defense: '300 Gigatons of TNT', stamina: '35K Points' },
	{ rank: 'ΚC', tier: 21, phase: 4, value: 127, strength: '600 Teratons', speed: '7C', defense: '400 Gigatons of TNT', stamina: '40K Points' },
	{ rank: 'ΚB', tier: 21, phase: 4, value: 128, strength: '800 Teratons', speed: '8C', defense: '600 Gigatons of TNT', stamina: '45K Points' },
	{ rank: 'ΚA', tier: 21, phase: 4, value: 129, strength: '900 Teratons', speed: '9C (FTL+)', defense: '800 Gigatons of TNT', stamina: '50K Points' },
	{ rank: 'ΚS', tier: 21, phase: 4, value: 130, strength: '100 Petatons', speed: '10C', defense: '999 Gigatons of TNT', stamina: '90K Points' },
	{ rank: 'ΓF', tier: 22, phase: 4, value: 131, strength: '200 Petatons', speed: '50C', defense: '100 Terratons of TNT', stamina: '100K Points' },
	{ rank: 'ΓE', tier: 22, phase: 4, value: 132, strength: '300 Petatons', speed: '60C', defense: '200 Terratons of TNT', stamina: '150K Points' },
	{ rank: 'ΓD', tier: 22, phase: 4, value: 133, strength: '400 Petatons', speed: '65C', defense: '300 Terratons of TNT', stamina: '190K Points' },
	{ rank: 'ΓC', tier: 22, phase: 4, value: 134, strength: '600 Petatons', speed: '75C', defense: '400 Terratons of TNT', stamina: '230K Points' },
	{ rank: 'ΓB', tier: 22, phase: 4, value: 135, strength: '800 Petatons', speed: '85C', defense: '500 Terratons of TNT', stamina: '545K Points' },
	{ rank: 'ΓA', tier: 22, phase: 4, value: 136, strength: '999 Petatons', speed: '95C', defense: '800 Terratons of TNT', stamina: '745K Points' },
	{ rank: 'ΓS', tier: 22, phase: 4, value: 137, strength: '500 Exatons', speed: '150C', defense: '999 Terratons of TNT', stamina: '999K Points' },
	{ rank: 'ΛF', tier: 23, phase: 4, value: 138, strength: '600 Exatons', speed: '200C', defense: '100 Petatons of TNT', stamina: '1 Mil Points' },
	{ rank: 'ΛE', tier: 23, phase: 4, value: 139, strength: '750 Exatons', speed: '300C (Super-Luminal)', defense: '200 Petatons of TNT', stamina: '2 Mil Points' },
	{ rank: 'ΛD', tier: 23, phase: 4, value: 140, strength: 'the entire Earth (5.9 Zettatons)', speed: '350C', defense: '300 Petatons of TNT', stamina: '3 Mil Points' },
	{ rank: 'ΛC', tier: 23, phase: 4, value: 141, strength: '400 Zettatons', speed: '400C (Super-Luminal+)', defense: '400 Petatons of TNT', stamina: '3.4 Mil Points' },
	{ rank: 'ΛB', tier: 23, phase: 4, value: 142, strength: '600 Zettatons', speed: '450C', defense: '500 Petatons of TNT', stamina: '5.6 Mil Points' },
	{ rank: 'ΛA', tier: 23, phase: 4, value: 143, strength: '800 Zettatons', speed: '480C', defense: '700 Petatons of TNT', stamina: '7.5 Mil Points' },
	{ rank: 'ΛS', tier: 23, phase: 4, value: 144, strength: 'Terra (7594 Zettatons)', speed: '500C (Super-Luminal++)', defense: '999 Petatons of TNT', stamina: '9.9 Mil Points' },
	{ rank: 'ΩF', tier: 24, phase: 4, value: 145, strength: 'Sol (1 Solar Mass)', speed: '1K C (Hyperlight)', defense: '100 Tenakilotons of TNT', stamina: '1 Billion Points' },
	{ rank: 'ΩE', tier: 24, phase: 4, value: 146, strength: 'XTE J1650-500 (3.8 Solar Masses)', speed: '300K C (Hyperlight++)', defense: '100 Tenaexatons of TNT', stamina: '2 Billion Points' },
	{ rank: 'ΩD', tier: 24, phase: 4, value: 147, strength: 'UY Scuti (10 Solar Masses)', speed: '500K C (Super Lumic)', defense: '100 Tenaninatons of TNT', stamina: '3 Billion Points' },
	{ rank: 'ΩC', tier: 24, phase: 4, value: 148, strength: 'Sagittarius A* (4.297±0.012 Solar Masses)', speed: '600K C (Super Lumic+)', defense: '100 Bitenaton of TNT', stamina: '4 Billion Points' },
	{ rank: 'ΩB', tier: 24, phase: 4, value: 149, strength: 'R136a1 (4.5747 × 10^32 Solar Masses)', speed: '800K C (Transient)', defense: '100 Hunatons of TNT', stamina: '5 Billion Points' },
	{ rank: 'ΩA', tier: 24, phase: 4, value: 150, strength: 'TON 618 (40 Billion Solar Masses)', speed: '900K C (Transient++)', defense: '100 Tousatons of TNT', stamina: '6 Billion Points' },
	{ rank: 'ΩS', tier: 24, phase: 4, value: 151, strength: 'the entire Universe (Unknown weight)', speed: 'Nigh Omni-Presence', defense: 'Nigh Indestructability', stamina: '2 Trillion Points' },
	{ rank: 'ΩSS+', tier: 24, phase: 4, value: 152, strength: 'anything (Infinite Strength)', speed: 'Omni-Present', defense: 'Indestructible', stamina: 'Infinite Stamina' },
];

export const isDivineRank = (rank: string) => DIVINE_RANKS.some((r) => r.rank === rank);
