// A custom power's own scaling: the switch and technique tags on the power, each skill's own cost,
// power and upgrades in the skill editor, and the tags every card shows for them.
import { useId, useState } from 'preact/hooks';
import { traits } from '../../lib/portal/rules.ts';
import type { Skill } from '../../lib/portal/sheet.ts';
import {
	blankUpgrade,
	normalizeScaling,
	scalingLabels,
	scalingTags,
	upgradeText,
	upgradedTotals,
	type PowerScaling,
	type ScalingLabels,
	type SkillScaling,
} from '../../lib/portal/skillScaling.ts';
import { NumberField, SelectField, TextField } from './fields.tsx';

const TRAIT_NAMES = [...new Set(traits.map((t) => t.name))].sort();

/** Chips with an input: Enter (or Add) adds one, × takes it off. */
function TagInput(props: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; help?: string }) {
	const id = useId();
	const [text, setText] = useState('');
	const add = () => {
		const v = text.trim();
		if (v && !props.values.includes(v)) props.onChange([...props.values, v]);
		setText('');
	};
	return (
		<div class="pf-field pf-wide ssc-tags-field">
			<label class="pf-label" for={id}>
				{props.label}
			</label>
			{props.values.length > 0 && (
				<ul class="ssc-chips">
					{props.values.map((v) => (
						<li key={v} class="df-tag ssc-chip">
							{v}
							<button type="button" aria-label={`Remove ${v}`} onClick={() => props.onChange(props.values.filter((x) => x !== v))}>
								×
							</button>
						</li>
					))}
				</ul>
			)}
			<div class="ssc-tag-add">
				<input
					id={id}
					class="pf-input"
					value={text}
					placeholder={props.placeholder}
					maxLength={80}
					onInput={(e) => setText(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							add();
						}
					}}
				/>
				<button type="button" class="pf-button" disabled={!text.trim()} onClick={add}>
					Add
				</button>
			</div>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

/** On the power: whether it has its own scaling, and the technique's tags. */
export function PowerScalingBox(props: { system: string; value: PowerScaling | undefined; onChange: (v: PowerScaling) => void }) {
	const v = props.value ?? { custom: false, tags: [] };
	const l = scalingLabels(props.system);
	return (
		<fieldset class="sys-group pf-wide">
			<legend>Scaling</legend>
			<div class="pf-grid">
				<label class="pf-check pf-wide">
					<input type="checkbox" checked={v.custom} onChange={(e) => props.onChange({ ...v, custom: e.currentTarget.checked })} />
					Doesn’t follow the usual scaling
				</label>
				<p class="pf-help pf-wide">
					{v.custom
						? `Each skill below sets its own ${l.cost} and ${l.power} instead of ${l.standardCost} and ${l.standardPower}, plus upgrades, special effects and a required trait. Open a skill to set them.`
						: `Skills use ${l.standardCost} and ${l.standardPower}, as usual. Tick this for a power whose skills each have their own numbers.`}
				</p>
				{v.custom && (
					<TagInput
						label="Technique tags"
						values={v.tags}
						onChange={(tags) => props.onChange({ ...v, tags })}
						placeholder="e.g. a grade or the clan it belongs to"
						help="Shown on the card under the power’s name."
					/>
				)}
			</div>
		</fieldset>
	);
}

/** One skill's own scaling, in the skill editor. */
export function ScalingEditor(props: { system: string | undefined; value: SkillScaling | undefined; onChange: (v: SkillScaling) => void }) {
	const s = normalizeScaling(props.value);
	const l = scalingLabels(props.system);
	const set = (patch: Partial<SkillScaling>) => props.onChange({ ...s, ...patch });
	const setUp = (i: number, patch: Partial<SkillScaling['upgrades'][number]>) => set({ upgrades: s.upgrades.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
	const top = upgradedTotals(s);
	const listId = useId();
	return (
		<fieldset class="ssc-editor">
			<legend>Own scaling</legend>
			<div class="ssc-grid">
				<SelectField
					label={l.cost}
					value={s.cost}
					onChange={(v) => set({ cost: (v || 'standard') as SkillScaling['cost'] })}
					options={[
						{ value: 'standard', label: `As usual (${l.standardCost})` },
						{ value: 'fixed', label: 'A set amount' },
						{ value: 'dependent', label: 'Dependent' },
						{ value: 'none', label: 'None' },
					]}
				/>
				{s.cost === 'fixed' && <NumberField label={`${l.cost} (${l.unit})`} min={0} value={s.costAmount} onInput={(costAmount) => set({ costAmount })} />}
				{(s.cost === 'fixed' || s.cost === 'dependent') && (
					<TextField label={s.cost === 'fixed' ? 'Per' : 'Depends on'} value={s.costNote} placeholder={s.cost === 'fixed' ? 'e.g. per use' : 'e.g. how much is poured in'} onInput={(costNote) => set({ costNote })} />
				)}
				<SelectField
					label={l.power}
					value={s.power}
					onChange={(v) => set({ power: (v || 'standard') as SkillScaling['power'] })}
					options={[
						{ value: 'standard', label: `As usual (${l.standardPower})` },
						{ value: 'fixed', label: 'A set value' },
						{ value: 'dependent', label: 'Dependent' },
						{ value: 'infinite', label: 'Infinite' },
					]}
				/>
				{s.power === 'fixed' && <NumberField label={`Starting ${l.power}`} min={0} value={s.powerAmount} onInput={(powerAmount) => set({ powerAmount })} />}
				{s.power === 'dependent' && <TextField label="Depends on" value={s.powerNote} placeholder="e.g. how long it’s charged" onInput={(powerNote) => set({ powerNote })} />}
				<SelectField
					label="Access"
					value={s.access}
					onChange={(v) => set({ access: v === 'locked' ? 'locked' : 'starting' })}
					options={[
						{ value: 'starting', label: `Starting ${l.skill}` },
						{ value: 'locked', label: `Locked ${l.skill} (unlocked later)` },
					]}
				/>
				<TextField label="Required trait" value={s.requiredTrait} list={listId} placeholder="None" onInput={(requiredTrait) => set({ requiredTrait })} help="The check flags it when the character doesn’t have it." />
				<datalist id={listId}>
					{TRAIT_NAMES.map((t) => (
						<option key={t} value={t} />
					))}
				</datalist>
				<TagInput label="Special effects" values={s.effects} onChange={(effects) => set({ effects })} placeholder="e.g. Ignores armour" />
			</div>

			<div class="ssc-upgrades">
				<div class="ssc-upgrades-head">
					<strong>Upgrades</strong>
					{(top.power !== null || top.cost !== null) && s.upgrades.length > 0 && (
						<span class="pf-help">
							With all of them: {[top.power !== null && `${l.power} ${top.power}`, top.cost !== null && `${l.cost} ${top.cost} ${l.unit}`].filter(Boolean).join(' · ')}
						</span>
					)}
				</div>
				{s.upgrades.map((u, i) => (
					<div class="ssc-upgrade" key={i}>
						<TextField label="Upgrade" value={u.name} placeholder="e.g. Novice" onInput={(name) => setUp(i, { name })} />
						<SelectField
							label="Does"
							value={u.kind}
							onChange={(v) => setUp(i, { kind: (v || 'power') as typeof u.kind })}
							options={[
								{ value: 'power', label: '+ Power' },
								{ value: 'cost', label: '− Cost' },
								{ value: 'other', label: 'Other' },
							]}
						/>
						{u.kind === 'other' ? (
							<TextField label="What it does" value={u.note} placeholder="e.g. Works at a distance" onInput={(note) => setUp(i, { note })} />
						) : (
							<NumberField label={u.kind === 'power' ? 'By' : `By (${l.unit})`} min={0} value={u.amount} onInput={(amount) => setUp(i, { amount })} />
						)}
						<button type="button" class="df-btn-remove ssc-upgrade-remove" aria-label={`Remove upgrade ${u.name || i + 1}`} onClick={() => set({ upgrades: s.upgrades.filter((_, j) => j !== i) })}>
							✕
						</button>
					</div>
				))}
				<div class="ssc-upgrade-actions">
					<button type="button" class="pf-button" onClick={() => set({ upgrades: [...s.upgrades, s.upgrades.length ? { ...s.upgrades[s.upgrades.length - 1], name: '' } : blankUpgrade()] })}>
						＋ Add upgrade
					</button>
					{s.upgrades.length > 0 && <span class="pf-help">A new one copies the last one’s effect, for upgrades that repeat.</span>}
				</div>
			</div>
		</fieldset>
	);
}

/** The tags a skill with its own scaling shows, and its upgrades. */
export function ScalingTags(props: { skill: Skill; system: string | undefined; upgrades?: boolean }) {
	if (!props.skill.scaling) return null;
	const l: ScalingLabels = scalingLabels(props.system);
	const tags = scalingTags(props.skill, l);
	const s = normalizeScaling(props.skill.scaling);
	return (
		<>
			<ul class="ssc-tag-list">
				{tags.map((t) => (
					<li key={t.text} class={`df-tag ssc-tag ssc-${t.kind}`}>
						{t.text}
					</li>
				))}
			</ul>
			{props.upgrades !== false && s.upgrades.length > 0 && (
				<details class="ssc-upgrade-list">
					<summary>Upgrades ({s.upgrades.length})</summary>
					<ul>
						{s.upgrades.map((u, i) => (
							<li key={i}>
								<strong>{u.name || `Upgrade ${i + 1}`}</strong> {upgradeText(u, l)}
							</li>
						))}
					</ul>
				</details>
			)}
		</>
	);
}

/** The power's technique tags. */
export function PowerTags(props: { tags: string[] | undefined }) {
	if (!props.tags?.length) return null;
	return (
		<ul class="ssc-tag-list">
			{props.tags.map((t) => (
				<li key={t} class="df-tag ssc-tag ssc-technique">
					{t}
				</li>
			))}
		</ul>
	);
}
