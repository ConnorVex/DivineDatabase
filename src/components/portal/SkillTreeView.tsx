// One card's skill tree: nodes in rows by depth. Owned nodes are lit; nodes whose requirements are
// owned can be unlocked with the card's points. Admins can also unlock for free or take nodes back.
import { useState } from 'preact/hooks';
import { ownedNodes, treeBranches, type SkillNode, type SkillTree, type Unlock } from '../../lib/portal/points.ts';

export function SkillTreeView(props: {
	tree: SkillTree;
	nodes: SkillNode[];
	unlocks: Unlock[];
	balance: (code: string) => number;
	tracked: (code: string) => boolean;
	admin: boolean;
	busy: boolean;
	onUnlock: (node: string, free: boolean) => Promise<boolean>;
	onRemove: (node: string, refund: boolean) => Promise<boolean>;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const bought = new Map(props.unlocks.map((u) => [u.node_id, u]));
	const owned = ownedNodes(props.nodes, new Set(bought.keys()));
	const byId = new Map(props.nodes.map((n) => [n.id, n]));
	const node = picked ? byId.get(picked) : undefined;

	const state = (n: SkillNode) => (owned.has(n.id) ? 'owned' : n.requires.every((r) => owned.has(r)) ? 'open' : 'locked');
	const costText = (n: SkillNode) => (n.start ? 'Start' : n.cost_amount === null ? 'Free' : `${n.cost_amount} ${n.cost_currency}`);
	const affordable = (n: SkillNode) => n.cost_amount === null || (props.tracked(n.cost_currency ?? '') && props.balance(n.cost_currency ?? '') >= n.cost_amount);
	const done = (ok: boolean) => ok && setPicked(null);

	return (
		<div class="st">
			<div class="st-rows">
				{treeBranches(props.nodes).map((branch) => (
					<div class="st-branch" key={branch.head?.id ?? 'base'} style={branch.color ? { '--st-branch': branch.color } : undefined}>
						{branch.head && <p class="st-branch-name">{branch.head.label}</p>}
						{branch.rows.map((row, i) => (
							<div class="st-row" key={i}>
								{row.map((n) => {
									const s = state(n);
									return (
										<button
											type="button"
											key={n.id}
											class={`st-node ${s}${s === 'open' && !affordable(n) ? ' poor' : ''}${picked === n.id ? ' picked' : ''}`}
											aria-pressed={picked === n.id}
											title={n.description || undefined}
											onClick={() => setPicked(picked === n.id ? null : n.id)}
										>
											<span class="st-label">{n.label}</span>
											<span class="st-cost">{s === 'owned' ? '✓' : costText(n)}</span>
										</button>
									);
								})}
							</div>
						))}
					</div>
				))}
			</div>

			{node && (
				<div class="st-detail" role="region" aria-label={node.label}>
					<p>
						<strong>{node.label}</strong> · {costText(node)}
						{node.description && <> · {node.description}</>}
					</p>
					{node.requires.length > 0 && (
						<p class="pf-help">
							Needs:{' '}
							{node.requires.map((r, i) => (
								<span key={r} class={owned.has(r) ? 'st-have' : 'st-need'}>
									{i ? ', ' : ''}
									{byId.get(r)?.label ?? r}
								</span>
							))}
						</p>
					)}
					<div class="st-actions">
						{state(node) === 'open' && (
							<>
								{node.cost_amount !== null && !props.tracked(node.cost_currency ?? '') ? (
									<span class="pf-help">{node.cost_currency} isn’t tracked yet. Ask staff to unlock it.</span>
								) : (
									<button type="button" class="pf-button primary" disabled={props.busy || !affordable(node)} onClick={() => props.onUnlock(node.id, false).then(done)}>
										{affordable(node) ? `Unlock for ${costText(node)}` : `Need ${node.cost_amount} ${node.cost_currency} (have ${props.balance(node.cost_currency ?? '')})`}
									</button>
								)}
								{props.admin && node.cost_amount !== null && (
									<button type="button" class="pf-button" disabled={props.busy} onClick={() => props.onUnlock(node.id, true).then(done)}>
										Give for free
									</button>
								)}
							</>
						)}
						{props.admin && bought.has(node.id) && (
							<>
								{(bought.get(node.id)?.cost_amount ?? 0) > 0 && (
									<button type="button" class="pf-button" disabled={props.busy} onClick={() => props.onRemove(node.id, true).then(done)}>
										Remove and refund
									</button>
								)}
								<button type="button" class="pf-button danger" disabled={props.busy} onClick={() => props.onRemove(node.id, false).then(done)}>
									Remove
								</button>
							</>
						)}
						{state(node) === 'locked' && <span class="pf-help">Unlock what it needs first.</span>}
					</div>
				</div>
			)}
		</div>
	);
}
