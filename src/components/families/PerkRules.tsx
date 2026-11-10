// Perk rules the site understands, beyond a title and description: Trait rules (slots, picking
// any trait, combinations, choosing a Potential), System rules (required systems, fixed starting
// values, options to start with, roll for or not allow, extra points, skill limits), Fighting
// styles, Secret technique trackers (a meter, levels and who's reached them) and Items. Each has a
// builder for the family editor and a read-only view for the family page and admin review.
import type { ComponentChildren } from 'preact';
import type { OptionAccess, PerkDetails, StyleRules, SystemOption, SystemRules, Tracker, TraitRules } from '../../lib/families/api.ts';
import { rules } from '../../lib/portal/rules.ts';
import { systemById, systems, type Field } from '../../lib/portal/systems.ts';
import { NumberField, SelectField, TextArea, TextField } from '../portal/fields.tsx';

export const blankTraitRules = (): TraitRules => ({ extraSlots: 0, regularSlots: true, anyTrait: false, countsForCombos: false, potentials: [] });
export const blankSystemRules = (system = 'abilities'): SystemRules => ({
	system,
	required: 'no',
	unless: '',
	fixed: {},
	options: [],
	extraPoints: 0,
	pointsLabel: '',
	moveLimit: 'default',
});
export const blankStyle = (): StyleRules => ({ styleClass: '', passive: '', activation: '' });
export const blankTracker = (): Tracker => ({ meter: { label: '', max: 0, gain: '' }, levels: [], holders: [] });

const ACCESS: { id: OptionAccess; label: string }[] = [
	{ id: 'start', label: 'Can start with' },
	{ id: 'rolled', label: 'Rolled for' },
	{ id: 'banned', label: 'Not allowed' },
];
const STYLE_CLASSES = ['Flow', 'Moveset'];

/** Fields of a system a family can set or list options for (no lists or long text). */
const ruleFields = (system: string): Field[] => (systemById.get(system)?.fields ?? []).filter((f) => f.type === 'select' || f.type === 'number' || f.type === 'text');
const fieldLabel = (system: string, key: string) => systemById.get(system)?.fields.find((f) => f.key === key)?.label ?? key;

