// Pillars on the Fire Force card (its Pillar tab, and the character page), and the panel Tatsuya and
// Minako use to give the status. A Pillar is its own special status, separate from Ignitions.
import { useEffect, useState } from 'preact/hooks';
import { burstPerks, canSetPillars, loadPillar, ORIGIN_PILLAR, POSITIVE_PILLARS, setPillar, SPECTRUMS, spectrumLabel, type Pillar, type Spectrum } from '../../lib/portal/pillars.ts';

/** The character's Pillar (null until loaded or when it has none). */
export function usePillar(characterId: string | null | undefined) {
	const [pillar, setState] = useState<Pillar | null>(null);
	useEffect(() => {
		setState(null);
		if (!characterId) return;
		let live = true;
		loadPillar(characterId).then((p) => live && setState(p), () => {});
		return () => {
			live = false;
		};
	}, [characterId]);
	return pillar;
}

/** The Pillar and what its Adolla Burst gives. */
export function PillarCard({ pillar }: { pillar: Pillar }) {
	return (
		<div class={`pil pil-${pillar.spectrum} pf-wide`}>
			<div class="pil-head">
				<span class="pil-flame" aria-hidden="true" />
				<div class="pil-title">
					<span class="pil-kicker">{pillar.spectrum === 'origin' ? 'Origin Pillar' : `${spectrumLabel(pillar.spectrum)} Pillar`}</span>
					<strong>{pillar.emotion}</strong>
				</div>
			</div>
			<p class="pil-about">A Pillar carries an Adolla Burst, the Genesis Flame, and stands for an emotion.</p>
			<p class="pil-sub">Adolla Burst perks</p>
			<ul class="pil-perks">
				{burstPerks().map((p) => (
					<li key={p}>{p}</li>
				))}
			</ul>
		</div>
	);
}

/** Tatsuya and Minako only: make a character a Pillar, change which, or take it away. */
export function PillarAdmin({ characterId }: { characterId: string }) {
	const [allowed, setAllowed] = useState(false);
	const pillar = usePillar(allowed ? characterId : null);
	const [current, setCurrent] = useState<Pillar | null>(null);
	const [spectrum, setSpectrum] = useState<Spectrum>('positive');
	const [emotion, setEmotion] = useState(POSITIVE_PILLARS[0]);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');

	useEffect(() => {
		canSetPillars().then(setAllowed);
	}, []);
	useEffect(() => {
		setCurrent(pillar);
		if (pillar) {
			setSpectrum(pillar.spectrum);
			setEmotion(pillar.emotion);
		}
	}, [pillar]);
	if (!allowed) return null;

	const pick = (s: Spectrum) => {
		setSpectrum(s);
		setEmotion(s === 'origin' ? ORIGIN_PILLAR : s === 'positive' ? POSITIVE_PILLARS[0] : '');
	};
	async function save(take: boolean) {
		setBusy(true);
		setMsg('');
		try {
			const p = await setPillar(characterId, take ? null : spectrum, emotion);
			setCurrent(p);
			setMsg(take ? 'No longer a Pillar.' : `Now the ${p?.emotion} Pillar.`);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class="ov-pillar">
			<h4 class="pf-subhead">Pillar</h4>
			<p class="pf-help">
				{current ? (
					<>
						Currently the <strong>{current.emotion}</strong> Pillar ({spectrumLabel(current.spectrum).toLowerCase()}). It shows as a Pillar tab on their Fire Force card.
					</>
				) : (
					'Not a Pillar. Only you and Minako see this.'
				)}
			</p>
			<div class="pil-spectrum" role="group" aria-label="Pillar spectrum">
				{SPECTRUMS.map((s) => (
					<button type="button" key={s.id} class={spectrum === s.id ? 'on' : undefined} aria-pressed={spectrum === s.id} title={s.about} onClick={() => pick(s.id)}>
						{s.label}
					</button>
				))}
			</div>
			<div class="ov-pillar-row">
				{spectrum === 'origin' ? (
					<span class="pil-fixed">{ORIGIN_PILLAR}</span>
				) : spectrum === 'positive' ? (
					<select aria-label="Positive Pillar" value={emotion} onChange={(e) => setEmotion(e.currentTarget.value)}>
						{POSITIVE_PILLARS.map((p) => (
							<option key={p}>{p}</option>
						))}
					</select>
				) : (
					<input type="text" aria-label="Negative Pillar's emotion" placeholder="The emotion, e.g. Despair" maxLength={60} value={emotion} onInput={(e) => setEmotion(e.currentTarget.value)} />
				)}
				<button type="button" class="pf-button primary" disabled={busy || !emotion.trim()} onClick={() => save(false)}>
					{current ? 'Change Pillar' : 'Make a Pillar'}
				</button>
				{current && (
					<button type="button" class="pf-button subtle" disabled={busy} onClick={() => save(true)}>
						Take it away
					</button>
				)}
			</div>
			{msg && <p class="pf-help" role="status">{msg}</p>}
		</div>
	);
}
