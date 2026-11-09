// The optional custom skill tree on a system card: its name, what it costs (the card's own points or a
// custom currency with rates staff approve), and its skills with what each one needs.
// Enhanced with an interactive, fluid Miro-like node graph canvas with dynamic connections,
// freeform positioning toggle, auto-align tier layout, customizable node shapes (rect, diamond, hexagon, circle),
// group areas / frames with multi-node drag, child-friendly intuitive error explanations with loop cycle detection,
// and complete live synchronization of custom tree titles, currencies, and descriptions.
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import {
	blankTree,
	cardCurrencyCodes,
	CUSTOM,
	customTreeNodes,
	MAX_NODES,
	newNodeId,
	treeCurrencyLabel,
	treeProblems,
	type CustomTree,
	type CustomTreeNode,
} from '../../lib/portal/customTree.ts';
import type { SystemEntry } from '../../lib/portal/sheet.ts';
import { NumberField, SelectField, TextArea, TextField } from './fields.tsx';
import { SkillTreeView } from './SkillTreeView.tsx';

export type NodeShape = 'rect' | 'diamond' | 'hexagon' | 'circle';

export interface VisualTreeNode extends CustomTreeNode {
	x?: number;
	y?: number;
	shape?: NodeShape;
	group?: string;
	groupColor?: string;
}

export const GROUP_COLORS = [
	{ id: 'blue', name: 'Blue', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
	{ id: 'green', name: 'Green', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
	{ id: 'purple', name: 'Purple', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)' },
	{ id: 'amber', name: 'Amber', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
	{ id: 'crimson', name: 'Crimson', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
	{ id: 'cyan', name: 'Cyan', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)' },
];

function getNodeDimensions(shape?: NodeShape): { width: number; height: number } {
	switch (shape) {
		case 'diamond':
			return { width: 165, height: 165 };
		case 'hexagon':
			return { width: 185, height: 115 };
		case 'circle':
			return { width: 135, height: 135 };
		case 'rect':
		default:
			return { width: 220, height: 110 };
	}
}

/** Detects nodes that participate in circular dependency cycles. */
function findCycleNodes(nodes: VisualTreeNode[]): string[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const visited = new Set<string>();
	const stack = new Set<string>();
	const cycleNodes = new Set<string>();

	function dfs(id: string, path: string[]) {
		if (stack.has(id)) {
			const idx = path.indexOf(id);
			if (idx !== -1) {
				for (let i = idx; i < path.length; i++) cycleNodes.add(path[i]);
			}
			return;
		}
		if (visited.has(id)) return;

		visited.add(id);
		stack.add(id);
		path.push(id);

		const node = byId.get(id);
		if (node?.requires) {
			for (const reqId of node.requires) {
				dfs(reqId, path);
			}
		}

		path.pop();
		stack.delete(id);
	}

	for (const n of nodes) {
		if (!visited.has(n.id)) {
			dfs(n.id, []);
		}
	}

	return Array.from(cycleNodes);
}

/** Converts raw validation errors into clear, friendly explanations a child can understand. */
function parseFriendlyProblems(
	problems: string[],
	tree: CustomTree,
): { title: string; explanation: string; tip: string; isCycle?: boolean; cycleNodes?: string[] }[] {
	const nodes = tree.nodes as VisualTreeNode[];
	const cycleIds = findCycleNodes(nodes);
	const cycleNames = cycleIds.map((id) => nodes.find((n) => n.id === id)?.label || 'Unnamed').filter(Boolean);

	return problems.map((raw) => {
		if (raw.includes('circle') || raw.includes('loop')) {
			return {
				title: 'Endless Loop Detected! 🔄',
				explanation:
					cycleNames.length > 0
						? `These skills are stuck in an endless circle waiting for each other: ${cycleNames.map((n) => `“${n}”`).join(' ⇄ ')}. A skill can't unlock itself or require its own child!`
						: `Skills cannot require each other in an endless circle. A skill cannot be its own grandpa!`,
				tip: `Choose which skill characters learn first, and disconnect the loop between them.`,
				isCycle: true,
				cycleNodes: cycleIds,
			};
		}
		if (raw.includes('name the custom skill tree')) {
			return {
				title: 'Your Skill Tree Needs a Name! 📝',
				explanation: `Every custom skill tree needs a title at the top so everyone knows what power path this is.`,
				tip: `Enter a name in the "Tree name" field at the top (e.g. "Flame Mastery" or "Commune Arts").`,
			};
		}
		if (raw.includes('add at least one skill to unlock')) {
			return {
				title: 'No Skills to Unlock Yet! 🌱',
				explanation: `Your tree only has the starting point right now! Characters need skills they can spend points to learn.`,
				tip: `Click "＋ Add Skill Node" on the toolbar to create your first unlockable skill.`,
			};
		}
		if (raw.includes('at most')) {
			return {
				title: 'Skill Tree is Full! 📦',
				explanation: `A custom skill tree can have at most 60 skills total.`,
				tip: `Remove a few skills so the tree stays balanced and easy to read.`,
			};
		}
		if (raw.includes('missing its name')) {
			return {
				title: 'Unnamed Skill Found ❓',
				explanation: `One of your skills has a blank name. Every skill needs a title so players know what it is called.`,
				tip: `Click on the unnamed skill card on the canvas and type a title in the inspector.`,
			};
		}
		if (raw.includes('requires a skill that isn’t on the tree')) {
			return {
				title: 'Broken Connection Line ⛓️',
				explanation: `A skill is trying to require another skill that was deleted or removed from the tree.`,
				tip: `Click on the skill and remove the missing prerequisite in the inspector.`,
			};
		}
		if (raw.includes('needs a cost from 0 to 10000')) {
			return {
				title: 'Point Cost Needs Fixing 💰',
				explanation: raw,
				tip: `Enter a number between 0 and 10,000 points (enter 0 if it unlocks for free once reached).`,
			};
		}
		if (raw.includes('name the custom currency')) {
			return {
				title: 'Name Your Custom Points 🏷️',
				explanation: `You chose a custom currency, but it needs a name so people know what points they are earning!`,
				tip: `Enter a name in "Currency name" above (e.g. "Mana" or "Wisp Points").`,
			};
		}
		if (raw.includes('short code of 1 to 6 letters')) {
			return {
				title: 'Need a Short Code (1-6 Letters) 🔤',
				explanation: `Your custom currency needs a 1 to 6 letter abbreviation so it fits on skill badges (like WP or MP).`,
				tip: `Type a short uppercase code under "Short code" above.`,
			};
		}
		if (raw.includes('earns 0 to 50')) {
			return {
				title: 'Session Earnings Out of Range ⏳',
				explanation: `Characters can only earn between 0 and 50 points per approved roleplay session.`,
				tip: `Set "Earned per session" to a number between 0 and 50.`,
			};
		}
		if (raw.includes('both sides of the conversion')) {
			return {
				title: 'Conversion Rates Need to Be at Least 1 ⚖️',
				explanation: `Points cannot be converted for 0.`,
				tip: `Make sure both conversion amounts are 1 or higher.`,
			};
		}
		if (raw.includes('needs a way to earn it')) {
			return {
				title: 'How Do Characters Earn Points? 🎯',
				explanation: `Players need a way to get these custom points, otherwise no one can ever unlock any skills!`,
				tip: `Set points earned per session or set up a conversion from your system points.`,
			};
		}
		return {
			title: 'Check This Requirement ⚠️',
			explanation: raw,
			tip: `Update the setting indicated above to make your skill tree valid.`,
		};
	});
}

/** Computes clean hierarchical tiers and positions nodes evenly across rows. */
function autoAlignNodes(nodes: VisualTreeNode[]): VisualTreeNode[] {
	if (nodes.length === 0) return [];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const depths = new Map<string, number>();

	function getDepth(id: string, visited: Set<string> = new Set()): number {
		if (depths.has(id)) return depths.get(id)!;
		if (visited.has(id)) return 0;
		visited.add(id);
		const n = byId.get(id);
		if (!n || n.start || !n.requires || n.requires.length === 0) {
			depths.set(id, 0);
			return 0;
		}
		let maxReq = 0;
		for (const reqId of n.requires) {
			if (byId.has(reqId)) {
				maxReq = Math.max(maxReq, getDepth(reqId, new Set(visited)) + 1);
			}
		}
		depths.set(id, maxReq);
		return maxReq;
	}

	for (const n of nodes) {
		getDepth(n.id);
	}

	const tiers = new Map<number, VisualTreeNode[]>();
	for (const n of nodes) {
		const d = depths.get(n.id) ?? 0;
		if (!tiers.has(d)) tiers.set(d, []);
		tiers.get(d)!.push(n);
	}

	const sortedTiers = Array.from(tiers.keys()).sort((a, b) => a - b);
	const startY = 90;
	const rowGap = 165;
	const colSpacing = 240;
	const maxNodesInRow = Math.max(...Array.from(tiers.values()).map((row) => row.length), 1);
	const canvasCenterX = Math.max(500, (maxNodesInRow * colSpacing) / 2 + 80);

	const updatedNodes: VisualTreeNode[] = [];
	for (const tierIdx of sortedTiers) {
		const row = tiers.get(tierIdx)!;
		const rowWidth = (row.length - 1) * colSpacing;
		const rowStartX = canvasCenterX - rowWidth / 2;
		const y = startY + tierIdx * rowGap;

		row.forEach((node, colIdx) => {
			const { width } = getNodeDimensions(node.shape);
			const x = Math.max(40, rowStartX + colIdx * colSpacing - width / 2);
			updatedNodes.push({
				...node,
				x: Math.round(x / 10) * 10,
				y: Math.round(y / 10) * 10,
			});
		});
	}

	return updatedNodes;
}

/** Calculates smooth cubic Bézier SVG curve path between two rectangular bounding boxes. */
function getConnectionPathBetween(
	pBox: { x: number; y: number; width: number; height: number },
	cBox: { x: number; y: number; width: number; height: number },
): string {
	const px = pBox.x;
	const py = pBox.y;
	const cx = cBox.x;
	const cy = cBox.y;

	const pCenterX = px + pBox.width / 2;
	const pCenterY = py + pBox.height / 2;
	const cCenterX = cx + cBox.width / 2;
	const cCenterY = cy + cBox.height / 2;

	let startX: number;
	let startY: number;
	let endX: number;
	let endY: number;

	if (cCenterY >= py + pBox.height - 10) {
		startX = pCenterX;
		startY = py + pBox.height;
		endX = cCenterX;
		endY = cy;
	} else if (cCenterY <= py + 10) {
		startX = pCenterX;
		startY = py;
		endX = cCenterX;
		endY = cy + cBox.height;
	} else if (cCenterX >= px + pBox.width) {
		startX = px + pBox.width;
		startY = pCenterY;
		endX = cx;
		endY = cCenterY;
	} else {
		startX = px;
		startY = pCenterY;
		endX = cx + cBox.width;
		endY = cCenterY;
	}

	const dy = endY - startY;
	const dx = endX - startX;

	let c1x: number;
	let c1y: number;
	let c2x: number;
	let c2y: number;

	if (Math.abs(dy) >= Math.abs(dx)) {
		const controlOffsetY = Math.max(30, Math.abs(dy) * 0.45);
		c1x = startX;
		c1y = startY + (dy >= 0 ? controlOffsetY : -controlOffsetY);
		c2x = endX;
		c2y = endY - (dy >= 0 ? controlOffsetY : -controlOffsetY);
	} else {
		const controlOffsetX = Math.max(30, Math.abs(dx) * 0.45);
		c1x = startX + (dx >= 0 ? controlOffsetX : -controlOffsetX);
		c1y = startY;
		c2x = endX - (dx >= 0 ? controlOffsetX : -controlOffsetX);
		c2y = endY;
	}

	return `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;
}

/** Calculates smooth cubic Bézier SVG curve path between parent and child nodes. */
function getConnectionPath(p: VisualTreeNode, c: VisualTreeNode): string {
	const pDim = getNodeDimensions(p.shape);
	const cDim = getNodeDimensions(c.shape);
	return getConnectionPathBetween(
		{ x: p.x ?? 80, y: p.y ?? 80, width: pDim.width, height: pDim.height },
		{ x: c.x ?? 80, y: c.y ?? 80, width: cDim.width, height: cDim.height },
	);
}

export function createInitialTree(entry: SystemEntry): CustomTree {
	const base = blankTree(entry);
	const rootNode = base.nodes[0] as VisualTreeNode;
	rootNode.x = 350;
	rootNode.y = 80;
	rootNode.shape = 'rect';

	if (entry.skills && entry.skills.length > 0) {
		entry.skills.forEach((skill, i) => {
			const id = (skill as any).treeNodeId || newNodeId();
			(skill as any).treeNodeId = id;
			const col = i % 3;
			const row = Math.floor(i / 3);
			base.nodes.push({
				id,
				label: skill.name || `Skill #${i + 1}`,
				description: skill.effect || '',
				cost: 5,
				requires: [rootNode.id],
				start: false,
				shape: skill.type === 'ultimate' ? 'diamond' : 'rect',
				x: 350 + (col - 1) * 260,
				y: 240 + row * 150,
			} as VisualTreeNode);
		});
	}
	return base;
}