/** A small list editor: rows, each with its own inputs, plus Add and Remove. */
function Rows<T>(props: { items: T[]; onChange: (items: T[]) => void; blank: () => T; add: string; empty?: string; row: (item: T, set: (patch: Partial<T>) => void) => ComponentChildren }) {
	const { items, onChange } = props;
	return (
		<div class="pr-rows pf-wide">
			{items.length === 0 && props.empty && <p class="pf-help">{props.empty}</p>}
			{items.map((item, i) => (
				<div class="pr-row" key={i}>
					<div class="pr-row-fields">{props.row(item, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
					<button type="button" class="pf-button subtle pr-remove" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
						✕
					</button>
				</div>
			))}
			<button type="button" class="pf-button subtle pr-add" onClick={() => onChange([...items, props.blank()])}>
				+ {props.add}
			</button>
		</div>
	);
}

function Check(props: { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren }) {
	return (
		<label class="pf-check pf-wide">
			<input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
			{props.children}
		</label>
	);
}

// ───────────────────────────── Trait rules ─────────────────────────────

export function TraitRulesBuilder({ value, onChange }: { value: TraitRules; onChange: (v: TraitRules) => void }) {
	const set = (patch: Partial<TraitRules>) => onChange({ ...value, ...patch });
	return (
		<fieldset class="sys-group pf-wide pr-group">
			<legend>Trait rules</legend>
			<div class="pf-grid">
				<NumberField label="Extra trait slots" min={0} value={value.extraSlots} help="On top of the usual slots." onInput={(n) => set({ extraSlots: Math.max(0, Math.floor(n)) })} />
				<Check checked={!value.regularSlots} onChange={(v) => set({ regularSlots: !v })}>
					Members can’t use the regular trait slots (only the family’s)
				</Check>
				<Check checked={value.anyTrait} onChange={(anyTrait) => set({ anyTrait })}>
					Members pick any listed trait as a family trait
				</Check>
				<Check checked={value.countsForCombos} onChange={(countsForCombos) => set({ countsForCombos })}>
					Family traits count toward combinations
				</Check>
				<fieldset class="pf-field pf-checks pf-wide">
					<legend class="pf-label">Potentials members can pick instead of rolling</legend>
					<div class="pr-chips">
						{rules.potentials.map((p) => {
							const on = value.potentials.includes(p.id);
							return (
								<label key={p.id} class={`pr-chip${on ? ' on' : ''}`}>
									<input
										type="checkbox"
										checked={on}
										onChange={() => set({ potentials: on ? value.potentials.filter((x) => x !== p.id) : rules.potentials.map((q) => q.id).filter((id) => id === p.id || value.potentials.includes(id)) })}
									/>
									{p.label}
								</label>
							);
						})}
					</div>
					<p class="pf-help">Leave them all off to roll Potential as usual.</p>
				</fieldset>
			</div>
		</fieldset>
	);
}

// ───────────────────────────── System rules ─────────────────────────────

export function SystemRulesBuilder({ value, onChange }: { value: SystemRules; onChange: (v: SystemRules) => void }) {
	const set = (patch: Partial<SystemRules>) => onChange({ ...value, ...patch });
	const def = systemById.get(value.system);
	const fields = ruleFields(value.system);
	const selects = fields.filter((f) => f.type === 'select');
	const fixed = Object.entries(value.fixed).map(([field, v]) => ({ field, value: String(v) }));
	const limit = value.moveLimit;
	return (
		<fieldset class="sys-group pf-wide pr-group" key={value.system}>
			<legend>System rules</legend>
			<div class="pf-grid">
				<SelectField
					label="Power system"
					required
					value={value.system}
					options={systems.map((s) => ({ value: s.id, label: s.label }))}
					help="Changing the system clears the values and options below."
					onChange={(system) => system !== value.system && onChange({ ...blankSystemRules(system), required: value.required, unless: value.unless })}
				/>
				<SelectField
					label="Do members need it?"
					value={value.required}
					options={[
						{ value: 'no', label: 'No, it’s optional' },
						{ value: 'yes', label: 'Yes, every member has it' },
						{ value: 'unless', label: 'Yes, unless…' },
					]}
					onChange={(required) => set({ required: required as SystemRules['required'] })}
				/>
				{value.required === 'unless' && <TextField label="Unless" value={value.unless} placeholder="e.g. they’re Heavenly Restricted" onInput={(unless) => set({ unless })} />}

				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Fixed starting values</h4>
					<p class="pf-help">Every member starts with these set. Anything not listed starts as usual.</p>
					<Rows<{ field: string; value: string }>
						items={fixed}
						add="Fix a value"
						onChange={(rows) => set({ fixed: Object.fromEntries(rows.map((r) => [r.field, r.value])) })}
						blank={() => ({ field: '', value: '' })}
						row={(r, patch) => {
							const field = fields.find((f) => f.key === r.field);
							return (
								<>
									<SelectField
										label="Field"
										value={r.field}
										placeholder="Pick a field…"
										options={fields.filter((f) => f.key === r.field || !(f.key in value.fixed)).map((f) => ({ value: f.key, label: f.label }))}
										onChange={(k) => patch({ field: k, value: '' })}
									/>
									{field?.type === 'select' ? (
										<SelectField label="Value" value={r.value} placeholder="Pick…" options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }))} onChange={(v) => patch({ value: v })} />
									) : (
										<TextField label="Value" value={r.value} disabled={!r.field} onInput={(v) => patch({ value: v })} />
									)}
								</>
							);
						}}
					/>
				</div>

				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Options</h4>
					<p class="pf-help">Which choices members can start with, have to roll for, or can’t have. Add the family’s own values (like a custom Cursed Energy level) with “Family’s own”.</p>
					<Rows<SystemOption>
						items={value.options}
						add="Add an option"
						onChange={(options) => set({ options })}
						blank={() => ({ field: selects[0]?.key ?? '', value: '', access: 'start', custom: false, detail: '' })}
						row={(o, patch) => {
							const field = selects.find((f) => f.key === o.field);
							return (
								<>
									<SelectField label="Field" value={o.field} placeholder="Pick a field…" options={selects.map((f) => ({ value: f.key, label: f.label }))} onChange={(f) => patch({ field: f, value: '' })} />
									{o.custom || !field ? (
										<TextField label="Family’s own value" value={o.value} placeholder="e.g. Unbound" onInput={(v) => patch({ value: v })} />
									) : (
										<SelectField label="Value" value={o.value} placeholder="Pick…" options={(field.options ?? []).map((x) => ({ value: x.value, label: x.label ?? x.value }))} onChange={(v) => patch({ value: v })} />
									)}
									<SelectField label="Members" value={o.access} options={ACCESS.map((a) => ({ value: a.id, label: a.label }))} onChange={(a) => patch({ access: a as OptionAccess })} />
									<TextField label="Details" value={o.detail} placeholder={o.custom ? 'e.g. 8K Cursed Energy' : 'Optional'} onInput={(detail) => patch({ detail })} />
									<label class="pf-check pr-own">
										<input type="checkbox" checked={o.custom} onChange={(e) => patch({ custom: e.currentTarget.checked, value: '' })} />
										Family’s own
									</label>
								</>
							);
						}}
					/>
				</div>

				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Points and skills</h4>
					<div class="pf-grid">
						<NumberField label="Extra points" min={0} value={value.extraPoints} help={def?.budget ? `On top of the usual ${def.budget.label}.` : 'To spend on this system’s stats.'} onInput={(n) => set({ extraPoints: Math.max(0, Math.floor(n)) })} />
						<TextField label="What the points are called" value={value.pointsLabel} placeholder={def?.budget?.label ?? 'e.g. Cursed Tier Points'} onInput={(pointsLabel) => set({ pointsLabel })} />
						<SelectField
							label="Starting skills"
							value={typeof limit === 'number' ? 'number' : limit}
							options={[
								{ value: 'default', label: 'The usual limit' },
								{ value: 'unlimited', label: 'As many as they like' },
								{ value: 'number', label: 'A set number' },
							]}
							onChange={(v) => set({ moveLimit: v === 'number' ? 5 : (v as 'default' | 'unlimited') })}
						/>
						{typeof limit === 'number' && <NumberField label="How many" min={0} value={limit} onInput={(n) => set({ moveLimit: Math.max(0, Math.floor(n)) })} />}
					</div>
				</div>
			</div>
		</fieldset>
	);
}

