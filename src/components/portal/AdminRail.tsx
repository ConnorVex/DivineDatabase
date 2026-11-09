// The admin panel's side rail: the review inbox queues with their counts, then Players
// (rolls, codes, roll bans and grants). On narrow screens it becomes a row of chips.
import { useEffect, useRef } from 'preact/hooks';

export interface RailItem<K extends string> {
	id: K;
	label: string;
	icon: string;
	/** Waiting items; nothing is shown for undefined. */
	count?: number;
}

export function AdminRail<K extends string>(props: { inbox: RailItem<K>[]; tools: RailItem<K>[]; active: K; onPick: (id: K) => void }) {
	const activeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		activeRef.current?.scrollIntoView({ inline: 'nearest', behavior: 'smooth', block: 'nearest' });
	}, [props.active]);

	const item = (it: RailItem<K>) => (
		<li key={it.id}>
			<button
				ref={props.active === it.id ? activeRef : undefined}
				type="button"
				class={props.active === it.id ? 'active' : undefined}
				aria-current={props.active === it.id ? 'page' : undefined}
				onClick={() => props.onPick(it.id)}
			>
				<span class="adm-icon" aria-hidden="true">
					{it.icon}
				</span>
				<span class="adm-label">{it.label}</span>
				{it.count !== undefined && <span class={`adm-count${it.count ? ' due' : ''}`}>{it.count}</span>}
			</button>
		</li>
	);
	return (
		<nav class="adm-rail" aria-label="Admin panel">
			<p class="adm-heading">Inbox</p>
			<ul>{props.inbox.map(item)}</ul>
			<p class="adm-heading">Manage</p>
			<ul>{props.tools.map(item)}</ul>
		</nav>
	);
}
