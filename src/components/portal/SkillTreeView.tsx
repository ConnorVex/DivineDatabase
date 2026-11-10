// One card's skill tree: nodes in rows by depth, joined by curved links from each skill to the ones
// it needs. Owned nodes are lit; nodes whose requirements are owned can be unlocked with the card's
// points. Admins can also unlock for free or take nodes back.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface Link {
	from: string;
	to: string;
	d: string;
	color: string;
}

/** Curves from the bottom of each requirement to the top of the skill that needs it, measured from
 * the laid-out buttons so they follow the rows as they wrap. */
function useLinks(nodes: SkillNode[], deps: unknown[]) {
	const box = useRef<HTMLDivElement>(null);
	const [links, setLinks] = useState<Link[]>([]);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		const measure = () => {
			const origin = el.getBoundingClientRect();
			const at = new Map<string, DOMRect>();
			const color = new Map<string, string>();
			el.querySelectorAll<HTMLElement>('[data-node]').forEach((b) => {
				at.set(b.dataset.node!, b.getBoundingClientRect());
				color.set(b.dataset.node!, getComputedStyle(b).getPropertyValue('--st-branch').trim());
			});
			const out: Link[] = [];
			const boxes = [...at.entries()].map(([id, r]) => ({ id, l: r.left - origin.left, r: r.right - origin.left, t: r.top - origin.top, b: r.bottom - origin.top }));
			// A curve that runs through some other skill is left out: the branch label says where it starts.
			const clear = (d: number[], a: string, b: string) => {
				const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = d;
				for (let i = 1; i < 20; i++) {
					const t = i / 20;
					const u = 1 - t;
					const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
					const y = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2;
					if (boxes.some((k) => k.id !== a && k.id !== b && x > k.l - 2 && x < k.r + 2 && y > k.t - 2 && y < k.b + 2)) return false;
				}
				return true;
			};
			const add = (from: string, to: string, p: number[]) => {
				if (clear(p, from, to)) out.push({ from, to, color: color.get(to) ?? '', d: `M${p[0]},${p[1]} C${p[2]},${p[3]} ${p[4]},${p[5]} ${p[6]},${p[7]}` });
			};
			for (const n of nodes) {
				const to = at.get(n.id);
				if (!to) continue;
				for (const r of n.requires) {
					const from = at.get(r);
					if (!from) continue;
					const x1 = from.left + from.width / 2 - origin.left;
					const y1 = from.bottom - origin.top;
					const x2 = to.left + to.width / 2 - origin.left;
					const y2 = to.top - origin.top;
					// Side by side in one row: arc over the top instead of cutting through the buttons.
					if (y2 <= y1) {
						const top = Math.min(from.top, to.top) - origin.top;
						add(r, n.id, [x1, from.top - origin.top, x1, top - 14, x2, top - 14, x2, y2]);
						continue;
					}
					const mid = (y2 - y1) / 2;
					add(r, n.id, [x1, y1, x1, y1 + mid, x2, y2 - mid, x2, y2]);
				}
			}
			setLinks(out);
			setSize({ w: el.scrollWidth, h: el.scrollHeight });
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, deps);
	return { box, links, size };
}
import { ownedNodes, treeBranches, type SkillNode, type SkillTree, type Unlock } from '../../lib/portal/points.ts';