// ───────────────────────────── Fighting style ─────────────────────────────

export function StyleBuilder({ value, onChange }: { value: StyleRules; onChange: (v: StyleRules) => void }) {
	const set = (patch: Partial<StyleRules>) => onChange({ ...value, ...patch });
	return (
		<fieldset class="sys-group pf-wide pr-group">
			<legend>Fighting style</legend>
			<div class="pf-grid">
				<TextField label="Style class" list="pr-style-classes" value={value.styleClass} placeholder="e.g. Flow" onInput={(styleClass) => set({ styleClass })} />
				<datalist id="pr-style-classes">
					{STYLE_CLASSES.map((c) => (
						<option key={c} value={c} />
					))}
				</datalist>
				<TextArea label="Passive" rows={2} value={value.passive} placeholder="What it always does" onInput={(passive) => set({ passive })} />
				<TextArea label="How it’s switched on" rows={3} value={value.activation} placeholder="e.g. Dodge 3 times and strike 3 times, then it’s active for 4 turns" onInput={(activation) => set({ activation })} />
			</div>
		</fieldset>
	);
}

// ───────────────────────────── Tracker ─────────────────────────────

export function TrackerBuilder({ value, onChange }: { value: Tracker | undefined; onChange: (v: Tracker | undefined) => void }) {
	if (!value)
		return (
			<div class="pf-wide pr-tracker-off">
				<button type="button" class="pf-button subtle" onClick={() => onChange(blankTracker())}>
					+ Add a tracker (meter, levels, who’s reached them)
				</button>
			</div>
		);
	const set = (patch: Partial<Tracker>) => onChange({ ...value, ...patch });
	return (
		<fieldset class="sys-group pf-wide pr-group">
			<legend>Tracker</legend>
			<div class="pf-grid">
				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Meter</h4>
					<div class="pf-grid">
						<TextField label="Name" value={value.meter.label} placeholder="e.g. Awakening" onInput={(label) => set({ meter: { ...value.meter, label } })} />
						<NumberField label="Fills up to" min={0} value={value.meter.max} help="0 for no meter." onInput={(max) => set({ meter: { ...value.meter, max: Math.max(0, Math.floor(max)) } })} />
						<TextArea label="How it fills" rows={2} value={value.meter.gain} placeholder="e.g. +10 per landed strike, at most 5 a turn" onInput={(gain) => set({ meter: { ...value.meter, gain } })} />
					</div>
				</div>
				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Levels</h4>
					<Rows
						items={value.levels}
						add="Add a level"
						empty="No levels yet."
						onChange={(levels) => set({ levels })}
						blank={() => ({ name: '', requirement: '', effect: '' })}
						row={(l, patch) => (
							<>
								<TextField label="Level" value={l.name} placeholder="e.g. Level 1" onInput={(name) => patch({ name })} />
								<TextField label="To reach it" value={l.requirement} placeholder="e.g. Awaken 3 times" onInput={(requirement) => patch({ requirement })} />
								<TextArea label="Effect" rows={2} value={l.effect} onInput={(effect) => patch({ effect })} />
							</>
						)}
					/>
				</div>
				<div class="pr-sub pf-wide">
					<h4 class="pr-sub-head">Who’s reached it</h4>
					<Rows
						items={value.holders}
						add="Add a member"
						empty="Nobody yet."
						onChange={(holders) => set({ holders })}
						blank={() => ({ name: '', level: value.levels[0]?.name ?? '', title: '' })}
						row={(h, patch) => (
							<>
								<TextField label="Member" value={h.name} onInput={(name) => patch({ name })} />
								{value.levels.length ? (
									<SelectField label="Level" value={h.level} placeholder="Pick…" options={value.levels.map((l) => ({ value: l.name, label: l.name || 'Unnamed level' }))} onChange={(level) => patch({ level })} />
								) : (
									<TextField label="Level" value={h.level} onInput={(level) => patch({ level })} />
								)}
								<TextField label="Its name" value={h.title} placeholder="Optional" onInput={(title) => patch({ title })} />
							</>
						)}
					/>
				</div>
				<div class="pf-wide">
					<button type="button" class="pf-button subtle" onClick={() => onChange(undefined)}>
						Remove the tracker
					</button>
				</div>
			</div>
		</fieldset>
	);
}