export function CustomTreeBuilder({
	entry,
	disabled,
	onChange,
}: {
	entry: SystemEntry;
	disabled: boolean;
	onChange: (tree: CustomTree | null) => void;
}) {
	const tree = entry.customTree;

	// UI interactive states
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
	const [groupPositions, setGroupPositions] = useState<Record<string, { x: number; y: number }>>({});
	const [zoom, setZoom] = useState<number>(1);
	const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
	const [freeform, setFreeform] = useState<boolean>(true);
	const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
	const [showProblems, setShowProblems] = useState<boolean>(false);
	const [newGroupName, setNewGroupName] = useState<string>('');
	const [newGroupColor, setNewGroupColor] = useState<string>(GROUP_COLORS[0].color);
	const [showGroupComposer, setShowGroupComposer] = useState<boolean>(false);

	// Dragging state for single node, group frame, or collapsed group node
	const [dragging, setDragging] = useState<{
		mode: 'node' | 'group' | 'collapsed-group';
		id?: string;
		groupName?: string;
		startX: number;
		startY: number;
		origNodes: { id: string; x: number; y: number }[];
		origGroupPos?: { x: number; y: number };
	} | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);

	// Escape key to exit fullscreen workspace
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isFullscreen) {
				setIsFullscreen(false);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [isFullscreen]);

	if (!tree) {
		if (disabled) return null;
		return (
			<div class="ct-empty pf-wide">
				<button type="button" class="pf-button primary" onClick={() => onChange(createInitialTree(entry))}>
					＋ Build a custom skill tree (optional)
				</button>
				<p class="pf-help">
					Design a visual progression map for this power: skills, shapes, costs, groups, and branch connections.
					Staff review it with the character.
				</p>
			</div>
		);
	}

	const set = (fn: (t: CustomTree) => void) => {
		const next: CustomTree = structuredClone(tree);
		fn(next);
		onChange(next);
	};

	const setNode = (id: string, patch: Partial<VisualTreeNode>) => {
		set((t) => {
			const target = t.nodes.find((n) => n.id === id);
			if (target) Object.assign(target, patch);
		});
	};

	// Ensure any node without positions receives auto-aligned coordinates once
	useEffect(() => {
		const rawNodes = tree.nodes as VisualTreeNode[];
		const needsPos = rawNodes.some((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
		if (needsPos) {
			const aligned = autoAlignNodes(rawNodes);
			set((t) => {
				t.nodes = aligned;
			});
		}
	}, [tree.nodes.length]);

	const nodes = tree.nodes as VisualTreeNode[];
	const codes = cardCurrencyCodes(entry);
	const unit = treeCurrencyLabel(tree);
	const rawProblems = treeProblems(tree, entry);
	const friendlyProblems = useMemo(() => parseFriendlyProblems(rawProblems, tree), [rawProblems, tree]);
	const cycleNodeIds = useMemo(() => new Set(findCycleNodes(nodes)), [nodes]);

	const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : null;
	const selectedIndex = selectedNode ? nodes.findIndex((n) => n.id === selectedNode.id) : -1;
	const connectingNode = connectingFromId ? nodes.find((n) => n.id === connectingFromId) : null;

	// Compute Group Frames (Miro-style bounded areas)
	const groupFrames = useMemo(() => {
		const map = new Map<
			string,
			{
				name: string;
				color: string;
				bg: string;
				minX: number;
				minY: number;
				maxX: number;
				maxY: number;
				memberIds: string[];
			}
		>();

		for (const n of nodes) {
			if (!n.group?.trim()) continue;
			const gName = n.group.trim();
			const dims = getNodeDimensions(n.shape);
			const nx = n.x ?? 80;
			const ny = n.y ?? 80;
			const colorDef = GROUP_COLORS.find((c) => c.color === n.groupColor) ?? GROUP_COLORS[0];

			if (!map.has(gName)) {
				map.set(gName, {
					name: gName,
					color: n.groupColor || colorDef.color,
					bg: colorDef.bg,
					minX: nx,
					minY: ny,
					maxX: nx + dims.width,
					maxY: ny + dims.height,
					memberIds: [n.id],
				});
			} else {
				const g = map.get(gName)!;
				g.minX = Math.min(g.minX, nx);
				g.minY = Math.min(g.minY, ny);
				g.maxX = Math.max(g.maxX, nx + dims.width);
				g.maxY = Math.max(g.maxY, ny + dims.height);
				g.memberIds.push(n.id);
			}
		}

		return Array.from(map.values()).map((g) => {
			const memberNodes = nodes.filter((n) => n.group === g.name);
			const totalCost = memberNodes.reduce((sum, n) => sum + (n.start ? 0 : (n.cost || 0)), 0);
			return {
				...g,
				x: Math.round(g.minX - 24),
				y: Math.round(g.minY - 42),
				width: Math.round(g.maxX - g.minX + 48),
				height: Math.round(g.maxY - g.minY + 66),
				totalCost,
			};
		});
	}, [nodes]);

	const existingGroupNames = useMemo(
		() => Array.from(new Set(nodes.map((n) => n.group?.trim()).filter(Boolean) as string[])),
		[nodes],
	);

	// Toggle collapsing a group into a single consolidated node
	const toggleCollapseGroup = (groupName: string) => {
		setCollapsedGroups((prev) => {
			const willCollapse = !prev[groupName];
			if (willCollapse && !groupPositions[groupName]) {
				const frame = groupFrames.find((g) => g.name === groupName);
				if (frame) {
					setGroupPositions((p) => ({ ...p, [groupName]: { x: frame.x, y: frame.y } }));
				}
			}
			return { ...prev, [groupName]: willCollapse };
		});
		setSelectedGroupId(groupName);
		setSelectedId(null);
	};

	// Expansive Miro-style Canvas Dimensions (with automatic scaling for groups & nodes)
	const canvasWidth = Math.max(
		2400,
		...nodes.map((n) => (n.x ?? 80) + 400),
		...groupFrames.map((g) => g.x + g.width + 300),
		...Object.values(groupPositions).map((p) => p.x + 400),
	);
	const canvasHeight = Math.max(
		1600,
		...nodes.map((n) => (n.y ?? 80) + 400),
		...groupFrames.map((g) => g.y + g.height + 300),
		...Object.values(groupPositions).map((p) => p.y + 400),
	);

	// Drag Handlers for Single Node
	const onNodePointerDown = (e: PointerEvent, node: VisualTreeNode) => {
		if (disabled || !freeform) return;
		const target = e.target as HTMLElement;
		if (target.closest('button, input, select, textarea, a, .st-port')) return;

		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		setDragging({
			mode: 'node',
			id: node.id,
			startX: e.clientX,
			startY: e.clientY,
			origNodes: [{ id: node.id, x: node.x ?? 80, y: node.y ?? 80 }],
		});
		setSelectedId(node.id);
		setSelectedGroupId(null);
	};

	// Drag Handlers for Entire Group Frame
	const onGroupPointerDown = (e: PointerEvent, groupName: string) => {
		if (disabled || !freeform) return;
		const target = e.target as HTMLElement;
		if (target.closest('button')) return;

		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const memberNodes = nodes.filter((n) => n.group === groupName);
		setDragging({
			mode: 'group',
			groupName,
			startX: e.clientX,
			startY: e.clientY,
			origNodes: memberNodes.map((n) => ({ id: n.id, x: n.x ?? 80, y: n.y ?? 80 })),
		});
		setSelectedGroupId(groupName);
		setSelectedId(null);
	};

	// Drag Handlers for Collapsed Group Node
	const onCollapsedGroupPointerDown = (
		e: PointerEvent,
		groupName: string,
		pos: { x: number; y: number },
		memberNodes: VisualTreeNode[],
	) => {
		if (disabled || !freeform) return;
		const target = e.target as HTMLElement;
		if (target.closest('button, input, select, textarea, a, .st-port')) return;

		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		setDragging({
			mode: 'collapsed-group',
			groupName,
			startX: e.clientX,
			startY: e.clientY,
			origGroupPos: { ...pos },
			origNodes: memberNodes.map((n) => ({ id: n.id, x: n.x ?? 80, y: n.y ?? 80 })),
		});
		setSelectedGroupId(groupName);
		setSelectedId(null);
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!dragging) return;
		const dx = (e.clientX - dragging.startX) / zoom;
		const dy = (e.clientY - dragging.startY) / zoom;

		if (dragging.mode === 'collapsed-group' && dragging.groupName && dragging.origGroupPos) {
			const newX = Math.max(20, Math.round((dragging.origGroupPos.x + dx) / 10) * 10);
			const newY = Math.max(50, Math.round((dragging.origGroupPos.y + dy) / 10) * 10);
			setGroupPositions((prev) => ({ ...prev, [dragging.groupName!]: { x: newX, y: newY } }));

			// Keep underlying member nodes in sync so expanding keeps the new location
			set((t) => {
				for (const orig of dragging.origNodes) {
					const target = t.nodes.find((n) => n.id === orig.id) as VisualTreeNode | undefined;
					if (target) {
						target.x = Math.max(20, Math.round((orig.x + dx) / 10) * 10);
						target.y = Math.max(50, Math.round((orig.y + dy) / 10) * 10);
					}
				}
			});
			return;
		}

		set((t) => {
			for (const orig of dragging.origNodes) {
				const target = t.nodes.find((n) => n.id === orig.id) as VisualTreeNode | undefined;
				if (target) {
					target.x = Math.max(20, Math.round((orig.x + dx) / 10) * 10);
					target.y = Math.max(50, Math.round((orig.y + dy) / 10) * 10);
				}
			}
		});
	};

	const onPointerUp = (e: PointerEvent) => {
		if (dragging) {
			try {
				(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
			} catch (_) {}
			setDragging(null);
		}
	};

	// Add new skill node
	const handleAddSkill = () => {
		if (tree.nodes.length >= MAX_NODES) return;
		const id = newNodeId();
		const prev = selectedNode ?? nodes[nodes.length - 1];
		const req = prev ? [prev.id] : [];
		const posX = prev?.x !== undefined ? prev.x + 30 : 100 + (nodes.length % 4) * 80;
		const posY = prev?.y !== undefined ? prev.y + 165 : 120 + Math.floor(nodes.length / 4) * 165;
		const nextSkillIndex = tree.nodes.filter((n) => !n.start).length + 1;

		set((t) => {
			t.nodes.push({
				id,
				label: `Skill #${nextSkillIndex}`,
				description: '',
				cost: 5,
				requires: req,
				start: false,
				x: Math.round(posX / 10) * 10,
				y: Math.round(posY / 10) * 10,
				shape: 'rect',
				group: prev?.group,
				groupColor: prev?.groupColor,
			} as VisualTreeNode);
		});
		setSelectedId(id);
	};

	// Auto-align tiers
	const handleAutoAlign = () => {
		const aligned = autoAlignNodes(nodes);
		set((t) => {
			t.nodes = aligned;
		});
	};

	// Break any circular loops
	const handleBreakLoops = () => {
		if (cycleNodeIds.size === 0) return;
		set((t) => {
			for (const n of t.nodes) {
				if (cycleNodeIds.has(n.id)) {
					// Remove requirements that point to other nodes in the cycle
					n.requires = n.requires.filter((r) => !cycleNodeIds.has(r));
				}
			}
		});
	};

	// Ungroup all nodes in a group
	const handleUngroupAll = (groupName: string) => {
		set((t) => {
			for (const n of t.nodes as VisualTreeNode[]) {
				if (n.group === groupName) {
					delete n.group;
					delete n.groupColor;
				}
			}
		});
	};

	// Handle linking connection when connectingFromId is active
	const handleNodeClick = (clickedNode: VisualTreeNode) => {
		if (connectingFromId) {
			if (connectingFromId !== clickedNode.id) {
				const hasReq = clickedNode.requires.includes(connectingFromId);
				setNode(clickedNode.id, {
					requires: hasReq
						? clickedNode.requires.filter((r) => r !== connectingFromId)
						: [...clickedNode.requires, connectingFromId],
				});
			}
			setConnectingFromId(null);
			setSelectedId(clickedNode.id);
			return;
		}
		setSelectedId(clickedNode.id);
	};

	// Other nodes that can be added as prerequisites
	const eligiblePrereqs = selectedNode
		? nodes.filter((n) => n.id !== selectedNode.id && !selectedNode.requires.includes(n.id))
		: [];

	// Total points cost of all non-root skills across entire tree
	const totalTreeCost = useMemo(() => {
		return nodes.reduce((sum, n) => sum + (n.start ? 0 : (n.cost || 0)), 0);
	}, [nodes]);

	// Dynamic SVG Connections (supports collapsed groups and individual nodes)
	const connectionPaths = useMemo(() => {
		const paths: Array<{
			key: string;
			d: string;
			isSelected: boolean;
			isConnecting: boolean;
			isCycle: boolean;
		}> = [];
		const drawnKeys = new Set<string>();

		for (const child of nodes) {
			for (const reqId of child.requires) {
				const parent = nodes.find((n) => n.id === reqId);
				if (!parent) continue;

				const parentGroup = parent.group?.trim();
				const childGroup = child.group?.trim();
				const parentCollapsed = !!(parentGroup && collapsedGroups[parentGroup]);
				const childCollapsed = !!(childGroup && collapsedGroups[childGroup]);

				// If both are inside the same collapsed group, suppress internal connection line
				if (parentCollapsed && childCollapsed && parentGroup === childGroup) {
					continue;
				}

				let parentBox: { x: number; y: number; width: number; height: number };
				let childBox: { x: number; y: number; width: number; height: number };
				let startKey = parent.id;
				let endKey = child.id;

				if (parentCollapsed && parentGroup) {
					const frame = groupFrames.find((g) => g.name === parentGroup);
					const pos = groupPositions[parentGroup] ?? { x: frame?.x ?? 80, y: frame?.y ?? 80 };
					parentBox = { x: pos.x, y: pos.y, width: 240, height: 115 };
					startKey = `group:${parentGroup}`;
				} else {
					const pDim = getNodeDimensions(parent.shape);
					parentBox = { x: parent.x ?? 80, y: parent.y ?? 80, width: pDim.width, height: pDim.height };
				}

				if (childCollapsed && childGroup) {
					const frame = groupFrames.find((g) => g.name === childGroup);
					const pos = groupPositions[childGroup] ?? { x: frame?.x ?? 80, y: frame?.y ?? 80 };
					childBox = { x: pos.x, y: pos.y, width: 240, height: 115 };
					endKey = `group:${childGroup}`;
				} else {
					const cDim = getNodeDimensions(child.shape);
					childBox = { x: child.x ?? 80, y: child.y ?? 80, width: cDim.width, height: cDim.height };
				}

				const connKey = `${startKey}->${endKey}`;
				if (drawnKeys.has(connKey)) continue;
				drawnKeys.add(connKey);

				const isSelected = Boolean(
					selectedId === child.id ||
					selectedId === parent.id ||
					(parentGroup && selectedGroupId === parentGroup) ||
					(childGroup && selectedGroupId === childGroup)
				);
				const isConnecting = connectingFromId === parent.id;
				const isCycle = cycleNodeIds.has(child.id) && cycleNodeIds.has(parent.id);
				const pathD = getConnectionPathBetween(parentBox, childBox);

				paths.push({
					key: connKey,
					d: pathD,
					isSelected,
					isConnecting,
					isCycle,
				});
			}
		}

		return paths;
	}, [nodes, groupFrames, collapsedGroups, groupPositions, selectedId, selectedGroupId, connectingFromId, cycleNodeIds]);

	// Name of currency displayed
	const currencyDisplayName =
		tree.currency === CUSTOM
			? tree.custom.name
				? `${tree.custom.name} (${tree.custom.code || 'points'})`
				: tree.custom.code || 'Custom Points'
			: tree.currency;

	return (
		<fieldset class="sys-group pf-wide ct not-content">
			<legend>Custom skill tree</legend>

			{/* Miro-style Visual Canvas & Inspector Container */}
			<div class={`st-canvas-container not-content ${isFullscreen ? 'is-fullscreen' : ''}`}>
				{/* Top Canvas Toolbar Bubble */}
				<div class="st-canvas-toolbar">
					<div class="st-toolbar-left">
						{!disabled && (
							<button
								type="button"
								class="pf-button primary st-btn-sm"
								disabled={nodes.length >= MAX_NODES}
								onClick={handleAddSkill}
							>
								＋ Add Skill
							</button>
						)}
						{!disabled && (
							<button
								type="button"
								class="pf-button st-btn-sm"
								title="Automatically arrange nodes into neat tiers"
								onClick={handleAutoAlign}
							>
								⚡ Auto-Align
							</button>
						)}
						<button
							type="button"
							class={`pf-button st-btn-sm ${freeform ? 'active' : ''}`}
							onClick={() => setFreeform(!freeform)}
							title="Toggle freeform node dragging"
						>
							{freeform ? '✋ Drag: ON' : '🔒 Drag: OFF'}
						</button>

						{!disabled && (
							<button
								type="button"
								class="pf-button st-btn-sm"
								title="Create a new visual group area"
								onClick={() => {
									if (selectedNode) {
										setShowGroupComposer(true);
									} else {
										alert('Select a skill node first to assign it to a new group area.');
									}
								}}
							>
								🏷️ Group Area
							</button>
						)}
					</div>

					<div class="st-toolbar-right">
						{/* Point Cost Selection inside the Bubble */}
						<div class="st-toolbar-currency" title="Choose which currency skills in this tree cost to unlock">
							<label class="st-currency-label" for="st-currency-select">
								🪙 Cost:
							</label>
							<select
								id="st-currency-select"
								class="st-currency-select"
								value={tree.currency}
								disabled={disabled}
								onChange={(e) => set((t) => void (t.currency = e.currentTarget.value))}
							>
								{codes.map((c) => (
									<option key={c} value={c}>
										{c} (Card Points)
									</option>
								))}
								<option value={CUSTOM}>Custom Currency...</option>
							</select>
						</div>

						{friendlyProblems.length > 0 ? (
							<button
								type="button"
								class="st-status-pill warning"
								onClick={() => setShowProblems(!showProblems)}
								title="Click to view issues"
							>
								⚠️ {friendlyProblems.length} {friendlyProblems.length === 1 ? 'issue' : 'issues'}
							</button>
						) : (
							<span class="st-status-pill success">✓ Valid Tree</span>
						)}
						<span class="st-count-pill">
							{nodes.length} / {MAX_NODES} nodes
						</span>
					</div>
				</div>

				{/* Custom Currency Configuration Drawer (when Custom Currency is selected) */}
				{tree.currency === CUSTOM && (
					<div class="st-custom-currency-drawer">
						<div class="st-custom-currency-header">
							<span>⚙️ Custom Currency Setup (Requires Staff Approval)</span>
						</div>
						<div class="ct-currency pf-wide">
							<TextField
								label="Currency name"
								required
								value={tree.custom.name}
								disabled={disabled}
								placeholder="e.g. Wisp Points"
								onInput={(v) => set((t) => void (t.custom.name = v))}
							/>
							<TextField
								label="Short code"
								required
								value={tree.custom.code}
								disabled={disabled}
								placeholder="e.g. WP"
								onInput={(v) =>
									set(
										(t) =>
											void (t.custom.code = v
												.replace(/[^A-Za-z]/g, '')
												.slice(0, 6)
												.toUpperCase()),
									)
								}
							/>
							<NumberField
								label="Earned per session"
								min={0}
								value={tree.custom.gain}
								disabled={disabled}
								help="Per approved training or combat log that used this card."
								onInput={(v) => set((t) => void (t.custom.gain = Math.max(0, Math.floor(v))))}
							/>
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
									<NumberField
										label={tree.custom.convertFrom}
										min={1}
										value={tree.custom.convertFromAmount}
										disabled={disabled}
										onInput={(v) => set((t) => void (t.custom.convertFromAmount = Math.max(1, Math.floor(v))))}
									/>
									<span aria-hidden="true">→</span>
									<NumberField
										label={tree.custom.code || 'Custom'}
										min={1}
										value={tree.custom.convertToAmount}
										disabled={disabled}
										onInput={(v) => set((t) => void (t.custom.convertToAmount = Math.max(1, Math.floor(v))))}
									/>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Child-Friendly Problems Callout */}
				{friendlyProblems.length > 0 && showProblems && (
					<div class="st-problems-box">
						<div class="st-problems-header">
							<span>
								⚠️ Skill Tree Requirements to Fix ({friendlyProblems.length})
							</span>
							<button type="button" class="st-btn-close" onClick={() => setShowProblems(false)}>
								✕
							</button>
						</div>
						<div class="st-problems-list">
							{friendlyProblems.map((prob, i) => (
								<div key={i} class={`st-problem-item ${prob.isCycle ? 'cycle-issue' : ''}`}>
									<div class="st-problem-title">
										<span>{prob.title}</span>
										{prob.isCycle && !disabled && (
											<button
												type="button"
												class="pf-button subtle st-btn-sm st-btn-fix-loop"
												onClick={handleBreakLoops}
											>
												⚡ Disconnect Loop
											</button>
										)}
									</div>
									<p class="st-problem-explanation">{prob.explanation}</p>
									<p class="st-problem-tip">👉 {prob.tip}</p>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Canvas Layout: Board + Inspector */}
				<div class="st-canvas-layout">
					{/* Scrollable Canvas Viewport */}
					<div
						class="st-canvas-scroll"
						ref={scrollRef}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					>
						{/* Live Banner: Tree Name & Currency Indicator */}
						<div class="st-canvas-meta-header">
							<div class="st-meta-titles">
								<span class="st-meta-icon">🌳</span>
								<input
									type="text"
									class="st-meta-name-input"
									value={tree.name}
									disabled={disabled}
									placeholder="Name your skill tree (e.g. Commune Mastery)..."
									onInput={(e) => set((t) => void (t.name = e.currentTarget.value))}
									title="Click to rename your skill tree"
								/>
							</div>
							<div class="st-meta-right">
								<div class="st-meta-currency-tag">
									<span>Currency:</span>
									<strong>{currencyDisplayName}</strong>
								</div>
								<div class="st-zoom-group">
									<button
										type="button"
										class="st-btn-zoom"
										title="Zoom Out"
										disabled={zoom <= 0.5}
										onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}
									>
										－
									</button>
									<button
										type="button"
										class="st-zoom-display"
										title="Reset Zoom to 100%"
										onClick={() => setZoom(1)}
									>
										{Math.round(zoom * 100)}%
									</button>
									<button
										type="button"
										class="st-btn-zoom"
										title="Zoom In"
										disabled={zoom >= 1.5}
										onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.15) * 100) / 100))}
									>
										＋
									</button>
								</div>
								<button
									type="button"
									class={`pf-button st-btn-sm ${isFullscreen ? 'primary active' : ''}`}
									title={isFullscreen ? 'Exit Fullscreen Workspace (Esc)' : 'Expand to Fullscreen Workspace'}
									onClick={() => setIsFullscreen(!isFullscreen)}
								>
									{isFullscreen ? '✕ Exit' : '⛶ Fullscreen'}
								</button>
							</div>
						</div>

						{/* Active Connecting Mode Toast */}
						{connectingFromId && connectingNode && (
							<div class="st-connecting-banner">
								<span>
									🔗 Linking prerequisite from <strong>{connectingNode.label || 'Unnamed'}</strong> — Click target skill to connect
								</span>
								<button
									type="button"
									class="st-connecting-cancel"
									onClick={() => setConnectingFromId(null)}
								>
									Cancel
								</button>
							</div>
						)}

						<div
							class="st-canvas-scaler"
							style={{
								width: `${Math.round(canvasWidth * zoom)}px`,
								height: `${Math.round(canvasHeight * zoom)}px`,
							}}
						>
							<div
								class="st-canvas-board"
								style={{
									width: `${canvasWidth}px`,
									height: `${canvasHeight}px`,
									transform: `scale(${zoom})`,
									transformOrigin: '0 0',
								}}
								onClick={(e) => {
									if (e.target === e.currentTarget) {
										setSelectedId(null);
										setSelectedGroupId(null);
										setConnectingFromId(null);
									}
								}}
							>
								{/* Miro-Style Group Frames (Bounded Areas) */}
								{groupFrames.map((g) => {
									if (collapsedGroups[g.name]) return null;
									return (
										<div
											key={g.name}
											class="st-group-frame"
											style={{
												left: `${g.x}px`,
												top: `${g.y}px`,
												width: `${g.width}px`,
												height: `${g.height}px`,
												borderColor: g.color,
												backgroundColor: g.bg,
											}}
										>
											<div
												class="st-group-frame-tab"
												style={{ background: g.color }}
												title="Drag to move all skills in this group together"
												onPointerDown={(e) => onGroupPointerDown(e, g.name)}
												onClick={() => {
													setSelectedGroupId(g.name);
													setSelectedId(null);
												}}
											>
												<span class="st-group-frame-title">🏷️ {g.name}</span>
												<span class="st-group-frame-count">({g.memberIds.length})</span>
												<button
													type="button"
													class="st-group-frame-collapse-btn"
													title="Collapse group into a single consolidated node"
													onClick={(e) => {
														e.stopPropagation();
														toggleCollapseGroup(g.name);
													}}
												>
													📁
												</button>
												{!disabled && (
													<button
														type="button"
														class="st-group-frame-ungroup"
														title="Ungroup all skills in this area"
														onClick={(e) => {
															e.stopPropagation();
															handleUngroupAll(g.name);
														}}
													>
														✕
													</button>
												)}
											</div>
										</div>
									);
								})}

								{/* Collapsed Group Nodes (Single Consolidated Card with Total Cost) */}
								{groupFrames.map((g) => {
									if (!collapsedGroups[g.name]) return null;
									const memberNodes = nodes.filter((n) => n.group === g.name);
									const pos = groupPositions[g.name] ?? { x: g.x, y: g.y };
									const isSelected = selectedGroupId === g.name;

									return (
										<div
											key={`collapsed-${g.name}`}
											class={`st-node-wrapper shape-rect st-collapsed-group-node ${isSelected ? 'selected' : ''} ${
												freeform && !disabled ? 'draggable' : ''
											} ${dragging?.mode === 'collapsed-group' && dragging.groupName === g.name ? 'dragging' : ''}`}
											style={{
												left: `${pos.x}px`,
												top: `${pos.y}px`,
												width: '240px',
												height: '115px',
											}}
											onPointerDown={(e) => onCollapsedGroupPointerDown(e, g.name, pos, memberNodes)}
											onClick={() => {
												setSelectedGroupId(g.name);
												setSelectedId(null);
											}}
										>
											{/* Top Connector Port */}
											<div class="st-port st-port-in" title="Prerequisite connection point into this group" />

											<div class="st-node-card st-collapsed-card" style={{ borderColor: g.color }}>
												<div class="st-node-header">
													<span
														class="st-badge-cost"
														style={{
															background: `${g.color}30`,
															borderColor: `${g.color}80`,
															color: '#ffffff',
														}}
													>
														📁 {g.memberIds.length} {g.memberIds.length === 1 ? 'skill' : 'skills'}
													</span>
													<button
														type="button"
														class="st-btn-expand-pill"
														title="Expand group to view and edit individual skills"
														onClick={(e) => {
															e.stopPropagation();
															toggleCollapseGroup(g.name);
														}}
													>
														📂 Expand
													</button>
												</div>
												<div class="st-node-title" title={g.name} style={{ color: '#ffffff' }}>
													{g.name}
												</div>
												<div class="st-collapsed-meta">
													<span class="st-cost-pill">🪙 Total: {g.totalCost} {unit}</span>
												</div>
											</div>

											{/* Bottom Output Port (+ to link from this group) */}
											{!disabled && (
												<button
													type="button"
													class={`st-port st-port-out ${connectingFromId && memberNodes.some((m) => m.id === connectingFromId) ? 'active' : ''}`}
													title="Click to link this group as prerequisite for another skill"
													onClick={(e) => {
														e.stopPropagation();
														if (memberNodes[0]) {
															setConnectingFromId(connectingFromId === memberNodes[0].id ? null : memberNodes[0].id);
														}
													}}
												>
													＋
												</button>
											)}
										</div>
									);
								})}

								{/* Dynamic SVG Connections Layer */}
								<svg
									class="st-canvas-svg"
									style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
								>
									<defs>
										<marker
											id="st-arrow-default"
											viewBox="0 0 10 10"
											refX="8"
											refY="5"
											markerWidth="6"
											markerHeight="6"
											orient="auto-start-reverse"
										>
											<path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--sl-color-gray-4)" />
										</marker>
										<marker
											id="st-arrow-active"
											viewBox="0 0 10 10"
											refX="8"
											refY="5"
											markerWidth="6"
											markerHeight="6"
											orient="auto-start-reverse"
										>
											<path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--pf-accent)" />
										</marker>
										<marker
											id="st-arrow-cycle"
											viewBox="0 0 10 10"
											refX="8"
											refY="5"
											markerWidth="6"
											markerHeight="6"
											orient="auto-start-reverse"
										>
											<path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#ef4444" />
										</marker>
									</defs>

									{connectionPaths.map((p) => (
										<path
											key={p.key}
											d={p.d}
											class={`st-canvas-path ${p.isSelected || p.isConnecting ? 'active' : ''} ${
												p.isCycle ? 'cycle' : ''
											}`}
											markerEnd={
												p.isCycle
													? 'url(#st-arrow-cycle)'
													: p.isSelected || p.isConnecting
														? 'url(#st-arrow-active)'
														: 'url(#st-arrow-default)'
											}
										/>
									))}
								</svg>

								{/* Interactive Skill Node Items (Render only non-collapsed nodes) */}
								{nodes.map((node) => {
									if (node.group && collapsedGroups[node.group]) {
										return null;
									}
									const shape = node.shape ?? 'rect';
									const dims = getNodeDimensions(shape);
								const x = node.x ?? 80;
								const y = node.y ?? 80;
								const isSelected = selectedId === node.id;
								const isConnectingOrigin = connectingFromId === node.id;
								const isTargetPrereq = selectedNode ? selectedNode.requires.includes(node.id) : false;
								const isInCycle = cycleNodeIds.has(node.id);

								return (
									<div
										key={node.id}
										class={`st-node-wrapper shape-${shape} ${isSelected ? 'selected' : ''} ${
											isConnectingOrigin ? 'connecting-origin' : ''
										} ${isTargetPrereq ? 'is-prereq' : ''} ${isInCycle ? 'in-cycle' : ''} ${
											freeform && !disabled ? 'draggable' : ''
										} ${dragging?.mode === 'node' && dragging.id === node.id ? 'dragging' : ''}`}
										style={{
											left: `${x}px`,
											top: `${y}px`,
											width: `${dims.width}px`,
											height: `${dims.height}px`,
										}}
										title={
											node.description
												? `${node.label || 'Unnamed'}: ${node.description}`
												: node.label || 'Unnamed Skill'
										}
										onPointerDown={(e) => onNodePointerDown(e, node)}
										onClick={() => handleNodeClick(node)}
									>
										{/* Top Connector Port (Requirements Input) */}
										<div class="st-port st-port-in" title="Prerequisite connection point" />

										{/* Shape: Box Card */}
										{shape === 'rect' && (
											<div class="st-node-card">
												<div class="st-node-header">
													<span class={`st-badge-cost ${node.start ? 'root' : ''}`}>
														{node.start ? '🌱 Root' : `${node.cost} ${unit}`}
													</span>
													{node.group && (
														<span
															class="st-node-group-badge"
															style={{ color: node.groupColor || '#3b82f6' }}
														>
															● {node.group}
														</span>
													)}
													<span class="st-shape-badge">▰</span>
												</div>
												<div class="st-node-title" title={node.label || 'Unnamed Skill'}>
													{node.label || 'Unnamed Skill'}
												</div>
												{node.description ? (
													<div class="st-node-desc" title={node.description}>
														{node.description}
													</div>
												) : (
													<div class="st-node-desc placeholder">No description yet</div>
												)}
											</div>
										)}

										{/* Shape: Diamond */}
										{shape === 'diamond' && (
											<div class="st-diamond-box">
												<div class="st-diamond-content">
													<span class={`st-badge-cost ${node.start ? 'root' : ''}`}>
														{node.start ? '🌱' : `${node.cost} ${unit}`}
													</span>
													<div class="st-node-title" title={node.label || 'Unnamed Skill'}>
														{node.label || 'Unnamed'}
													</div>
													{node.description && (
														<div class="st-diamond-desc" title={node.description}>
															{node.description}
														</div>
													)}
												</div>
											</div>
										)}

										{/* Shape: Hexagon */}
										{shape === 'hexagon' && (
											<div class="st-hex-wrap">
												<svg class="st-hex-bg" viewBox="0 0 180 110" preserveAspectRatio="none">
													<polygon points="25,2 155,2 178,55 155,108 25,108 2,55" />
												</svg>
												<div class="st-hex-content">
													<span class={`st-badge-cost ${node.start ? 'root' : ''}`}>
														{node.start ? '🌱 Root' : `${node.cost} ${unit}`}
													</span>
													<div class="st-node-title" title={node.label || 'Unnamed Skill'}>
														{node.label || 'Unnamed'}
													</div>
													{node.description && (
														<div class="st-hex-desc" title={node.description}>
															{node.description}
														</div>
													)}
												</div>
											</div>
										)}

										{/* Shape: Circle */}
										{shape === 'circle' && (
											<div class="st-circle-card">
												<span class={`st-badge-cost ${node.start ? 'root' : ''}`}>
													{node.start ? '🌱' : `${node.cost} ${unit}`}
												</span>
												<div class="st-node-title" title={node.label || 'Unnamed Skill'}>
													{node.label || 'Unnamed'}
												</div>
												{node.description && (
													<div class="st-circle-desc" title={node.description}>
														{node.description}
													</div>
												)}
											</div>
										)}

										{/* Bottom Output Port (+ to link to another node) */}
										{!disabled && (
											<button
												type="button"
												class={`st-port st-port-out ${isConnectingOrigin ? 'active' : ''}`}
												title="Click to link as prerequisite for another skill"
												onClick={(e) => {
													e.stopPropagation();
													setConnectingFromId(connectingFromId === node.id ? null : node.id);
												}}
											>
												＋
											</button>
										)}
									</div>
								);
							})}
						</div>
					</div>

						<div class="st-canvas-hint">
							<span>✋ Drag nodes or group tabs</span>
							<span>·</span>
							<span>Click ＋ handle to link</span>
						</div>
					</div>

					{/* Node & Group Inspector Drawer */}
					<div class="st-inspector">
						{selectedGroupId ? (
							<div class="st-inspector-content">
								<div class="st-inspector-header">
									<div class="st-inspector-title">
										<span class="st-inspector-icon">📁</span>
										<h3>Group Area</h3>
									</div>
									<button
										type="button"
										class="st-btn-close"
										onClick={() => setSelectedGroupId(null)}
										title="Deselect group"
									>
										✕
									</button>
								</div>

								<div class="st-inspector-body">
									<div class="st-group-summary-card">
										<div class="st-group-summary-header">
											<span
												class="st-group-summary-name"
												style={{ color: groupFrames.find((g) => g.name === selectedGroupId)?.color || '#3b82f6' }}
											>
												🏷️ {selectedGroupId}
											</span>
											<button
												type="button"
												class="pf-button subtle st-btn-sm"
												onClick={() => toggleCollapseGroup(selectedGroupId)}
											>
												{collapsedGroups[selectedGroupId] ? '📂 Expand Group' : '📁 Collapse to Node'}
											</button>
										</div>

										<div class="st-group-cost-box">
											<span class="st-group-cost-label">Total Upgrade Points:</span>
											<strong class="st-group-cost-val">
												{nodes
													.filter((n) => n.group === selectedGroupId)
													.reduce((sum, n) => sum + (n.start ? 0 : (n.cost || 0)), 0)}{' '}
												{unit}
											</strong>
										</div>

										<div class="st-group-members-section">
											<label class="pf-label">
												Member Skills ({nodes.filter((n) => n.group === selectedGroupId).length})
											</label>
											<div class="st-group-members-list">
												{nodes
													.filter((n) => n.group === selectedGroupId)
													.map((m) => (
														<div
															key={m.id}
															class="st-group-member-row"
															onClick={() => {
																setSelectedId(m.id);
																setSelectedGroupId(null);
															}}
															title="Click to inspect this skill"
														>
															<span class="st-member-name">
																{m.start ? '🌱' : '•'} {m.label || 'Unnamed Skill'}
															</span>
															<span class="st-cost-pill">{m.start ? 'Root' : `${m.cost} ${unit}`}</span>
														</div>
													))}
											</div>
										</div>

										{!disabled && (
											<button
												type="button"
												class="pf-button destructive st-btn-sm pf-wide"
												style={{ marginTop: '0.75rem' }}
												onClick={() => {
													handleUngroupAll(selectedGroupId);
													setSelectedGroupId(null);
												}}
											>
												✕ Ungroup All Skills in this Area
											</button>
										)}
									</div>
								</div>
							</div>
						) : selectedNode ? (
							<div class="st-inspector-content">
								<div class="st-inspector-header">
									<div class="st-inspector-title">
										<span class="st-inspector-icon">⚙️</span>
										<h3>Skill #{selectedIndex + 1}</h3>
									</div>
									<button
										type="button"
										class="st-btn-close"
										onClick={() => setSelectedId(null)}
										title="Deselect node"
									>
										✕
									</button>
								</div>

								<div class="st-inspector-body">
									<TextField
										label="Skill name"
										required
										value={selectedNode.label}
										disabled={disabled}
										placeholder="e.g. Diamond Skin"
										onInput={(v) => setNode(selectedNode.id, { label: v })}
									/>

									{/* Node Shape Picker */}
									<div class="st-shape-picker">
										<label class="pf-label">Shape</label>
										<div class="st-shape-options">
											<button
												type="button"
												class={`st-shape-btn ${(!selectedNode.shape || selectedNode.shape === 'rect') ? 'active' : ''}`}
												onClick={() => setNode(selectedNode.id, { shape: 'rect' })}
												title="Box Card"
											>
												<span class="st-shape-glyph">▰</span> Box
											</button>
											<button
												type="button"
												class={`st-shape-btn ${selectedNode.shape === 'diamond' ? 'active' : ''}`}
												onClick={() => setNode(selectedNode.id, { shape: 'diamond' })}
												title="Diamond"
											>
												<span class="st-shape-glyph">◆</span> Diamond
											</button>
											<button
												type="button"
												class={`st-shape-btn ${selectedNode.shape === 'hexagon' ? 'active' : ''}`}
												onClick={() => setNode(selectedNode.id, { shape: 'hexagon' })}
												title="Hexagon"
											>
												<span class="st-shape-glyph">⬡</span> Hex
											</button>
											<button
												type="button"
												class={`st-shape-btn ${selectedNode.shape === 'circle' ? 'active' : ''}`}
												onClick={() => setNode(selectedNode.id, { shape: 'circle' })}
												title="Circle"
											>
												<span class="st-shape-glyph">●</span> Circle
											</button>
										</div>
									</div>

									{/* Group / Area Selector */}
									<div class="st-group-picker">
										<label class="pf-label">Group / Area</label>
										<div class="st-group-select-row">
											<select
												class="pf-select"
												value={selectedNode.group || ''}
												disabled={disabled}
												onChange={(e) => {
													const val = e.currentTarget.value;
													if (val === '__NEW__') {
														setShowGroupComposer(true);
													} else {
														const existingColor = nodes.find((n) => n.group === val)?.groupColor;
														setNode(selectedNode.id, {
															group: val || undefined,
															groupColor: existingColor || (val ? GROUP_COLORS[0].color : undefined),
														});
													}
												}}
											>
												<option value="">None (Ungrouped)</option>
												{existingGroupNames.map((gn) => (
													<option key={gn} value={gn}>
														🏷️ {gn}
													</option>
												))}
												<option value="__NEW__">＋ New Group Area...</option>
											</select>
										</div>

										{showGroupComposer && (
											<div class="st-group-composer">
												<TextField
													label="New Group Name"
													value={newGroupName}
													placeholder="e.g. Offensive Techniques"
													onInput={setNewGroupName}
												/>
												<div class="st-color-swatches">
													{GROUP_COLORS.map((c) => (
														<button
															type="button"
															key={c.id}
															class={`st-color-swatch ${newGroupColor === c.color ? 'active' : ''}`}
															style={{ background: c.color }}
															title={c.name}
															onClick={() => setNewGroupColor(c.color)}
														/>
													))}
												</div>
												<div class="st-composer-actions">
													<button
														type="button"
														class="pf-button primary st-btn-sm"
														disabled={!newGroupName.trim()}
														onClick={() => {
															if (newGroupName.trim()) {
																setNode(selectedNode.id, {
																	group: newGroupName.trim(),
																	groupColor: newGroupColor,
																});
																setNewGroupName('');
																setShowGroupComposer(false);
															}
														}}
													>
														Create Group
													</button>
													<button
														type="button"
														class="pf-button subtle st-btn-sm"
														onClick={() => setShowGroupComposer(false)}
													>
														Cancel
													</button>
												</div>
											</div>
										)}

										{selectedNode.group && (
											<button
												type="button"
												class="pf-button subtle st-btn-sm pf-wide"
												style={{ marginTop: '0.4rem' }}
												onClick={() => toggleCollapseGroup(selectedNode.group!)}
											>
												{collapsedGroups[selectedNode.group]
													? `📂 Expand "${selectedNode.group}" Area`
													: `📁 Collapse "${selectedNode.group}" Area`}
											</button>
										)}
									</div>

									{/* Root / Unlocked Switch */}
									<label class="pf-check st-root-check">
										<input
											type="checkbox"
											checked={selectedNode.start}
											disabled={disabled}
											onChange={(e) =>
												setNode(selectedNode.id, {
													start: e.currentTarget.checked,
													cost: e.currentTarget.checked ? 0 : selectedNode.cost || 5,
												})
											}
										/>
										<span>Starts unlocked (Root Skill)</span>
									</label>

									{!selectedNode.start && (
										<NumberField
											label={`Cost (${unit})`}
											min={0}
											value={selectedNode.cost}
											disabled={disabled}
											help={selectedNode.cost ? undefined : '0 = Free once reachable.'}
											onInput={(v) => setNode(selectedNode.id, { cost: Math.max(0, Math.floor(v)) })}
										/>
									)}

									{/* Prerequisites ("Needs") Manager */}
									<div class="st-inspector-needs">
										<label class="pf-label">Prerequisites ("Needs")</label>
										{selectedNode.requires.length === 0 ? (
											<p class="pf-help">None (available right away).</p>
										) : (
											<div class="st-needs-chips">
												{selectedNode.requires.map((reqId) => {
													const reqNode = nodes.find((n) => n.id === reqId);
													return (
														<span key={reqId} class="st-need-chip">
															<span>{reqNode?.label || 'Unnamed'}</span>
															{!disabled && (
																<button
																	type="button"
																	class="st-need-remove"
																	title="Disconnect prerequisite"
																	onClick={() =>
																		setNode(selectedNode.id, {
																			requires: selectedNode.requires.filter((r) => r !== reqId),
																		})
																	}
																>
																	✕
																</button>
															)}
														</span>
													);
												})}
											</div>
										)}

										{!disabled && eligiblePrereqs.length > 0 && (
											<div class="st-add-prereq">
												<select
													class="pf-select"
													value=""
													onChange={(e) => {
														const val = e.currentTarget.value;
														if (val) {
															setNode(selectedNode.id, {
																requires: [...selectedNode.requires, val],
															});
															e.currentTarget.value = '';
														}
													}}
												>
													<option value="">＋ Connect prerequisite...</option>
													{eligiblePrereqs.map((o) => (
														<option key={o.id} value={o.id}>
															{o.label || 'Unnamed skill'}
														</option>
													))}
												</select>
											</div>
										)}
									</div>

									<TextArea
										label="Skill description"
										rows={3}
										value={selectedNode.description}
										disabled={disabled}
										placeholder="What this skill unlocks or achieves..."
										onInput={(v) => setNode(selectedNode.id, { description: v })}
									/>

									{!disabled && nodes.length > 1 && (
										<button
											type="button"
											class="pf-button subtle st-delete-btn"
											onClick={() => {
												set((t) => {
													t.nodes = t.nodes
														.filter((n) => n.id !== selectedNode.id)
														.map((n) => ({
															...n,
															requires: n.requires.filter((r) => r !== selectedNode.id),
														}));
												});
												setSelectedId(null);
											}}
										>
											🗑️ Remove Skill
										</button>
									)}
								</div>
							</div>
						) : (
							<div class="st-inspector-empty">
								<div class="st-empty-icon">🌳</div>
								<h4>Node Inspector</h4>
								<p class="pf-help">
									Click any skill node on the canvas to edit its name, shape, cost, group, and prerequisites.
								</p>
								<div class="st-empty-stats">
									<div class="st-stat-pill">
										<span>Total Skills</span>
										<strong>{nodes.length}</strong>
									</div>
									<div class="st-stat-pill">
										<span>Groups</span>
										<strong>{groupFrames.length}</strong>
									</div>
									<div class="st-stat-pill">
										<span>Root Skills</span>
										<strong>{nodes.filter((n) => n.start).length}</strong>
									</div>
									<div class="st-stat-pill">
										<span>Tree Cost</span>
										<strong>{totalTreeCost} {unit}</strong>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Footer Actions */}
				{!disabled && (
					<div class="ct-actions">
						<button
							type="button"
							class="pf-button subtle"
							onClick={() => {
								if (confirm('Are you sure you want to delete this custom skill tree?')) {
									onChange(null);
								}
							}}
						>
							Remove custom tree
						</button>
					</div>
				)}
			</div>

			{/* Character Sheet Wiki Preview Accordion */}
			<details class="pts-tree ct-preview">
				<summary>Character Sheet Wiki Preview</summary>
				<div class="ct-preview-header">
					<strong>{tree.name.trim() || 'Custom Skill Tree'}</strong>
					<span class="pf-help">
						{nodes.length} skills · Costs {currencyDisplayName}
					</span>
				</div>
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
