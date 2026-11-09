// A Quirk's Awakenings as a tracker and log: how many, how close the next one is, and each one's
// story (an event, or a Spontaneous Evolution roll) and what it gave.
import { AWAKENING_GAINS, AWAKENING_QUP, awakeningLog, newAwakening, type AwakeningEntry } from '../../lib/portal/awakenings.ts';
import type { Fields } from '../../lib/portal/systems.ts';

interface Props {
	fields: Fields;
	/** New entries can be added (the Awakening tab is open and the card is editable). */
	canAdd: boolean;
	readOnly: boolean;
	/** Entries already on the approved card: kept as they are. */
	approvedCount: number;
	onChange: (log: AwakeningEntry[]) => void;
}

const dateText = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Before the log');

export function AwakeningLog({ fields, canAdd, readOnly, approvedCount, onChange }: Props) {
	const log = awakeningLog(fields);
	const qup = Number(fields.upgradePoints) || 0;
	const events = log.filter((e) => e.how === 'Event').length;
	const set = (i: number, patch: Partial<AwakeningEntry>) => onChange(log.map((e, j) => (j === i ? { ...e, ...patch } : e)));
	return (
		<div class="dv-stats qa-log pf-wide">
			<dl class="dv-tiles">
				<div class="dv-tile blood">
					<dt>Awakenings</dt>
					<dd>{log.length}</dd>
					<dd class="ff-power">
						{events} from events · {log.length - events} from rolls
					</dd>
				</div>
				<div class="dv-tile">
					<dt>Next one</dt>
					<dd>
						{Math.min(qup, AWAKENING_QUP)} <small>/ {AWAKENING_QUP} QUP</small>
					</dd>
					<dd class="ff-power">{qup >= AWAKENING_QUP ? 'QUP ready: now the event' : `${AWAKENING_QUP - qup} QUP to go`}</dd>
				</div>
			</dl>
			<p class="pf-help">Each Awakening gives one thing: access to higher Quirk Power, or expanded Quirk rules. It can happen again until your Quirk is maxed out. Awakenings from Spontaneous Evolution are added here by the roll.</p>

			{log.length === 0 ? (
				<p class="qa-empty">No Awakenings yet.</p>
			) : (
				<ol class="qa-entries">
					{log.map((a, i) => {
						const edit = !readOnly && i >= approvedCount;
						return (
							<li key={i} class={`qa-entry${a.how === 'Event' ? '' : ' rolled'}`}>
								<header class="qa-head">
									<strong>Awakening #{i + 1}</strong>
									<span class="qa-how">{a.how === 'Event' ? 'Event' : 'Spontaneous Evolution'}</span>
									<span class="qa-date">{dateText(a.date)}</span>
									{edit && i === log.length - 1 && (
										<button type="button" class="pf-button subtle qa-remove" onClick={() => onChange(log.slice(0, -1))} aria-label={`Remove Awakening #${i + 1}`}>
											Remove
										</button>
									)}
								</header>
								{edit ? (
									<>
										<div class="qa-gain" role="radiogroup" aria-label={`What Awakening #${i + 1} gave`}>
											{AWAKENING_GAINS.map((g) => (
												<button type="button" key={g} role="radio" aria-checked={a.gain === g} class={`pf-button${a.gain === g ? ' primary' : ' subtle'}`} onClick={() => set(i, { gain: g })}>
													{g}
												</button>
											))}
										</div>
										<label class="cy-field">
											<span>{a.gain === 'Higher Quirk Power' ? 'The Quirk Power it opens' : a.gain ? 'The expanded rules' : 'What it gave'}</span>
											<textarea rows={2} value={a.detail} onInput={(e) => set(i, { detail: e.currentTarget.value })} />
										</label>
										{a.how === 'Event' && (
											<label class="cy-field">
												<span>The event that helped you understand your Quirk</span>
												<textarea rows={2} value={a.event} placeholder="A psychological push, a ritual…" onInput={(e) => set(i, { event: e.currentTarget.value })} />
											</label>
										)}
									</>
								) : (
									<dl class="qa-read">
										<dt>Gave</dt>
										<dd>
											{a.gain || '—'}
											{a.detail ? `: ${a.detail}` : ''}
										</dd>
										{a.how === 'Event' && (
											<>
												<dt>Event</dt>
												<dd>{a.event || '—'}</dd>
											</>
										)}
									</dl>
								)}
							</li>
						);
					})}
				</ol>
			)}

			{!readOnly && (
				<div class="qa-add">
					<button type="button" class="pf-button primary" disabled={!canAdd} onClick={() => onChange([...log, newAwakening('Event')])}>
						Log an Awakening
					</button>
					<span class="pf-help">{canAdd ? 'For one from an event. Staff confirm it when they review your evolution.' : 'Opens once you meet the requirements above.'}</span>
				</div>
			)}
		</div>
	);
}
