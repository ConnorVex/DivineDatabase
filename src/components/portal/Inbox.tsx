// The Inbox page: every decision on what the player sent, with the reason, in one list.
// Opening it marks everything read; what was new stays highlighted until the page is left.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { KIND_LABEL, OUTCOME_TONE, PAGE_SIZE, actionLabel, loadInbox, markAllRead, outcomeLabel, type InboxItem } from '../../lib/portal/inbox.ts';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

function when(iso: string) {
	const d = new Date(iso);
	const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 864e5);
	const time = d.toLocaleTimeString(undefined, { timeStyle: 'short' });
	if (days <= 0) return `Today, ${time}`;
	if (days === 1) return `Yesterday, ${time}`;
	return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const FILTERS: { id: string; label: string; match: (i: InboxItem, fresh: Set<number>) => boolean }[] = [
	{ id: 'all', label: 'All', match: () => true },
	{ id: 'new', label: 'New', match: (i, fresh) => fresh.has(i.id) },
	{ id: 'fix', label: 'Needs correction', match: (i) => i.outcome === 'needs_correction' },
	{ id: 'todo', label: 'To do', match: (i) => i.outcome === 'todo' },
	{ id: 'denied', label: 'Denied', match: (i) => i.outcome === 'denied' },
];

function Message({ item, fresh }: { item: InboxItem; fresh: boolean }) {
	const outcome = outcomeLabel(item);
	const tone = OUTCOME_TONE[item.outcome];
	return (
		<li class={`ib-item tone-${tone}${fresh ? ' fresh' : ''}`}>
			<div class="ib-meta">
				<span class="ib-kind">{KIND_LABEL[item.kind]}</span>
				{fresh && <span class="ib-new">New</span>}
				<time dateTime={item.created_at}>{when(item.created_at)}</time>
			</div>
			<div class="ib-head">
				<div class="ib-title">
					<h3>{item.title || KIND_LABEL[item.kind]}</h3>
					{item.subtitle && <p>{item.subtitle}</p>}
				</div>
				{outcome && <span class="ib-outcome">{outcome}</span>}
			</div>
			{item.body && <p class="ib-body">{item.body}</p>}
			{item.link && (
				<a class={`pf-button${item.outcome === 'needs_correction' || item.outcome === 'todo' ? ' primary' : ' subtle'}`} href={`${base}${item.link}`}>
					{actionLabel(item)}
				</a>
			)}
		</li>
	);
}

export default function Inbox() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [items, setItems] = useState<InboxItem[] | null>(null);
	const [fresh, setFresh] = useState<Set<number>>(new Set());
	const [more, setMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [filter, setFilter] = useState('all');
	const [error, setError] = useState('');

	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p))), []);
	useEffect(() => {
		if (!player) return;
		loadInbox().then(
			(rows) => {
				setItems(rows);
				setMore(rows.length === PAGE_SIZE);
				const unread = new Set(rows.filter((r) => !r.read_at).map((r) => r.id));
				setFresh(unread);
				if (unread.size) setFilter('new');
				if (unread.size) markAllRead().catch((e) => setError(messageOf(e)));
			},
			(e) => setError(messageOf(e)),
		);
	}, [player?.id]);

	const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, items?.filter((i) => f.match(i, fresh)).length ?? 0])), [items, fresh]);

	if (error) return <p class="portal-error">Couldn’t load your inbox: {error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to see your inbox.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
					Log in with Discord
				</button>
			</div>
		);
	if (!items) return <p class="portal-status">Loading your inbox…</p>;

	const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
	const shown = items.filter((i) => active.match(i, fresh));
	const loadOlder = () => {
		setLoadingMore(true);
		loadInbox(items.length).then(
			(rows) => {
				setItems([...items, ...rows]);
				setMore(rows.length === PAGE_SIZE);
				setLoadingMore(false);
			},
			(e) => {
				setError(messageOf(e));
				setLoadingMore(false);
			},
		);
	};

	return (
		<div class="pf ib">
			<p class="pf-help ib-intro">What happened to everything you sent, and why. Messages stay here after they’re read.</p>
			{items.length > 0 && (
				<nav class="pf-nav ib-filters" aria-label="Filter messages">
					{FILTERS.filter((f) => f.id === 'all' || counts[f.id] > 0).map((f) => (
						<a
							key={f.id}
							href={`#${f.id}`}
							class={filter === f.id ? 'active' : undefined}
							aria-current={filter === f.id ? 'true' : undefined}
							onClick={(e) => {
								e.preventDefault();
								setFilter(f.id);
							}}
						>
							{f.label} <span class="mc-count">{counts[f.id]}</span>
						</a>
					))}
				</nav>
			)}
			{items.length === 0 ? (
				<div class="portal-card ib-empty">
					<p>Nothing here yet. When staff or a family owner decides on something you sent, it shows up here with their note.</p>
				</div>
			) : (
				<ul class="ib-list">
					{shown.map((i) => (
						<Message key={i.id} item={i} fresh={fresh.has(i.id)} />
					))}
				</ul>
			)}
			{more && filter === 'all' && (
				<button type="button" class="pf-button subtle ib-more" disabled={loadingMore} onClick={loadOlder}>
					{loadingMore ? 'Loading…' : 'Show older messages'}
				</button>
			)}
		</div>
	);
}
