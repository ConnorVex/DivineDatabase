// Pinned review notes. Reviewers pin a note to a part of the form; the player sees a red box there.
import { useEffect, useRef, useState } from 'preact/hooks';
import { setPinnedNotes } from '../../lib/portal/api.ts';
import { newPinId, PIN_STEPS, pinLabel, pinTargets, type PinnedNote } from '../../lib/portal/pins.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { watchPlayer } from '../../lib/supabase.ts';

/** Red boxes for the notes pinned to one spot. Reviewers get a Remove button. */
export function PinBoxes({ notes, sheet, onRemove, showWhere }: { notes: PinnedNote[]; sheet: Sheet; onRemove?: (id: string) => void; showWhere?: boolean }) {
	if (!notes.length) return null;
	return (
		<div class="pin-boxes">
			{notes.map((n) => (
				<div class="pin-box" role="note" key={n.id}>
					<span class="pin-where">📌 {showWhere || n.target ? pinLabel(n, sheet) : 'Staff note'}</span>
					<p>{n.text}</p>
					{onRemove && (
						<button type="button" class="pin-remove" title="Remove this note" aria-label="Remove this note" onClick={() => onRemove(n.id)}>
							✕
						</button>
					)}
				</div>
			))}
		</div>
	);
}

export interface PinRequest {
	step: string;
	target?: string;
	text?: string;
	/** Changes each time, so the same spot can be asked for twice. */
	nonce: number;
}

/** The review page's "Pinned notes" box: what's pinned, and a form to pin another. */
export function PinnedNotesEditor(props: { characterId: string; kind: 'oc' | 'canon'; sheet: Sheet; notes: PinnedNote[]; request: PinRequest | null; onSaved: (notes: PinnedNote[]) => void }) {
	const [step, setStep] = useState('');
	const [target, setTarget] = useState('');
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [me, setMe] = useState('a reviewer');
	const box = useRef<HTMLTextAreaElement>(null);
	useEffect(() => watchPlayer((p) => p && setMe(p.displayName)), []);
	useEffect(() => {
		if (!props.request) return;
		setStep(props.request.step);
		setTarget(props.request.target ?? '');
		if (props.request.text) setText(props.request.text);
		box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		box.current?.focus({ preventScroll: true });
	}, [props.request?.nonce]);

	const steps = PIN_STEPS.filter((s) => props.kind === 'oc' || !s.ocOnly);
	const targets = step ? pinTargets(step, props.sheet) : [];

	async function save(next: PinnedNote[]) {
		setBusy(true);
		setError('');
		try {
			await setPinnedNotes(props.characterId, next);
			props.onSaved(next);
			return true;
		} catch (e) {
			setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
			return false;
		} finally {
			setBusy(false);
		}
	}
	async function pin() {
		const note: PinnedNote = { id: newPinId(), step, target: target || undefined, text: text.trim(), by: me, at: new Date().toISOString() };
		if (await save([...props.notes, note])) {
			setText('');
			setTarget('');
		}
	}

	return (
		<div class="pin-editor">
			<p class="pf-help">The player sees each note as a red box in that part of their form. Use 📌 on a check or a section of the article to fill this in. Notes clear when the character is approved.</p>
			<PinBoxes notes={props.notes} sheet={props.sheet} showWhere onRemove={busy ? undefined : (id) => save(props.notes.filter((n) => n.id !== id))} />
			<div class="pin-form">
				<div class="pf-field">
					<label class="pf-label" for="pin-step">
						Where
					</label>
					<div class="pin-where-row">
						<select
							id="pin-step"
							value={step}
							onChange={(e) => {
								setStep(e.currentTarget.value);
								setTarget('');
							}}
						>
							<option value="">Choose a step…</option>
							{steps.map((s) => (
								<option key={s.id} value={s.id}>
									{s.label}
								</option>
							))}
						</select>
						{targets.length > 0 && (
							<select aria-label="Which part" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
								<option value="">The whole step</option>
								{targets.map((t) => (
									<option key={t.value} value={t.value}>
										{t.label}
									</option>
								))}
							</select>
						)}
					</div>
				</div>
				<div class="pf-field">
					<label class="pf-label" for="pin-text">
						Note
					</label>
					<textarea id="pin-text" ref={box} rows={2} maxLength={500} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="What's wrong here, and how to fix it." />
				</div>
				{error && <p class="portal-error">{error}</p>}
				<button type="button" class="pf-button" disabled={busy || !step || !text.trim()} onClick={pin}>
					📌 Pin note
				</button>
			</div>
		</div>
	);
}