// ───────────────────────────── Items ─────────────────────────────

export function ItemsBuilder({ value, onChange }: { value: { name: string; note: string }[]; onChange: (v: { name: string; note: string }[]) => void }) {
	return (
		<fieldset class="sys-group pf-wide pr-group">
			<legend>Items</legend>
			<Rows
				items={value}
				add="Add an item"
				empty="No items listed. You can describe them instead."
				onChange={onChange}
				blank={() => ({ name: '', note: '' })}
				row={(it, patch) => (
					<>
						<TextField label="Item" value={it.name} onInput={(name) => patch({ name })} />
						<TextField label="Note" value={it.note} placeholder="Optional, e.g. Special Grade" onInput={(note) => patch({ note })} />
					</>
				)}
			/>
		</fieldset>
	);
}

// ───────────────────────────── Checks ─────────────────────────────

export function ruleProblems(details: PerkDetails, name: string): string[] {
	const out: string[] = [];
	const sr = details.systemRules;
	if (sr) {
		if (sr.required === 'unless' && !sr.unless.trim()) out.push(`${name}: say when members don’t need the system.`);
		if (sr.options.some((o) => !o.field || !o.value.trim())) out.push(`${name}: every option needs a field and a value.`);
		if (Object.entries(sr.fixed).some(([k, v]) => !k || !String(v).trim())) out.push(`${name}: every fixed value needs a field and a value.`);
		if (sr.extraPoints > 0 && !sr.pointsLabel.trim() && !systemById.get(sr.system)?.budget) out.push(`${name}: say what the extra points are called.`);
	}
	if (details.tracker) {
		if (details.tracker.levels.some((l) => !l.name.trim())) out.push(`${name}: every level needs a name.`);
		if (details.tracker.holders.some((h) => !h.name.trim())) out.push(`${name}: every member in the tracker needs a name.`);
	}
	if (details.items?.some((i) => !i.name.trim())) out.push(`${name}: every item needs a name.`);
	return out;
}

// ───────────────────────────── Read-only ─────────────────────────────

const potentialLabel = (id: string) => rules.potentials.find((p) => p.id === id)?.label ?? id;

