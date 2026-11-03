// System upgrade points (AUP, JJUUP, CEUP, …). The wallets live in the database (character_points);
// this file names the cards they belong to and which sheet fields only the wallets may change.
import type { Sheet, SystemEntry } from './sheet.ts';
import { systemById } from './systems.ts';

/** Sheet fields that show a wallet balance, by system (see point_currencies.field). */
export const TRACKED_FIELDS: Record<string, string[]> = {
	abilities: ['upgradePoints'],
	quirk: ['upgradePoints'],
	'jujutsu-kaisen': ['ceUpgradePoints', 'ctUpgradePoints'],
	jojo: ['hamonMastery', 'spinMastery', 'vampireUpgradePoints'],
};

export const isTrackedField = (system: string, key: string) => TRACKED_FIELDS[system]?.includes(key) ?? false;

export const TRACKED_HELP = 'Tracked by Ultron: earn it with /training log, convert it on the evolve page.';

/** "Abilities", or "Abilities 2" when the sheet has more than one card of that system. */
export function cardLabel(sheet: Sheet, entry: SystemEntry | string): string {
	const card = typeof entry === 'string' ? sheet.systems.find((e) => e.key === entry) : entry;
	if (!card) return 'Removed card';
	const same = sheet.systems.filter((e) => e.system === card.system);
	const name = systemById.get(card.system)?.label ?? card.system;
	return same.length > 1 ? `${name} ${same.indexOf(card) + 1}` : name;
}

export interface Currency {
	code: string;
	system: string;
	label: string;
	earn: number;
	field: string | null;
	show_if: { key: string; in: string[] } | null;
	sort: number;
}

export interface Conversion {
	id: number;
	from_code: string;
	from_amount: number;
	to_code: string;
	to_amount: number;
}

export interface Balance {
	card_key: string;
	currency: string;
	balance: number;
}

export interface LedgerRow {
	id: number;
	card_key: string;
	currency: string;
	change: number;
	balance_after: number;
	source: 'training' | 'convert' | 'staff' | 'sheet';
	reason: string;
	created_at: string;
}

/** Whether a currency applies to a card (its show_if matches the card's fields). */
export const applies = (c: Currency, entry: SystemEntry) => !c.show_if || c.show_if.in.includes(String(entry.fields[c.show_if.key] ?? ''));

/** The currencies each card of the sheet uses, in order. */
export const cardCurrencies = (sheet: Sheet, currencies: Currency[]) =>
	sheet.systems
		.map((entry) => ({ entry, currencies: currencies.filter((c) => c.system === entry.system && applies(c, entry)).sort((a, b) => a.sort - b.sort) }))
		.filter((c) => c.currencies.length);