export function SkillTreeView(props: {
	tree: SkillTree;
	nodes: SkillNode[];
	unlocks: Unlock[];
	balance: (code: string) => number;
	tracked: (code: string) => boolean;
	admin: boolean;
	busy: boolean;
	/** How a cost currency is shown (custom trees cost CUSTOM, shown as the currency's code). */
	currencyName?: (code: string) => string;
	/** Just show the tree: no unlock buttons. */
	preview?: boolean;
	onUnlock: (node: string, free: boolean) => Promise<boolean>;
	onRemove: (node: string, refund: boolean) => Promise<boolean>;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const bought = new Map(props.unlocks.map((u) => [u.node_id, u]));
	const owned = ownedNodes(props.nodes, new Set(bought.keys()));
	const byId = new Map(props.nodes.map((n) => [n.id, n]));
	const node = picked ? byId.get(picked) : undefined;

	const state = (n: SkillNode) => (owned.has(n.id) ? 'owned' : n.requires.every((r) => owned.has(r)) ? 'open' : 'locked');
	const name = (code: string | null) => (code ? (props.currencyName?.(code) ?? code) : '');
	const costText = (n: SkillNode) => (n.start ? 'Start' : n.cost_amount === null ? 'Free' : `${n.cost_amount} ${name(n.cost_currency)}`);
	const affordable = (n: SkillNode) => n.cost_amount === null || (props.tracked(n.cost_currency ?? '') && props.balance(n.cost_currency ?? '') >= n.cost_amount);
	const done = (ok: boolean) => ok && setPicked(null);
	const { box, links, size } = useLinks(props.nodes, [props.nodes]);
	const linkState = (l: Link) => (owned.has(l.to) ? 'owned' : owned.has(l.from) ? 'open' : 'locked');
	const near = (l: Link) => picked !== null && (l.from === picked || l.to === picked);
	const ownedCount = props.nodes.filter((n) => owned.has(n.id)).length;

	return (
		<div class={`st${props.preview ? ' st-preview' : ''}`}>
			{!props.preview && props.nodes.length > 0 && (
				<div class="st-progress" aria-label={`${ownedCount} of ${props.nodes.length} skills unlocked`}>
					<span style={{ width: `${(ownedCount / props.nodes.length) * 100}%` }} />
				</div>
			)}
			<div class="st-rows">
				<div class="st-flow" ref={box}>
				<svg class="st-links" width={size.w} height={size.h} aria-hidden="true">
					{links.map((l) => (
						<path key={`${l.from}>${l.to}`} d={l.d} style={l.color ? { '--st-branch': l.color } : undefined} class={`st-link ${linkState(l)}${near(l) ? ' near' : ''}`} />
					))}
				</svg>
				{(() => {
					const branches = treeBranches(props.nodes);
					const draw = (branch: (typeof branches)[number]) => {
						const from = branch.head ? byId.get(branch.head.requires[0] ?? '') : undefined;
						return (
							<div class="st-branch" key={branch.head?.id ?? 'base'} style={branch.color ? { '--st-branch': branch.color } : undefined}>
								{branch.head && (
									<p class="st-branch-name">
										<span>{branch.head.label}</span>
										{from && <small>from {from.label}</small>}
									</p>
								)}
								{branch.rows.map((row, i) => (
									<div class="st-row" key={i}>
										{row.map((n) => {
											const s = state(n);
											return (
												<button
													type="button"
													key={n.id}
													data-node={n.id}
													class={`st-node ${s}${s === 'open' && !affordable(n) ? ' poor' : ''}${picked === n.id ? ' picked' : ''}`}
													aria-pressed={picked === n.id}
													title={n.description || undefined}
													onClick={() => setPicked(picked === n.id ? null : n.id)}
												>
													<span class="st-label">{n.label}</span>
													<span class="st-cost">{s === 'owned' && !props.preview ? '✓ Unlocked' : costText(n)}</span>
												</button>
											);
										})}
									</div>
								))}
							</div>
						);
					};
					const base = branches.filter((b) => !b.head);
					const forks = branches.filter((b) => b.head);
					return (
						<>
							{base.map(draw)}
							{forks.length > 0 && <div class="st-forks">{forks.map(draw)}</div>}
						</>
					);
				})()}
				</div>
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
					{!props.preview && <div class="st-actions">
						{state(node) === 'open' && (
							<>
								{node.cost_amount !== null && !props.tracked(node.cost_currency ?? '') ? (
									<span class="pf-help">{name(node.cost_currency)} isn’t tracked yet. Ask staff to unlock it.</span>
								) : (
									<button type="button" class="pf-button primary" disabled={props.busy || !affordable(node)} onClick={() => props.onUnlock(node.id, false).then(done)}>
										{affordable(node) ? `Unlock for ${costText(node)}` : `Need ${node.cost_amount} ${name(node.cost_currency)} (have ${props.balance(node.cost_currency ?? '')})`}
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
					</div>}
				</div>
			)}
		</div>
	);
}
