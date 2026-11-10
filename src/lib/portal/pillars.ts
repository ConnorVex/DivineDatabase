// Pillars: a special status in Fire Force, separate from Ignitions. Only Tatsuya or Minako give it
// (set_pillar checks their Discord accounts), even after a character is approved. The origin Pillar is
// Passivity; the rest sit on a positive or a negative spectrum.
import { supabase } from '../supabase.ts';
import { potentialsFor } from './potentials.ts';

export type Spectrum = 'origin' | 'positive' | 'negative';

export interface Pillar {
	spectrum: Spectrum;
	emotion: string;
	set_at: string;
}

export const ORIGIN_PILLAR = 'Passivity';
export const POSITIVE_PILLARS = ['Love', 'Pride', 'Curiosity', 'Hope', 'Serenity', 'Excitement', 'Happiness'];

export const SPECTRUMS: { id: Spectrum; label: string; about: string }[] = [
	{ id: 'origin', label: 'Origin', about: 'The origin Pillar: Passivity.' },
	{ id: 'positive', label: 'Positive', about: 'One of the seven positive emotions.' },
	{ id: 'negative', label: 'Negative', about: 'A negative emotion.' },
];

export const spectrumLabel = (s: Spectrum) => SPECTRUMS.find((x) => x.id === s)?.label ?? s;

/** What an Adolla Burst gives, from the Fire Force Burst potential. */
export function burstPerks(): string[] {
	return potentialsFor('fire-force').find((p) => p.id === 'burst')?.perks({}) ?? [];
}

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}

/** The character's Pillar, if it has one and the viewer can see its sheet. */
export async function loadPillar(characterId: string): Promise<Pillar | null> {
	const { data, error } = await db().rpc('character_pillar', { p_character: characterId });
	if (error) throw new Error(error.message);
	return (data as Pillar | null) ?? null;
}

/** Whether the signed-in account can give Pillar status (Tatsuya or Minako). */
export async function canSetPillars(): Promise<boolean> {
	if (!supabase) return false;
	const { data, error } = await supabase.rpc('can_set_pillars');
	return !error && data === true;
}

/** Makes a character a Pillar, or (spectrum null) takes it away. */
export async function setPillar(characterId: string, spectrum: Spectrum | null, emotion: string): Promise<Pillar | null> {
	const { data, error } = await db().rpc('set_pillar', { p_character: characterId, p_spectrum: spectrum, p_emotion: emotion });
	if (error) throw new Error(error.message);
	return (data as Pillar | null) ?? null;
}
