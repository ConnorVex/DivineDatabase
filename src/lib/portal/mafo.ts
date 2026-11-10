// Maximum All For One: the database calls. The card and the maths are in mafoCards.ts.
import { supabase } from '../supabase.ts';
import { mafoCard, type MafoHolder, type MafoQueueItem, type MafoRequest, type MafoState, type MafoTarget } from './mafoCards.ts';

export * from './mafoCards.ts';

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
	const { data, error } = await db().rpc(fn, args);
	if (error) throw new Error(error.message);
	return data as T;
}

/** The character's M:AFO cards, for anyone who can see its sheet. */
export const loadMafo = (characterId: string) => (supabase ? call<MafoState[]>('mafo_state', { p_character: characterId }) : Promise.resolve([]));
export const loadMafoTargets = () => call<MafoTarget[]>('mafo_targets');
export const loadMafoQueue = () => call<MafoQueueItem[]>('mafo_queue');
export const loadMafoHolders = () => call<MafoHolder[]>('mafo_holders_list');
export const canGrantMafo = () => (supabase ? call<boolean>('can_grant_mafo').catch(() => false) : Promise.resolve(false));

export const requestSteal = (holder: string, card: string, victim: string, victimCard: string, note: string) =>
	call<MafoRequest>('mafo_request', { p_holder: holder, p_card: card, p_action: 'steal', p_victim: victim, p_victim_card: victimCard, p_item: null, p_target: null, p_note: note });
export const requestTransfer = (holder: string, card: string, item: number, target: string, note: string) =>
	call<MafoRequest>('mafo_request', { p_holder: holder, p_card: card, p_action: 'transfer', p_victim: null, p_victim_card: null, p_item: item, p_target: target, p_note: note });
export const cancelMafoRequest = (id: number) => call<void>('cancel_mafo_request', { p_id: id });
export const decideMafo = (id: number, approve: boolean, reason: string) => call<void>('decide_mafo_request', { p_id: id, p_approve: approve, p_reason: reason });

export const grantMafo = (characterId: string, weaker: boolean) => call<void>('grant_mafo', { p_character: characterId, p_card: mafoCard(weaker), p_weaker: weaker });
export const setMafoFree = (characterId: string, card: string, on: boolean) => call<void>('set_mafo_free', { p_character: characterId, p_card: card, p_on: on });
export const revokeMafo = (characterId: string, card: string) => call<void>('revoke_mafo', { p_character: characterId, p_card: card });
