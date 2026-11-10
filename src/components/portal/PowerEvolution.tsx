// An evolving granted power's meter on its card: how full it is, Evolve, the wait, and staff's +/−.
import { useEffect, useState } from 'preact/hooks';
import { adjustMeter, loadEvolutions, lockText, startEvolution, type CardEvolution } from '../../lib/portal/powers.ts';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function useEvolution(characterId: string | null | undefined, cardKey: string) {
	const [state, setState] = useState<CardEvolution | null>(null);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		if (!characterId) return setState(null);
		let live = true;
		loadEvolutions(characterId).then(
			(all) => live && setState(all.find((x) => x.card_key === cardKey) ?? null),
			() => live && setState(null),
		);
		return () => {
			live = false;
		};
	}, [characterId, cardKey, tick]);
	return { state, reload: () => setTick((t) => t + 1) };
}

export function EvolutionMeter(props: { characterId: string | null | undefined; cardKey: string; compact?: boolean }) {
	const { state: s, reload } = useEvolution(props.characterId, props.cardKey);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [amount, setAmount] = useState('');
	const [reason, setReason] = useState('');
	if (!s) return null;
	const e = s.evolution;
	const full = s.meter >= e.max;
	const pct = Math.min(100, (s.meter / Math.max(1, e.max)) * 100);
	const treeWait = e.treeFirst && !s.tree_complete;

	async function run(fn: () => Promise<void>, done = '') {
		setBusy(true);
		setMsg('');
		try {
			await fn();
			setMsg(done);
			reload();
		} catch (err) {
			setMsg(messageOf(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class={`evo pf-wide${s.started_at ? ' evolving' : full ? ' full' : ''}`}>
			<div class="evo-top">
				<span class="evo-label">{e.meter}</span>
				<strong>
					{s.meter}
					<small> / {e.max}</small>
				</strong>
			</div>
			<div class="evo-bar" role="progressbar" aria-label={`${e.meter} meter`} aria-valuemin={0} aria-valuemax={e.max} aria-valuenow={s.meter}>
				<span style={{ width: `${pct}%` }} />
			</div>
			{s.started_at ? (
				<p class="evo-note">
					<strong>Evolving into {s.next}.</strong> {s.power} is locked until{' '}
					{[s.ends_at && day(s.ends_at), e.lockRps > 0 && `${e.lockRps} RPs are done (${s.rps_since ?? 0} so far)`].filter(Boolean).join(', or sooner once ')}.
				</p>
			) : treeWait ? (
				<p class="evo-note">Evolves into {s.next}. Complete the skill tree first: the meter only fills after that.</p>
			) : (
				<p class="evo-note">
					Evolves into <strong>{s.next}</strong> once full{e.perLog > 0 ? ` (+${e.perLog} per approved training log; staff add the rest)` : ' (staff add the points)'}. {e.lockDays || e.lockRps ? `Then a wait of ${lockText(e)}.` : 'It evolves as soon as Evolve is pressed.'}
				</p>
			)}
			{!s.started_at && full && !treeWait && s.can_evolve && !props.compact && (
				<div class="pw-actions">
					<button type="button" class="pf-button primary" disabled={busy || !s.next_ready} onClick={() => run(() => startEvolution(props.characterId!, props.cardKey), `Evolving into ${s.next}.`)}>
						Evolve into {s.next}
					</button>
					{!s.next_ready && <span class="pf-help">An admin needs to re-save {s.next} first.</span>}
				</div>
			)}
			{s.staff && !props.compact && !s.started_at && (
				<div class="evo-staff">
					<input type="number" aria-label="Points to add (negative takes)" placeholder="+/− points" value={amount} onInput={(ev) => setAmount(ev.currentTarget.value)} />
					<input type="text" aria-label="Reason" placeholder="Reason, e.g. combat vs a stronger opponent" maxLength={300} value={reason} onInput={(ev) => setReason(ev.currentTarget.value)} />
					<button
						type="button"
						class="pf-button"
						disabled={busy || !Number(amount)}
						onClick={() => run(() => adjustMeter(props.characterId!, props.cardKey, Math.trunc(Number(amount)), reason).then(() => (setAmount(''), setReason(''))), 'Meter updated.')}
					>
						Update meter
					</button>
				</div>
			)}
			{msg && (
				<p class="pf-help" role="status">
					{msg}
				</p>
			)}
			{!props.compact && s.log && s.log.length > 0 && (
				<details class="evo-log">
					<summary>History</summary>
					<ul>
						{s.log.map((l, i) => (
							<li key={i}>
								{day(l.at)} · {l.source === 'evolve' ? l.reason : `${l.change > 0 ? '+' : ''}${l.change} (${l.reason || l.source}) → ${l.meter_after}`}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
