// The JJK card's Oculars tab: how many Ocular spots are taken, and, once a player asks for one, a
// picture of the eye, its name and what it does (Index: Ocular Jujutsu Organs). The spots are a
// claim on the claim board (claim_type 'ocular'), so they fill as characters are approved.
import { useState } from 'preact/hooks';
import type { ClaimRow } from '../../lib/portal/api.ts';
import type { Fields } from '../../lib/portal/systems.ts';
import { TextArea, TextField } from './fields.tsx';

const EVERY_OCULAR = [
	['CT Optimization', 'Your Cursed Technique costs next to nothing to use.'],
	['Enhanced CE Perception', 'Sense the slightest disturbance in Cursed Energy, and see far-off detail.'],
	['Unique Ability', 'Every Ocular has its own special ability.'],
	['Energy Drain', 'About 100 Stamina a turn while active. Some can’t be turned off.'],
];

/** Taken spots (with the player's own once they ask), and whether the rest are gone. */
export function ocularSpots(spot: ClaimRow | undefined, asked: boolean, held: boolean) {
	if (!spot) return null;
	const taken = spot.used_slots + (asked && !held ? 1 : 0);
	const max = spot.max_users;
	return { taken, max, full: max !== null && spot.used_slots >= max && !held };
}

export function OcularPanel(props: {
	spot: ClaimRow | undefined;
	asked: boolean;
	held: boolean;
	fields: Fields;
	readOnly: boolean;
	upload?: (file: File) => Promise<string>;
	onAsk: (asked: boolean) => void;
	onChange: (patch: Fields) => void;
}) {
	const { spot, asked, held, fields, readOnly } = props;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const spots = ocularSpots(spot, asked, held);
	const image = /^(https:|blob:)/.test(String(fields.ocularImage ?? '')) ? String(fields.ocularImage) : '';

	async function pick(file: File | undefined) {
		if (!file || !props.upload) return;
		setBusy(true);
		setError('');
		try {
			props.onChange({ ocularImage: await props.upload(file) });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class="oc pf-wide">
			{spots && spots.max !== null && (
				<div class="oc-spots" role="img" aria-label={`${spots.taken} of ${spots.max} Ocular spots taken`}>
					<div class="oc-spots-text">
						<span class="oc-kicker">Active Oculars</span>
						<strong>
							{spots.taken} / {spots.max} spots taken
						</strong>
					</div>
					<div class="oc-eyes" aria-hidden="true">
						{Array.from({ length: spots.max }, (_, i) => (
							<span key={i} class={`oc-eye${i < spots.taken ? ' on' : ''}${asked && !held && i === spots.taken - 1 ? ' mine' : ''}`} />
						))}
					</div>
				</div>
			)}

			{!asked ? (
				<>
					<p class="oc-lead">An extremely rare trait you’re born with. Oculars run in families, and each one looks unique.</p>
					<ul class="oc-gives">
						{EVERY_OCULAR.map(([name, what]) => (
							<li key={name}>
								<strong>{name}</strong>
								<span>{what}</span>
							</li>
						))}
					</ul>
					{!readOnly && !spot && <p class="pf-help">Ocular spots aren’t open on the Divine Database yet.</p>}
					{!readOnly && spot && (
						<div class="oc-ask">
							<button type="button" class="pf-button" onClick={() => props.onAsk(true)}>
								Ask for an Ocular
							</button>
							<span class="pf-help">Staff approve it with your character. It takes a spot when you’re approved.</span>
						</div>
					)}
				</>
			) : (
				<div class="oc-form">
					<div class="oc-eye-pic">
						{image ? <img src={image} alt={`${String(fields.ocular || 'Your Ocular')}`} /> : <span class="oc-eye-empty">No picture yet</span>}
						{!readOnly && props.upload && (
							<div class="oc-pic-actions">
								<label class={`pf-button subtle oc-upload${busy ? ' busy' : ''}`}>
									{busy ? 'Uploading…' : image ? 'Change picture' : 'Upload a picture'}
									<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => pick(e.currentTarget.files?.[0])} />
								</label>
								{image && (
									<button type="button" class="pf-button subtle" onClick={() => props.onChange({ ocularImage: '' })}>
										Remove
									</button>
								)}
							</div>
						)}
						{error && <p class="pf-error">{error}</p>}
						<p class="pf-help">The eye up close. PNG, JPG, WebP or GIF, up to 5 MB.</p>
					</div>
					<div class="oc-fields">
						<TextField label="Ocular name" required help="e.g. Six Eyes" value={String(fields.ocular ?? '')} disabled={readOnly} onInput={(ocular) => props.onChange({ ocular })} />
						<TextArea
							label="What it does"
							required
							rows={5}
							help="Its unique ability, and whether it can be turned off."
							value={String(fields.ocularAbility ?? '')}
							disabled={readOnly}
							onInput={(ocularAbility) => props.onChange({ ocularAbility })}
						/>
						{!readOnly && !held && (
							<div class="oc-remove">
								<button type="button" class="pf-button subtle" onClick={() => props.onAsk(false)}>
									Remove my Ocular
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