/** What a perk's rules say, for the family page and the admin review. Nothing when it has none. */
export function PerkRulesView({ details }: { details: PerkDetails | undefined }) {
	if (!details) return null;
	const tr = details.traitRules;
	const sr = details.systemRules;
	const st = details.style;
	const tk = details.tracker;
	const items = details.items?.filter((i) => i.name.trim());
	if (!tr && !sr && !(st && (st.styleClass || st.passive || st.activation)) && !tk && !items?.length) return null;
	return (
		<div class="perk-built pr-view">
			{tr && (
				<ul class="pr-facts">
					{tr.extraSlots > 0 && <li>+{tr.extraSlots} trait slots</li>}
					{!tr.regularSlots && <li>No regular trait slots</li>}
					{tr.anyTrait && <li>Any listed trait can be a family trait</li>}
					<li>{tr.countsForCombos ? 'Family traits count toward combinations' : 'Family traits don’t count toward combinations'}</li>
					{tr.potentials.length > 0 && (
						<li>
							Pick a Potential: {tr.potentials.length === rules.potentials.length ? 'any' : tr.potentials.map(potentialLabel).join(', ')}
						</li>
					)}
				</ul>
			)}
			{sr && (
				<>
					<ul class="pr-facts">
						<li>
							<strong>{systemById.get(sr.system)?.label ?? sr.system}</strong>
							{sr.required === 'yes' ? ': every member has it' : sr.required === 'unless' ? `: every member has it, unless ${sr.unless}` : ''}
						</li>
						{sr.extraPoints > 0 && (
							<li>
								+{sr.extraPoints} {sr.pointsLabel || systemById.get(sr.system)?.budget?.label || 'points'}
							</li>
						)}
						{sr.moveLimit !== 'default' && <li>Starting skills: {sr.moveLimit === 'unlimited' ? 'no limit' : sr.moveLimit}</li>}
					</ul>
					{Object.keys(sr.fixed).length > 0 && (
						<dl class="perk-stats">
							{Object.entries(sr.fixed).map(([k, v]) => (
								<div key={k}>
									<dt>{fieldLabel(sr.system, k)}</dt>
									<dd>{v}</dd>
								</div>
							))}
						</dl>
					)}
					{ACCESS.map((a) => {
						const list = sr.options.filter((o) => o.access === a.id);
						if (!list.length) return null;
						return (
							<div key={a.id} class={`pr-options ${a.id}`}>
								<p class="pr-options-head">{a.label}</p>
								<ul>
									{list.map((o, i) => (
										<li key={i}>
											<span class="pr-opt-field">{fieldLabel(sr.system, o.field)}</span> <strong>{o.value}</strong>
											{o.custom && <span class="fm-chip">Family’s own</span>}
											{o.detail && <span class="pf-help"> · {o.detail}</span>}
										</li>
									))}
								</ul>
							</div>
						);
					})}
				</>
			)}
			{st && (st.styleClass || st.passive || st.activation) && (
				<dl class="pr-style">
					{st.styleClass && (
						<div>
							<dt>Class</dt>
							<dd>{st.styleClass}</dd>
						</div>
					)}
					{st.passive && (
						<div>
							<dt>Passive</dt>
							<dd>{st.passive}</dd>
						</div>
					)}
					{st.activation && (
						<div>
							<dt>Switching it on</dt>
							<dd>{st.activation}</dd>
						</div>
					)}
				</dl>
			)}
			{tk && <TrackerView tracker={tk} />}
			{items && items.length > 0 && (
				<ul class="pr-items">
					{items.map((it, i) => (
						<li key={i}>
							<strong>{it.name}</strong>
							{it.note && <span class="pf-help"> · {it.note}</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function TrackerView({ tracker }: { tracker: Tracker }) {
	const { meter, levels, holders } = tracker;
	return (
		<div class="pr-tracker">
			{meter.max > 0 && (
				<div class="pr-meter">
					<div class="pr-meter-head">
						<strong>{meter.label || 'Meter'}</strong>
						<span>0 / {meter.max}</span>
					</div>
					<div class="pr-meter-bar" aria-hidden="true" />
					{meter.gain && <p class="pf-help">{meter.gain}</p>}
				</div>
			)}
			{levels.length > 0 && (
				<ol class="pr-levels">
					{levels.map((l, i) => {
						const who = holders.filter((h) => h.level === l.name);
						return (
							<li key={i}>
								<div class="pr-level-head">
									<strong>{l.name}</strong>
									{l.requirement && <span class="pf-help">{l.requirement}</span>}
								</div>
								{l.effect && <p>{l.effect}</p>}
								{who.length > 0 && (
									<ul class="pr-holders">
										{who.map((h, j) => (
											<li key={j}>
												{h.name}
												{h.title && <em> · {h.title}</em>}
											</li>
										))}
									</ul>
								)}
							</li>
						);
					})}
				</ol>
			)}
			{holders.some((h) => !levels.some((l) => l.name === h.level)) && (
				<ul class="pr-holders">
					{holders
						.filter((h) => !levels.some((l) => l.name === h.level))
						.map((h, j) => (
							<li key={j}>
								{h.name}
								{h.level && ` (${h.level})`}
								{h.title && <em> · {h.title}</em>}
							</li>
						))}
				</ul>
			)}
		</div>
	);
}
