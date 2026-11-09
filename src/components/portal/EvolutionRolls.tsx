// Rolls made on a power system's own tab after approval: Quirk Instability (1d1000) and Spontaneous
// Evolution (1d10000). The database rolls them and writes them to the evolution log.
import { useEffect, useRef, useState } from 'preact/hooks';
import { EVOLUTION_DICE, RESULT_TEXT, RP_MS, UNSTABLE_RPS, chance, overclockGain, quirkCooldown, quirkRollStage, type EvolutionRoll, type EvolutionRollKind } from '../../lib/portal/evolutionRolls.ts';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

// Spontaneous Evolution's table, from the Index (1d10000), as chances.
const EVOLUTION_ODDS: [string, string, string][] = [
	[chance(1, 1000, 10000), 'Nothing', 'nothing'],
	[chance(1001, 5000, 10000), 'Quirk Awakening', 'awakening'],
	[chance(5001, 7999, 10000), 'Plus Variant', 'plus'],
	[chance(8000, 9949, 10000), 'Maximum Variant', 'maximum'],
	[chance(9950, 10000, 10000), 'Infinite Variant', 'infinite'],
];
const UNSTABLE_CHANCE = chance(500, 1000, 1000);

/** "2d 4h", "3h 12m", "45s". */
export function waitText(ms: number) {
	const s = Math.max(0, Math.ceil(ms / 1000));
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	if (m) return `${m}m ${s % 60}s`;
	return `${s}s`;
}

/** The time now, ticking every second while something counts down. */
export function useNow(active: boolean) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [active]);
	return now;
}

interface Props {
	/** This card's rolls. Missing before approval. */
	rolls?: EvolutionRoll[];
	roll?: (kind: EvolutionRollKind) => Promise<EvolutionRoll>;
	/** The requirements the sheet can show are met. */
	ready: boolean;
	readOnly: boolean;
	/** The card already has its Variant: show the rolls, no more rolling. */
	done?: boolean;
	/** Applies a result to the card (a Variant, an Awakening). */
	onResult: (roll: EvolutionRoll) => void;
	/** How long an RP lasts for the cooldowns (real-life time for now). */
	rpMs?: number;
}

