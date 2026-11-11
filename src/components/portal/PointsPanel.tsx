// Upgrade point wallets for an approved character: balances per system card, conversions
// (e.g. 5 JJUUP → 2 CEUP), the skill trees they unlock, recent history, and for admins a way to
// add or take points.
import { useEffect, useState } from 'preact/hooks';
import { adjustPoints, convertCustomPoints, convertPoints, loadPoints, removeSkillUnlock, unlockSkill, type CharacterPoints } from '../../lib/portal/api.ts';
import { CUSTOM, customTreeNodes } from '../../lib/portal/customTree.ts';
import { applies, cardCurrencies, cardLabel } from '../../lib/portal/points.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { barrierUnlocked, isTechniqueCard, techniqueFields } from '../../lib/portal/systems.ts';

const BARRIER_TREE = 'jjk-barrier';
const TECHNIQUE_TREE = 'jjk-cursed-technique';
const TECHNIQUE_WALLETS = ['JJUUP', 'CTUP'];
import { SkillTreeView } from './SkillTreeView.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const SOURCE = { training: '🏋️ Training', convert: '🔁 Converted', staff: '🛡️ Staff', sheet: '📄 Starting', unlock: '🌳 Unlocked', refund: '↩️ Refunded' } as const;

export function PointsPanel({
	characterId,
	sheet,
	admin = false,
	initial,
	staffOverrides,
	progressed,
}: {
	characterId: string;
	sheet: Sheet;
	admin?: boolean;
	initial?: CharacterPoints;
	/** For the Barrier Techniques tree: it only shows once Barrier Techniques are unlocked. */
	staffOverrides?: Record<string, unknown> | null;
	progressed?: boolean;
}) {
	const [data, setData] = useState<CharacterPoints | null>(initial ?? null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [times, setTimes] = useState<Record<string, number>>({});
	const [adjust, setAdjust] = useState({ target: '', amount: '', reason: '' });

	const reload = () =>
		loadPoints(characterId).then(
			(d) => (setData(d), setError('')),
			(e) => setError(messageOf(e)),
		);
	useEffect(() => void (initial || reload()), [characterId]);

	async function run(fn: () => Promise<unknown>): Promise<boolean> {
		setBusy(true);
		setError('');
		try {
			await fn();
			await reload();
			return true;
		} catch (e) {
			setError(messageOf(e));
			return false;
		} finally {
			setBusy(false);
		}
	}

	if (!data) return error ? <p class="portal-error">{error}</p> : <p class="portal-status">Loading points…</p>;
	// A second Jujutsu Kaisen card is just a Cursed Technique: its JJUUP and CTUP, and the CT tree.
	const technique = (entry: (typeof sheet.systems)[number]) => isTechniqueCard(sheet.systems, entry);
	const view = { ...sheet, systems: sheet.systems.map((e) => (technique(e) ? { ...e, fields: techniqueFields(e.fields) } : e)) };
	const held = (card: string, code: string) => data.balances.some((b) => b.card_key === card && b.currency === code && b.balance !== 0);
	const systemCurrencies = cardCurrencies(view, data.currencies).map((c) =>
		technique(c.entry) ? { ...c, currencies: c.currencies.filter((x) => TECHNIQUE_WALLETS.includes(x.code) || held(c.entry.key, x.code)) } : c,
	);
	// Each card's wallets: its system points, plus its custom tree's own currency (kept in the CUSTOM wallet).
	const customOf = (key: string) => {
		const tree = sheet.systems.find((e) => e.key === key)?.customTree;
		return tree?.currency === CUSTOM ? tree.custom : null;
	};
	const cards = sheet.systems
		.map((entry) => {
			const system = systemCurrencies.find((c) => c.entry.key === entry.key)?.currencies ?? [];
			const custom = customOf(entry.key);
			const codes = new Set(system.map((c) => c.code));
			return {
				entry,
				wallets: [
					...system.map((c) => ({ wallet: c.code, code: c.code, label: c.label, earn: c.earn })),
					...(custom ? [{ wallet: CUSTOM, code: custom.code || 'Custom', label: custom.name, earn: custom.gain }] : []),
				],
				conversions: [
					...data.conversions
						.filter((v) => codes.has(v.from_code) && codes.has(v.to_code))
						.map((v) => ({ id: String(v.id), from: v.from_code, fromAmount: v.from_amount, to: v.to_code, toAmount: v.to_amount, run: (n: number) => convertPoints(characterId, entry.key, v.id, n) })),
					...(custom?.convertFrom
						? [{ id: 'custom', from: custom.convertFrom, fromAmount: custom.convertFromAmount, to: custom.code, toAmount: custom.convertToAmount, run: (n: number) => convertCustomPoints(characterId, entry.key, n) }]
						: []),
				],
			};
		})
		.filter((c) => c.wallets.length);
	if (!cards.length) return <p class="pf-help">None of this character’s systems use upgrade points.</p>;
	const balance = (card: string, code: string) => data.balances.find((b) => b.card_key === card && b.currency === code)?.balance ?? 0;
	const tracked = new Set(data.currencies.map((c) => c.code));
	const currencyName = (card: string, code: string) => (code === CUSTOM ? customOf(card)?.code || 'Custom' : code);
	const treeCards = view.systems.flatMap((entry) => [
		...data.trees
			.filter((t) => t.system === entry.system && applies(t, entry))
			.filter((t) => !technique(entry) || t.id === TECHNIQUE_TREE || data.unlocks.some((u) => u.card_key === entry.key && u.tree_id === t.id))
			// The Barrier Techniques tree waits until they're unlocked (staff still see one with unlocks on it).
			.filter(
				(t) =>
					t.id !== BARRIER_TREE ||
					barrierUnlocked(sheet, entry, { progressed, staffOverrides: staffOverrides ?? undefined, approvedFields: entry.fields }) !== null ||
					(admin && data.unlocks.some((u) => u.card_key === entry.key && u.tree_id === t.id)),
			)
			.map((tree) => ({ entry, tree, nodes: data.nodes.filter((n) => n.tree_id === tree.id) })),
		...(entry.customTree
			? [{ entry, tree: { id: 'custom', system: entry.system, label: entry.customTree.name || 'Custom tree', show_if: null, sort: 0 }, nodes: customTreeNodes(entry.customTree) }]
			: []),
	]);
	const targets = cards.flatMap(({ entry, wallets }) => wallets.map((c) => ({ value: `${entry.key}|${c.wallet}`, label: `${cardLabel(sheet, entry)} · ${c.code}` })));

	return (
		<div class="pts">
			<div class="pts-cards">
				{cards.map(({ entry, wallets, conversions }) => {
					return (
						<div class="hud-panel pts-card" key={entry.key}>
							<h3 class="hud-panel-title">{cardLabel(sheet, entry)}</h3>
							<ul class="pts-balances">
								{wallets.map((c) => (
									<li key={c.wallet} title={c.label}>
										<strong>{balance(entry.key, c.wallet)}</strong>
										<span>{c.code}</span>
										{c.earn > 0 && <small>+{c.earn} per session</small>}
									</li>
								))}
							</ul>
							{conversions.map((v) => {
								const id = `${entry.key}:${v.id}`;
								const n = times[id] ?? 1;
								const affordable = Math.floor(balance(entry.key, v.from) / v.fromAmount);
								return (
									<div class="pts-convert" key={v.id}>
										<span>
											{v.fromAmount * n} {v.from} → {v.toAmount * n} {v.to}
										</span>
										<input
											type="number"
											min={1}
											max={Math.max(1, affordable)}
											value={n}
											aria-label={`How many times to convert ${v.from} to ${v.to}`}
											onInput={(e) => setTimes({ ...times, [id]: Math.max(1, Math.floor(Number(e.currentTarget.value) || 1)) })}
										/>
										<button type="button" class="pf-button" disabled={busy || affordable < n} onClick={() => run(() => v.run(n))}>
											Convert
										</button>
									</div>
								);
							})}
						</div>
					);
				})}
			</div>

			{treeCards.length > 0 && (
				<div class="pts-trees">
					<h3 class="pf-subhead">Skill trees</h3>
					<p class="pf-help">Tap a skill to see what it needs. Unlocking spends the card’s points and adds a line to the evolution log.</p>
					{treeCards.map(({ entry, tree, nodes }) => {
						const unlocks = data.unlocks.filter((u) => u.card_key === entry.key && u.tree_id === tree.id);
						return (
							<details class="pts-tree" key={`${entry.key}:${tree.id}`}>
								<summary>
									{tree.label}
									{treeCards.filter((t) => t.tree.id === tree.id).length > 1 && <> · {cardLabel(sheet, entry)}</>}
									<span class="pts-tree-count">{unlocks.length} unlocked</span>
								</summary>
								<SkillTreeView
									tree={tree}
									nodes={nodes}
									currencyName={(code) => currencyName(entry.key, code)}
									unlocks={unlocks}
									balance={(code) => balance(entry.key, code)}
									tracked={(code) => tracked.has(code) || code === CUSTOM}
									admin={admin}
									busy={busy}
									onUnlock={(node, free) => run(() => unlockSkill(characterId, entry.key, tree.id, node, free))}
									onRemove={(node, refund) => run(() => removeSkillUnlock(characterId, entry.key, tree.id, node, refund))}
								/>
							</details>
						);
					})}
				</div>
			)}

			{admin && (
				<form
					class="pts-adjust"
					onSubmit={(e) => {
						e.preventDefault();
						const [card, code] = adjust.target.split('|');
						const amount = Math.trunc(Number(adjust.amount));
						if (!card || !amount) return setError('Pick a wallet and a non-zero amount (negative takes points).');
						run(() => adjustPoints(characterId, card, code, amount, adjust.reason)).then(() => setAdjust({ ...adjust, amount: '', reason: '' }));
					}}
				>
					<select aria-label="Wallet" value={adjust.target} onChange={(e) => setAdjust({ ...adjust, target: e.currentTarget.value })}>
						<option value="">Wallet…</option>
						{targets.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
					<input type="number" aria-label="Amount" placeholder="+10 or -5" value={adjust.amount} onInput={(e) => setAdjust({ ...adjust, amount: e.currentTarget.value })} />
					<input type="text" aria-label="Reason" placeholder="Reason" maxLength={300} value={adjust.reason} onInput={(e) => setAdjust({ ...adjust, reason: e.currentTarget.value })} />
					<button type="submit" class="pf-button primary" disabled={busy}>
						Apply
					</button>
				</form>
			)}

			{error && <p class="portal-error">{error}</p>}

			{data.ledger.length > 0 && (
				<details class="pts-history">
					<summary>Recent changes</summary>
					<ul>
						{data.ledger.map((r) => (
							<li key={r.id}>
								<span class={r.change > 0 ? 'pts-up' : 'pts-down'}>
									{r.change > 0 ? '+' : ''}
									{r.change} {currencyName(r.card_key, r.currency)}
								</span>{' '}
								· {cardLabel(sheet, r.card_key)} · {SOURCE[r.source]}
								{r.reason ? ` · ${r.reason}` : ''} · <time>{new Date(r.created_at).toLocaleDateString()}</time>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
