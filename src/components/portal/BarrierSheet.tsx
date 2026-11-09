// A JJK card's Barrier Techniques: one card each, like the Power systems home page, with an Add
// button. Opening a card edits it: which technique, its name and how it works (Curtains have a set
// description), and the barrier stats that belong to it (a Simple Domain's grade on the Simple Domain).
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { BARRIER_KINDS } from '../../lib/portal/systems.ts';
import { SelectField, TextArea, TextField } from './fields.tsx';

export interface BarrierEntry {
	kind: string;
	name: string;
	notes: string;
}

const kindOf = (name: string) => BARRIER_KINDS.find((k) => k.name === name);

export function BarrierList(props: {
	list: BarrierEntry[];
	canEdit: boolean;
	onChange: (list: BarrierEntry[]) => void;
	/** A barrier stat's input (or its fixed starting value). */
	stat: (key: string) => ComponentChildren;
	/** A barrier stat's label and current value, for the card. */
	statText: (key: string) => string | null;
}) {
	const { list, canEdit, onChange } = props;
	const [open, setOpen] = useState<number | null>(null);
	const edit = (i: number, patch: Partial<BarrierEntry>) => onChange(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
	const current = open !== null ? list[open] : undefined;
	const currentKind = current && kindOf(current.kind);
	// A one-of-a-kind technique (a Curtain) can't be added twice.
	const options = BARRIER_KINDS.filter((k) => !k.once || k.name === current?.kind || !list.some((e) => e.kind === k.name));

	return (
		<div class="bt pf-wide">
			<div class="bt-head">
				<h4 class="pf-subhead">Your techniques</h4>
				{list.length > 0 && <span class="sh-chip">{list.length}</span>}
			</div>
			{list.length === 0 && !canEdit && <p class="pf-help">No Barrier Techniques yet.</p>}
			<div class="bt-cards">
				{list.map((e, i) => {
					const k = kindOf(e.kind);
					const stats = (k?.stats ?? []).map(props.statText).filter(Boolean);
					return (
						<article key={i} class={`bt-card${open === i ? ' on' : ''}`}>
							<button type="button" class="sh-card-open" aria-expanded={open === i} aria-label={`${open === i ? 'Close' : 'Open'} ${e.name || e.kind || 'Barrier Technique'}`} onClick={() => setOpen(open === i ? null : i)} />
							<span class="bt-kind">{[k?.group, !k?.about && e.name && e.kind].filter(Boolean).join(' · ') || e.kind || 'Pick a technique'}</span>
							<strong class="bt-name">{(!k?.about && e.name) || e.kind || 'New Barrier Technique'}</strong>
							{k?.cost && <span class="bt-cost">{k.cost}</span>}
							{stats.length > 0 && <span class="bt-stats">{stats.join(' · ')}</span>}
							{!k?.about && e.notes && <p class="bt-notes">{e.notes}</p>}
						</article>
					);
				})}
				{canEdit && (
					<button
						type="button"
						class="bt-add"
						onClick={() => {
							onChange([...list, { kind: '', name: '', notes: '' }]);
							setOpen(list.length);
						}}
					>
						<span class="df-add-icon">＋</span>
						<span>Add Barrier Technique</span>
					</button>
				)}
			</div>
			{current && open !== null && (
				<div class="bt-edit">
					<SelectField
						label="Technique"
						value={current.kind}
						placeholder="Pick a Barrier Technique…"
						options={options.map((k) => ({ value: k.name, label: k.cost ? `${k.name} (${k.cost})` : k.name, group: k.group }))}
						disabled={!canEdit}
						onChange={(kind) => edit(open, kindOf(kind)?.about ? { kind, name: '', notes: '' } : { kind })}
					/>
					{currentKind?.about ? (
						<p class="bt-about">{currentKind.about}</p>
					) : (
						<>
							<TextField label="Name" help="Optional, e.g. your Domain’s name." value={current.name} disabled={!canEdit} onInput={(name) => edit(open, { name })} />
							<TextArea label="How it works" rows={3} value={current.notes} disabled={!canEdit} onInput={(notes) => edit(open, { notes })} />
						</>
					)}
					{currentKind?.stats && currentKind.stats.length > 0 && (
						<div class="bt-stat-block">
							<h5 class="sp-pot-head">{current.kind} stats</h5>
							<div class="sp-fields">{currentKind.stats.map((key) => props.stat(key))}</div>
						</div>
					)}
					<div class="bt-edit-actions">
						{canEdit && (
							<button
								type="button"
								class="pf-button subtle"
								onClick={() => {
									onChange(list.filter((_, j) => j !== open));
									setOpen(null);
								}}
							>
								Remove
							</button>
						)}
						<button type="button" class="pf-button" onClick={() => setOpen(null)}>
							Done
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