export function QuirkRolls({ rolls, roll, ready, readOnly, done, onResult, rpMs = RP_MS }: Props) {
	const [rolling, setRolling] = useState<EvolutionRollKind | null>(null);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const [fresh, setFresh] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);
	const cooldown = rolls && !done ? quirkCooldown(rolls, Date.now(), rpMs) : null;
	const now = useNow(Boolean(cooldown?.readyAt));

	if (!rolls || !roll) {
		return (
			<div class="er-box pf-wide">
				<h5 class="sp-pot-head">Rolls</h5>
				<p class="pf-help">Instability is rolled here once your character is approved.</p>
			</div>
		);
	}

	const { stage: rollStage, fails } = quirkRollStage(rolls);
	const stage = done ? 'done' : rollStage;
	const kind: EvolutionRollKind = stage === 'unstable' ? 'quirk_evolution' : 'quirk_instability';
	const dice = EVOLUTION_DICE[kind];
	const live = quirkCooldown(rolls, now, rpMs);
	const waiting = !done && live.readyAt !== null;
	const rpName = rpMs === RP_MS ? '1 day' : waitText(rpMs);

	async function go() {
		setError('');
		setRolling(kind);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * dice.sides)), 60);
		const started = Date.now();
		try {
			const result = await roll!(kind);
			await new Promise((r) => setTimeout(r, Math.max(0, (reduced ? 200 : 1400) - (Date.now() - started))));
			setFresh(result.id);
			onResult(result);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(null);
		}
	}

	const latest = rolls.at(-1);
	return (
		<div class={`er-box pf-wide${stage === 'unstable' ? ' unstable' : ''}`} aria-live="polite">
			<div class="er-head">
				<h5 class="sp-pot-head">{stage === 'unstable' ? 'Your Quirk is unstable' : stage === 'done' ? 'Your rolls' : 'Quirk Instability'}</h5>
				{stage === 'instability' && fails > 0 && <span class="er-fails">{fails} / 3 failed</span>}
			</div>

			{stage === 'instability' && (
				<div class="er-chances">
					<span class="er-chance bad">
						<strong>{UNSTABLE_CHANCE}</strong> goes unstable
					</span>
					<span class="er-chance">
						<strong>{chance(1, 499, 1000)}</strong> stays stable
					</span>
				</div>
			)}

			{stage === 'unstable' && (
				<>
					<ol class="er-rps" aria-label={`${live.rpsDone} of ${UNSTABLE_RPS} unstable RPs done`}>
						{Array.from({ length: UNSTABLE_RPS }, (_, i) => (
							<li key={i} class={i < live.rpsDone ? 'done' : i === live.rpsDone ? 'now' : ''}>
								<strong>RP {i + 1}</strong>
								<small>{i < live.rpsDone ? 'Done' : i === live.rpsDone ? 'Now' : 'To come'}</small>
							</li>
						))}
					</ol>
					<ul class="sp-perks">
						<li>Quirk Power becomes Unstable (64, 68)</li>
						<li>+2 Sub-Tiers to Strength, Speed and Defense</li>
						<li>Quirk drugs and amplification devices don’t work on you</li>
					</ul>
					<table class="er-odds">
						<caption>Spontaneous Evolution chances</caption>
						<tbody>
							{EVOLUTION_ODDS.map(([pct, label, id]) => (
								<tr key={id} class={`er-${id}`}>
									<td>{pct}</td>
									<td>{label}</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}

			{rolling ? (
				<div class="roll-value rolling er-rolling">
					<strong>{ticker}</strong>
					<span>Rolling {dice.name}…</span>
				</div>
			) : stage === 'done' ? null : stage === 'failed' ? (
				<p class="er-note">3 failed rolls. Use your Quirk in training or combat 3 more times and store 50 QUP again, then ask staff to reset your rolls.</p>
			) : (
				!readOnly && (
					<div class="er-action">
						<button type="button" class="pf-button primary" disabled={!ready || waiting} onClick={go}>
							{waiting ? `${stage === 'unstable' ? 'Spontaneous Evolution' : 'Next roll'} in ${waitText(live.readyAt! - now)}` : `Roll ${dice.name}`}
						</button>
						<p class="pf-help">
							{!ready
								? 'Meet the requirements above first.'
								: stage === 'unstable'
									? waiting
										? `Spontaneous Evolution opens after your ${UNSTABLE_RPS} unstable RPs (1 RP = ${rpName} for now). Roll on the last turn of the 3rd; you get one roll.`
										: 'Your 3 unstable RPs are done. Roll on the last turn of the 3rd RP; you get one roll.'
									: waiting
										? `One Instability roll per RP (1 RP = ${rpName} for now).`
										: 'Goes unstable for 3 RPs. 3 failed rolls in a row and you redo the requirements.'}
						</p>
					</div>
				)
			)}

			{error && (
				<p class="roll-note bad" role="alert">
					{error}
				</p>
			)}

			{rolls.length > 0 && <RollHistory rolls={rolls} fresh={fresh} />}
			{latest && latest.id === fresh && <p class="pf-help er-logged">Added to your evolution log.</p>}
		</div>
	);
}

/** A card's rolls, newest first. */
export function RollHistory({ rolls, fresh, limit }: { rolls: EvolutionRoll[]; fresh: number | null; limit?: number }) {
	const shown = [...rolls].reverse().slice(0, limit);
	return (
		<ol class="er-history" reversed>
			{shown.map((r) => (
				<li key={r.id} class={`er-roll er-${r.result}${r.id === fresh ? ' fresh' : ''}`}>
					<span class="er-num">{r.roll.toLocaleString()}</span>
					<span class="er-what">
						<strong>{RESULT_TEXT[r.result] ?? r.result}</strong>
						<span>
							{EVOLUTION_DICE[r.kind].name} · 1d{r.sides.toLocaleString()} · {new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
						</span>
					</span>
				</li>
			))}
		</ol>
	);
}

/**
 * Overclocking's Instability, for use during a fight: a tracker (kept on this device only) and the
 * 1d10 roll made every turn at 50+ Instability. The database rolls it; a 10 loses the ability.
 */
export function OverclockRolls({ rolls, roll, upgrades, readOnly }: { rolls?: EvolutionRoll[]; roll?: () => Promise<EvolutionRoll>; upgrades: number; readOnly: boolean }) {
	const [meter, setMeter] = useState(0);
	const [rolling, setRolling] = useState(false);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const [fresh, setFresh] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);
	const gain = overclockGain(upgrades);
	const lost = rolls?.some((r) => r.result === 'lost');

	async function go() {
		setError('');
		setRolling(true);
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * 10)), 60);
		const started = Date.now();
		try {
			const result = await roll!();
			await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
			setFresh(result.id);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(false);
		}
	}

	const level = meter >= 100 ? 'gone' : meter >= 50 ? 'hot' : 'ok';
	return (
		<div class={`er-box pf-wide${level !== 'ok' ? ' unstable' : ''}`} aria-live="polite">
			<div class="er-head">
				<h5 class="sp-pot-head">Instability</h5>
				<span class="er-fails">{gain} per turn overclocked</span>
			</div>
			<div class="er-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter} aria-label="Instability">
				<span style={{ width: `${meter}%`, background: meter >= 100 ? '#ff3d3d' : meter >= 50 ? '#e0a33a' : '#3ba55d' }} />
				<em>{meter} / 100</em>
			</div>
			<div class="er-steps">
				<button type="button" class="pf-button" onClick={() => setMeter((m) => Math.min(100, m + gain))}>
					Turn overclocked +{gain}
				</button>
				<button type="button" class="pf-button" onClick={() => setMeter((m) => Math.max(0, m - 5))}>
					Turn not using it −5
				</button>
				<button type="button" class="pf-button subtle" onClick={() => setMeter(0)}>
					Reset
				</button>
			</div>
			<p class="pf-help">The tracker is only for you during a fight and isn’t saved. Rolls are.</p>
			<table class="er-odds">
				<caption>At 50+, roll 1d10 every turn you stay overclocked</caption>
				<tbody>
					<tr class="er-steady"><td>1 – 5</td><td>Nothing happens</td></tr>
					<tr class="er-exit"><td>6 – 9</td><td>You exit Overclock: 10-turn cooldown</td></tr>
					<tr class="er-lost"><td>10</td><td>Your ability’s genes disintegrate: it’s gone for good</td></tr>
				</tbody>
			</table>
			{meter >= 100 && <p class="er-note">At 100 Instability the ability is lost for good. Tell staff so they can update your card.</p>}
			{lost ? (
				<p class="er-note">This ability was lost to Overclocking. Staff will update your card.</p>
			) : !rolls || !roll ? (
				<p class="pf-help">Overclock Instability is rolled here once your character is approved.</p>
			) : rolling ? (
				<div class="roll-value rolling er-rolling">
					<strong>{ticker}</strong>
					<span>Rolling Overclock Instability…</span>
				</div>
			) : (
				!readOnly && (
					<div class="er-action">
						<button type="button" class="pf-button primary" onClick={go}>
							Roll Overclock Instability · 1d10
						</button>
						{meter < 50 && <p class="pf-help">You only need to roll at 50+ Instability.</p>}
					</div>
				)
			)}
			{error && (
				<p class="roll-note bad" role="alert">
					{error}
				</p>
			)}
			{rolls && rolls.length > 0 && <RollHistory rolls={rolls} fresh={fresh} limit={5} />}
		</div>
	);
}
