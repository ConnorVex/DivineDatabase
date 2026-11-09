// JoJo's card pieces: Hamon and Spin upgrade ladders, Stand gauges, and the Stand Arrow roll for
// characters without a Stand.
import { useEffect, useRef, useState } from 'preact/hooks';
import { type EvolutionRoll } from '../../lib/portal/evolutionRolls.ts';
import { STAND_AWAKENING, STAND_MASTERY, trackLevel, trackValue, type Track } from '../../lib/portal/jojo.ts';
import type { Fields } from '../../lib/portal/systems.ts';
import { RollHistory } from './EvolutionRolls.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

/** Upgrade tracks as ladders: tap a step to set the level (after approval). */
export function UpgradeTracks({ tracks, fields, points, canEdit, onChange }: { tracks: Track[]; fields: Fields; points: string; canEdit: boolean; onChange: (key: string, level: number) => void }) {
	return (
		<div class="dv-fear jj-tracks pf-wide">
			<p class="pf-help">
				{canEdit ? `Upgrades are bought with ${points} on the Skill Tree. Tap the step you’ve reached; staff check the points.` : `Upgrades are bought with ${points} after approval.`}
			</p>
			{tracks.map((t) => {
				const level = trackLevel(t, fields);
				return (
					<section class="dv-ladder" key={t.key}>
						<header class="dv-ladder-head">
							<h5 class="sp-pot-head">{t.label}</h5>
							<span class="dv-now">{trackValue(t, fields)}</span>
						</header>
						<ol class="dv-steps">
							{t.steps.map((step, i) => {
								const label = typeof step === 'number' ? `${step > 0 ? '+' : ''}${step}` : step;
								const name = i === t.steps.length - 1 ? 'Max' : String(i + 1);
								const cls = i < level ? 'done' : i === level ? 'next' : '';
								return (
									<li key={i} class={cls}>
										{canEdit ? (
											<button
												type="button"
												class="jj-step"
												aria-pressed={i < level}
												aria-label={`${t.label} ${name}: ${label}${i < level ? ' (reached; tap to undo)' : ''}`}
												onClick={() => onChange(t.key, i < level && i === level - 1 ? i : i + 1)}
											>
												<span>{label}</span>
												<small>{name}</small>
											</button>
										) : (
											<>
												<span>{label}</span>
												<small>{name}</small>
											</>
										)}
									</li>
								);
							})}
						</ol>
					</section>
				);
			})}
		</div>
	);
}

/** Stand Awakening and Mastery as bars. */
export function StandGauges({ fields }: { fields: Fields }) {
	const bar = (label: string, have: number, max: number, note: string) => (
		<div class="jj-gauge">
			<div class="jj-gauge-head">
				<span>{label}</span>
				<strong>
					{have} / {max}
				</strong>
			</div>
			<span class="sp-req-bar" role="img" aria-label={`${have} of ${max}`}>
				<span style={{ width: `${Math.min(100, (have / max) * 100)}%` }} />
			</span>
			<p class="pf-help">{note}</p>
		</div>
	);
	return (
		<div class="jj-gauges pf-wide">
			{bar('Awakening', Number(fields.standAwakening) || 0, STAND_AWAKENING, 'Fills with Stand Points. Full: your engraved ability awakens and every stat but Dev. Potential gets +4.')}
			{bar('Mastery', Number(fields.standMastery) || 0, STAND_MASTERY, '+3 each use in combat or training. Full: a new skill, points toward Awakening, or +2 to a stat. Then it resets.')}
		</div>
	);
}

/** No Stand yet: roll 1d1000 in an RP for a Stand Arrow (700+). The GMs roll whether you survive it. */
export function ArrowRolls({ rolls, roll, readOnly }: { rolls?: EvolutionRoll[]; roll?: () => Promise<EvolutionRoll>; readOnly: boolean }) {
	const [rolling, setRolling] = useState(false);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const [fresh, setFresh] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);
	const found = rolls?.some((r) => r.result === 'arrow');

	async function go() {
		setError('');
		setRolling(true);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * 1000)), 60);
		const started = Date.now();
		try {
			const result = await roll!();
			await new Promise((r) => setTimeout(r, Math.max(0, (reduced ? 200 : 1200) - (Date.now() - started))));
			setFresh(result.id);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(false);
		}
	}

	return (
		<div class={`er-box pf-wide${found ? ' unstable' : ''}`} aria-live="polite">
			<div class="er-head">
				<h5 class="sp-pot-head">Stand Arrow</h5>
				<span class="er-fails">700+ on 1d1000</span>
			</div>
			<p class="pf-help">No Stand yet? Look for a Stand Arrow: roll once per RP. Its virus is lethal without enough will, so the GMs roll whether you survive it.</p>
			{found && <p class="er-note">You found a Stand Arrow. Tell the GMs: they roll your fate, and if you live you design your Stand here.</p>}
			{!rolls || !roll ? (
				<p class="pf-help">You can roll here once your character is approved.</p>
			) : rolling ? (
				<div class="roll-value rolling er-rolling">
					<strong>{ticker}</strong>
					<span>Looking for a Stand Arrow…</span>
				</div>
			) : (
				!readOnly && (
					<div class="er-action">
						<button type="button" class="pf-button primary" onClick={go}>
							Roll for a Stand Arrow · 1d1000
						</button>
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
