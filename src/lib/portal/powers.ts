// Custom powers: admins design a power (a Cursed Technique, a Stand, a Quirk…) on a series' card and
// grant it to a player, either to their account (they add it as a card on a new character or an
// evolution, and approval uses the grant up) or straight onto one of their characters.
// The card keeps a powerLink: the power's stats stay locked and the player fills in what's left open.
import { supabase } from '../supabase.ts';
import { cardFromPower, type CustomPower, type MyPowerGrant, type PowerGrantRow } from './powerCards.ts';

export * from './powerCards.ts';

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}
const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export async function loadPowers(): Promise<CustomPower[]> {
	const { data, error } = await db().from('custom_powers').select('*').order('name');
	fail(error);
	return (data ?? []) as CustomPower[];
}

export async function savePower(p: Pick<CustomPower, 'name' | 'system' | 'ability' | 'description' | 'drawbacks' | 'tree'> & { id: string | null }): Promise<string> {
	const { data, error } = await db().rpc('save_custom_power', {
		p_id: p.id,
		p_name: p.name,
		p_system: p.system,
		p_ability: { ...p.ability, system: p.system },
		p_description: p.description,
		p_drawbacks: p.drawbacks,
		p_tree: p.tree,
	});
	fail(error);
	return data as string;
}

export async function deletePower(id: string) {
	const { error } = await db().rpc('delete_custom_power', { p_id: id });
	fail(error);
}

export async function grantPower(powerId: string, profileId: string, note: string) {
	const { error } = await db().rpc('grant_power', { p_power: powerId, p_profile: profileId, p_note: note });
	fail(error);
}

export async function grantPowerToCharacter(power: CustomPower, characterId: string, note: string) {
	const { error } = await db().rpc('grant_power_to_character', { p_power: power.id, p_character: characterId, p_card: cardFromPower(power, null), p_note: note });
	fail(error);
}

export async function revokePowerGrant(grantId: number, removeCard: boolean) {
	const { error } = await db().rpc('revoke_power_grant', { p_grant: grantId, p_remove_card: removeCard });
	fail(error);
}

export async function powerGrants(filter: { power?: string; profile?: string } = {}): Promise<PowerGrantRow[]> {
	const { data, error } = await db().rpc('power_grants_list', { p_power: filter.power ?? null, p_profile: filter.profile ?? null });
	fail(error);
	return (data ?? []) as PowerGrantRow[];
}

/** The grants on a player's account (and the cards they're on), with their powers. */
export async function grantsWithPowers(profileId: string): Promise<MyPowerGrant[]> {
	if (!supabase) return [];
	const { data, error } = await supabase.from('power_grants').select('*, power:custom_powers(*)').eq('profile_id', profileId).order('granted_at');
	fail(error);
	return ((data ?? []) as MyPowerGrant[]).filter((g) => g.power);
}

