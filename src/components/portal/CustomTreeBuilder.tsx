// The optional custom skill tree on a system card: its name, what it costs (the card's own points or a
// custom currency with rates staff approve), and its skills with what each one needs.
import { blankTree, cardCurrencyCodes, CUSTOM, customTreeNodes, MAX_NODES, newNodeId, treeCurrencyLabel, type CustomTree, type CustomTreeNode } from '../../lib/portal/customTree.ts';
import type { SystemEntry } from '../../lib/portal/sheet.ts';
import { NumberField, SelectField, TextArea, TextField } from './fields.tsx';
import { SkillTreeView } from './SkillTreeView.tsx';

export function CustomTreeBuilder({ entry, disabled, onChange }: { entry: SystemEntry; disabled: boolean; onChange: (tree: CustomTree | null) => void }) {
	const tree = entry.customTree;
	if (!tree) {
		if (disabled) return null;
		return (
			<div class="ct-empty pf-wide">
				<button type="button" class="pf-button" onClick={() => onChange(blankTree(entry))}>
					＋ Build a custom skill tree (optional)
				</button>
				<p class="pf-help">Plan how this power grows: skills, what each one costs and what it needs. Staff review it with the character.</p>
			</div>
		);
	}

	const set = (fn: (t: CustomTree) => void) => {
		const next: CustomTree = structuredClone(tree);
		fn(next);
		onChange(next);
	};
	const setNode = (id: string, patch: Partial<CustomTreeNode>) => set((t) => void Object.assign(t.nodes.find((n) => n.id === id)!, patch));
	const codes = cardCurrencyCodes(entry);
	const unit = treeCurrencyLabel(tree);

	return (
		<fieldset class="sys-group pf-wide ct">
			<legend>Custom skill tree</legend>
			<div class="pf-grid">
				<TextField label="Tree name" required value={tree.name} disabled={disabled} placeholder="e.g. Commune Mastery" onInput={(v) => set((t) => void (t.name = v))} />
				<SelectField
					label="Skills cost"
					value={tree.currency}
					disabled={disabled}
					options={[...codes.map((c) => ({ value: c, label: `${c} (this card’s points)` })), { value: CUSTOM, label: 'A custom currency (rates need approval)' }]}
					onChange={(v) => set((t) => void (t.currency = v))}
				/>
				{tree.currency === CUSTOM && (
					<div class="ct-currency pf-wide">
						<TextField label="Currency name" required value={tree.custom.name} disabled={disabled} placeholder="e.g. Wisp Points" onInput={(v) => set((t) => void (t.custom.name = v))} />
						<TextField label="Short code" required value={tree.custom.code} disabled={disabled} placeholder="e.g. WP" onInput={(v) => set((t) => void (t.custom.code = v.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()))} />
						<NumberField label="Earned per session" min={0} value={tree.custom.gain} disabled={disabled} help="Per approved training or combat log that used this card." onInput={(v) => set((t) => void (t.custom.gain = Math.max(0, Math.floor(v))))} />
						{codes.length > 0 && (
							<SelectField
								label="Convert from"
								value={tree.custom.convertFrom}
								disabled={disabled}
								options={[{ value: '', label: 'No conversion' }, ...codes.map((c) => ({ value: c, label: c }))]}
								onChange={(v) => set((t) => void (t.custom.convertFrom = v))}
							/>
						)}
						{tree.custom.convertFrom && (
							<div class="ct-rate">
								<NumberField label={tree.custom.convertFrom} min={1} value={tree.custom.convertFromAmount} disabled={disabled} onInput={(v) => set((t) => void (t.custom.convertFromAmount = Math.max(1, Math.floor(v))))} />
								<span aria-hidden="true">→</span>
								<NumberField label={tree.custom.code || 'Custom'} min={1} value={tree.custom.convertToAmount} disabled={disabled} onInput={(v) => set((t) => void (t.custom.convertToAmount = Math.max(1, Math.floor(v))))} />
							</div>
						)}
					</div>
				)}
			</div>

			<ol class="ct-nodes">
				{tree.nodes.map((node, i) => {
					const others = tree.nodes.filter((n) => n.id !== node.id);
					return (
						<li key={node.id} class="ct-node">
							<div class="ct-node-head">
								<TextField label={`Skill ${i + 1}`} required value={node.label} disabled={disabled} onInput={(v) => setNode(node.id, { label: v })} />
								{!node.start && <NumberField label={`Cost (${unit})`} min={0} value={node.cost} disabled={disabled} help={node.cost ? undefined : 'Free once it’s reachable.'} onInput={(v) => setNode(node.id, { cost: Math.max(0, Math.floor(v)) })} />}
							</div>
							<label class="pf-check">
								<input type="checkbox" checked={node.start} disabled={disabled} onChange={(e) => setNode(node.id, { start: e.currentTarget.checked, cost: e.currentTarget.checked ? 0 : node.cost })} />
								Starts unlocked
							</label>
							{others.length > 0 && (
								<div class="ct-requires">
									<span class="pf-label">Needs</span>
									{others.map((o) => (
										<label key={o.id} class="ct-chip">
											<input
												type="checkbox"
												checked={node.requires.includes(o.id)}
												disabled={disabled}
												onChange={(e) =>
													setNode(node.id, { requires: e.currentTarget.checked ? [...node.requires, o.id] : node.requires.filter((r) => r !== o.id) })
												}
											/>
											{o.label || 'Unnamed'}
										</label>
									))}
								</div>
							)}
							<TextArea label="What it does" rows={2} value={node.description} disabled={disabled} onInput={(v) => setNode(node.id, { description: v })} />
							{!disabled && tree.nodes.length > 1 && (
								<button
									type="button"
									class="pf-button subtle"
									onClick={() => set((t) => void (t.nodes = t.nodes.filter((n) => n.id !== node.id).map((n) => ({ ...n, requires: n.requires.filter((r) => r !== node.id) }))))}
								>
									Remove skill
								</button>
							)}
						</li>
					);
				})}
			</ol>

			{!disabled && (
				<div class="ct-actions">
					<button
						type="button"
						class="pf-button"
						disabled={tree.nodes.length >= MAX_NODES}
						onClick={() => set((t) => void t.nodes.push({ id: newNodeId(), label: '', description: '', cost: 5, requires: t.nodes.length ? [t.nodes[t.nodes.length - 1].id] : [], start: false }))}
					>
						＋ Add skill
					</button>
					<button type="button" class="pf-button subtle" onClick={() => onChange(null)}>
						Remove custom tree
					</button>
				</div>
			)}

			<details class="pts-tree ct-preview">
				<summary>Preview</summary>
				<SkillTreeView
					tree={{ id: 'custom', system: entry.system, label: tree.name, show_if: null, sort: 0 }}
					nodes={customTreeNodes(tree)}
					currencyName={() => unit}
					unlocks={[]}
					balance={() => 0}
					tracked={() => true}
					admin={false}
					busy={false}
					preview
					onUnlock={async () => false}
					onRemove={async () => false}
				/>
			</details>
		</fieldset>
	);
}
