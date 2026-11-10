// Maximum All For One: the storage tab on the M:AFO Quirk card, Tatsuya's grant box, and the admin queue.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	canGrantMafo,
	cancelMafoRequest,
	decayLeft,
	decideMafo,
	grantMafo,
	inSingularity,
	loadMafo,
	loadMafoHolders,
	loadMafoTargets,
	mafoUsage,
	requestSteal,
	requestTransfer,
	revokeMafo,
	setMafoFree,
	worth,
	type MafoHolder,
	type MafoItem,
	type MafoQueueItem,
	type MafoState,
	type MafoTarget,
} from '../../lib/portal/mafo.ts';
import { SelectField, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One character's M:AFO storage (null while loading, undefined when it has none). */
export function useMafo(characterId: string | null | undefined, cardKey: string) {
	const [state, setState] = useState<MafoState | null | undefined>(null);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		if (!characterId) return setState(undefined);
		let live = true;
		loadMafo(characterId).then(
			(all) => live && setState(all.find((s) => s.card_key === cardKey)),
			() => live && setState(undefined),
		);
		return () => {
			live = false;
		};
	}, [characterId, cardKey, tick]);
	return { state, reload: () => setTick((t) => t + 1) };
}

/** The M:AFO Storage tab: gauges, what's stored, and (for the holder) steal and give. */
export function MafoPanel(props: { characterId: string | null | undefined; cardKey: string; weaker: boolean }) {
	const { state, reload } = useMafo(props.characterId, props.cardKey);
	if (!props.characterId) return <p class="pf-help pf-wide">M:AFO storage opens once Tatsuya grants it on an approved character.</p>;
	if (state === null) return <p class="pf-help pf-wide">Loading storage…</p>;
	if (!state) return <p class="pf-help pf-wide">This card isn’t a granted M:AFO, so it has no storage. Only Tatsuya grants Maximum All For One.</p>;
	const usage = mafoUsage(state);
	const singular = inSingularity(state);
	const stored = state.items.filter((i) => i.status === 'stored');
	const given = state.items.filter((i) => i.status === 'transferred');
	const canAct = state.requests !== null;

	return (
		<div class="mafo pf-wide">
			<div class="mafo-head">
				<span class="mafo-sigil" aria-hidden="true" />
				<div>
					<span class="mafo-kicker">{state.weaker ? 'Weaker M:AFO' : 'Maximum: All For One'}</span>
					<strong>Storage</strong>
				</div>
				{state.capacity.unlimited && <span class="mafo-chip">Infinite Capacity</span>}
				{canAct && state.free_actions && <span class="mafo-chip">No approval needed</span>}
			</div>

			{singular && (
				<p class="mafo-singularity" role="alert">
					<strong>Singularity.</strong> Storage is over capacity: every stat except Intelligence is maxed, and the user dies in 4 turns. Give powers away to get back under.
				</p>
			)}

			<div class="mafo-gauges">
				{usage.map((u) => (
					<div class={`mafo-gauge${u.over ? ' over' : ''}`} key={u.id}>
						<div class="mafo-gauge-top">
							<span>{u.plural}</span>
							<strong>
								{u.used}
								<small> / {state.capacity.unlimited ? '∞' : u.cap}</small>
							</strong>
						</div>
						<div class="mafo-bar" role="progressbar" aria-label={`${u.plural} slots used`} aria-valuemin={0} aria-valuemax={u.cap} aria-valuenow={u.used}>
							<span style={{ width: `${state.capacity.unlimited ? 0 : Math.min(100, (u.used / Math.max(1, u.cap)) * 100)}%` }} />
						</div>
					</div>
				))}
			</div>
			<p class="pf-help">
				{state.weaker
					? 'Stolen Abilities decay after 3 RP (1 RP is a day). A Weaker M:AFO has no upgrades.'
					: state.capacity.stableSince
						? 'Ability Stabilization: stolen Abilities no longer decay. MQP from steals is spent on the Skill Tree tab.'
						: `Stolen Abilities decay after ${state.capacity.decayRp} RP (1 RP is a day). MQP from steals is spent on the Skill Tree tab.`}
			</p>

			<h4 class="pf-subhead">Stored</h4>
			{stored.length ? (
				<ul class="mafo-items">
					{stored.map((i) => (
						<StoredItem key={i.id} item={i} state={state} holder={props.characterId!} canAct={canAct} onDone={reload} />
					))}
				</ul>
			) : (
				<p class="pf-empty">Nothing stored yet.</p>
			)}

			{canAct && <StealBox holder={props.characterId} state={state} onDone={reload} />}

			{canAct && state.requests!.length > 0 && (
				<>
					<h4 class="pf-subhead">Requests</h4>
					<ul class="mafo-requests">
						{state.requests!.map((r) => (
							<li key={r.id} class={`mafo-req ${r.status}`}>
								<span class="mafo-req-status">{r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Done' : 'Denied'}</span>
								<span class="mafo-req-what">
									{r.action === 'steal' ? (
										<>
											Steal <strong>{r.card_name ?? 'a card'}</strong> from {r.victim_name ?? 'someone'}
										</>
									) : (
										<>
											Give <strong>{r.item_name ?? 'a power'}</strong> to {r.target_name ?? 'someone'}
										</>
									)}
									{r.status === 'denied' && r.reason && <em> · {r.reason}</em>}
								</span>
								{r.status === 'pending' && (
									<button type="button" class="pf-button subtle" onClick={() => cancelMafoRequest(r.id).then(reload)}>
										Withdraw
									</button>
								)}
							</li>
						))}
					</ul>
				</>
			)}

			{given.length > 0 && (
				<details class="mafo-given">
					<summary>Given away ({given.length})</summary>
					<ul>
						{given.map((i) => (
							<li key={i.id}>
								<strong>{i.name}</strong> to {i.transferred_to ?? 'someone'}
								{i.transferred_at && ` · ${day(i.transferred_at)}`}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

function StoredItem(props: { item: MafoItem; state: MafoState; holder: string; canAct: boolean; onDone: () => void }) {
	const { item: i, state } = props;
	const [giving, setGiving] = useState(false);
	const left = decayLeft(i, state.capacity);
	const locked = i.decayed ? 'Decayed' : i.kind === 'conduit' && !state.capacity.conduitTransfer ? 'Needs Conduit Transference to give' : null;
	return (
		<li class={`mafo-item mafo-${i.kind}${i.decayed ? ' decayed' : ''}`}>
			<div class="mafo-item-main">
				<strong>{i.name}</strong>
				<span class="mafo-item-meta">
					{worth(i, !state.weaker)} · from {i.source_name || 'unknown'} · {day(i.stolen_at)}
				</span>
				{left && <span class="mafo-decay">Decays: {left}</span>}
				{i.decayed && <span class="mafo-decay gone">Decayed</span>}
			</div>
			{props.canAct && !giving && (
				<button type="button" class="pf-button" disabled={Boolean(locked)} title={locked ?? undefined} onClick={() => setGiving(true)}>
					Give…
				</button>
			)}
			{giving && <GiveBox item={i} holder={props.holder} state={state} onClose={() => setGiving(false)} onDone={props.onDone} />}
		</li>
	);
}

/** Loads who can be stolen from or given to, once, when a form opens. */
function useTargets(on: boolean) {
	const [targets, setTargets] = useState<MafoTarget[] | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		if (!on || targets) return;
		loadMafoTargets().then(setTargets, (e) => setError(messageOf(e)));
	}, [on]);
	return { targets, error };
}

function GiveBox(props: { item: MafoItem; holder: string; state: MafoState; onClose: () => void; onDone: () => void }) {
	const { targets, error } = useTargets(true);
	const [target, setTarget] = useState('');
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState(error);
	const free = Boolean(props.state.free_actions);
	async function send() {
		setBusy(true);
		setMsg('');
		try {
			const r = await requestTransfer(props.holder, props.state.card_key, props.item.id, target, note.trim());
			props.onDone();
			if (r.status === 'approved') props.onClose();
			else setMsg('Sent to the admins.');
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div class="mafo-form">
			<div class="pf-grid">
				<SelectField
					label="Give it to"
					value={target}
					placeholder={targets ? 'Pick a character…' : 'Loading…'}
					options={(targets ?? []).filter((t) => t.id !== props.holder).map((t) => ({ value: t.id, label: t.owner ? `${t.name} (${t.owner})` : t.name }))}
					onChange={setTarget}
					help="It lands on their sheet as an extra card, on top of their usual limit."
				/>
				<TextField label="Note" value={note} placeholder="Optional: the RP where it happened" onInput={setNote} />
			</div>
			<div class="pw-actions">
				<button type="button" class="pf-button primary" disabled={busy || !target} onClick={send}>
					{free ? `Give ${props.item.name}` : 'Ask to give it'}
				</button>
				<button type="button" class="pf-button subtle" onClick={props.onClose}>
					Cancel
				</button>
				{(msg || error) && (
					<span class="pf-help" role="status">
						{msg || error}
					</span>
				)}
			</div>
		</div>
	);
}

function StealBox(props: { holder: string; state: MafoState; onDone: () => void }) {
	const [open, setOpen] = useState(false);
	const { targets, error } = useTargets(open);
	const [victim, setVictim] = useState('');
	const [card, setCard] = useState('');
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const free = Boolean(props.state.free_actions);
	const them = targets?.find((t) => t.id === victim);
	const picked = them?.cards.find((c) => c.key === card);
	const fits = useMemo(() => {
		if (!picked?.kind || props.state.capacity.unlimited) return true;
		const u = mafoUsage(props.state).find((x) => x.id === picked.kind)!;
		return u.used + (picked.slots ?? 0) <= u.cap;
	}, [picked, props.state]);

	async function send() {
		setBusy(true);
		setMsg('');
		try {
			const r = await requestSteal(props.holder, props.state.card_key, victim, card, note.trim());
			setMsg(r.status === 'approved' ? `Stole ${picked?.name}.` : 'Sent to the admins. It happens when one approves it.');
			setCard('');
			setNote('');
			props.onDone();
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	if (!open)
		return (
			<button type="button" class="pf-button primary mafo-steal-open" onClick={() => setOpen(true)}>
				Steal a power…
			</button>
		);
	return (
		<fieldset class="sys-group pf-wide mafo-form">
			<legend>Steal a power</legend>
			<p class="pf-help">
				{free
					? 'Tatsuya lets this M:AFO act without approval: the steal happens right away.'
					: 'An admin approves every steal. Once they do, the card leaves the other character’s sheet and lands in storage.'}
			</p>
			<div class="pf-grid">
				<SelectField
					label="From"
					value={victim}
					placeholder={targets ? 'Pick a character…' : 'Loading…'}
					options={(targets ?? [])
						.filter((t) => t.id !== props.holder && t.cards.length)
						.map((t) => ({ value: t.id, label: t.owner ? `${t.name} (${t.owner})` : t.name }))}
					onChange={(v) => (setVictim(v), setCard(''))}
				/>
				<SelectField
					label="Which power"
					value={card}
					disabled={!them}
					placeholder="Pick a card…"
					options={(them?.cards ?? []).map((c) => ({ value: c.key, label: c.error ? `${c.system === 'infamous' ? 'Conduit' : 'Card'}: ${c.error}` : `${c.name} · ${worth(c, !props.state.weaker)}`, disabled: Boolean(c.error) }))}
					onChange={setCard}
					help={picked && !fits ? 'This goes over capacity: Singularity.' : undefined}
				/>
				<TextField label="Note" value={note} placeholder="Optional: the RP where it happened" onInput={setNote} />
			</div>
			<div class="pw-actions">
				<button type="button" class="pf-button primary" disabled={busy || !picked || Boolean(picked.error)} onClick={send}>
					{free ? 'Steal it' : 'Ask to steal it'}
				</button>
				<button type="button" class="pf-button subtle" onClick={() => setOpen(false)}>
					Close
				</button>
				{(msg || error) && (
					<span class="pf-help" role="status">
						{msg || error}
					</span>
				)}
			</div>
		</fieldset>
	);
}

/** Tatsuya only: grant M:AFO (Full or Weaker), let it act without approval, or take it away. */
export function MafoAdmin({ characterId }: { characterId: string }) {
	const [allowed, setAllowed] = useState(false);
	const [holders, setHolders] = useState<MafoHolder[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [confirm, setConfirm] = useState(false);
	const load = () => loadMafoHolders().then(setHolders, (e) => setMsg(messageOf(e)));
	useEffect(() => {
		canGrantMafo().then((ok) => {
			setAllowed(ok);
			if (ok) load();
		});
	}, []);
	if (!allowed || !holders) return null;
	const mine = holders.find((h) => h.character_id === characterId);
	const weakerCount = holders.filter((h) => h.weaker).length;

	async function run(fn: () => Promise<void>, done: string) {
		setBusy(true);
		setMsg('');
		try {
			await fn();
			await load();
			setMsg(done);
			setConfirm(false);
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class="ov-pillar mafo-admin">
			<h4 class="pf-subhead">Maximum All For One</h4>
			{mine ? (
				<>
					<p class="pf-help">
						Has {mine.weaker ? 'a Weaker' : 'the Full'} M:AFO since {day(mine.granted_at)}. Only you see this.
					</p>
					<label class="mafo-toggle">
						<input type="checkbox" checked={mine.free_actions} disabled={busy} onChange={(e) => run(() => setMafoFree(characterId, mine.card_key, e.currentTarget.checked), e.currentTarget.checked ? 'Steals and gives now skip approval.' : 'Steals and gives need approval again.')} />
						<span>Steal and give without approval</span>
					</label>
					<div class="ov-pillar-row">
						{confirm ? (
							<>
								<span class="pf-help">Takes the card and its storage away. Powers already given stay where they are.</span>
								<button type="button" class="pf-button danger" disabled={busy} onClick={() => run(() => revokeMafo(characterId, mine.card_key), 'M:AFO taken away.')}>
									Take it away
								</button>
								<button type="button" class="pf-button subtle" onClick={() => setConfirm(false)}>
									Keep it
								</button>
							</>
						) : (
							<button type="button" class="pf-button subtle" onClick={() => setConfirm(true)}>
								Take M:AFO away…
							</button>
						)}
					</div>
				</>
			) : (
				<>
					<p class="pf-help">Adds the M:AFO Quirk card to this character, approved sheet included, on top of their card limit. Only you see this.</p>
					<div class="ov-pillar-row">
						<button type="button" class="pf-button primary" disabled={busy} onClick={() => run(() => grantMafo(characterId, false), 'Granted Maximum All For One.')}>
							Grant M:AFO
						</button>
						<button type="button" class="pf-button" disabled={busy || weakerCount >= 2} title={weakerCount >= 2 ? 'There are already 2 Weaker M:AFOs.' : undefined} onClick={() => run(() => grantMafo(characterId, true), 'Granted a Weaker M:AFO.')}>
							Grant a Weaker M:AFO ({weakerCount}/2)
						</button>
					</div>
				</>
			)}
			{msg && (
				<p class="pf-help" role="status">
					{msg}
				</p>
			)}
		</div>
	);
}

/** The admin inbox's M:AFO queue: every steal and give waiting for approval. */
export function MafoQueue(props: { items: MafoQueueItem[]; onDone: () => void }) {
	if (!props.items.length) return <p class="pf-empty">No M:AFO requests waiting. 🎉</p>;
	return (
		<div class="mafo-queue">
			<p class="pf-intro">Approving does it now: a steal takes the card off the other character’s approved sheet into storage, and a give adds the power to the target as an extra card.</p>
			{props.items.map((r) => (
				<QueueRow key={r.id} r={r} onDone={props.onDone} />
			))}
		</div>
	);
}

function QueueRow({ r, onDone }: { r: MafoQueueItem; onDone: () => void }) {
	const [reason, setReason] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	async function decide(ok: boolean) {
		setBusy(true);
		setMsg('');
		try {
			await decideMafo(r.id, ok, reason.trim());
			onDone();
		} catch (e) {
			setMsg(messageOf(e));
			setBusy(false);
		}
	}
	return (
		<div class="mafo-qrow">
			<div class="mafo-qhead">
				<span class={`mafo-qtag ${r.action}`}>{r.action === 'steal' ? 'Steal' : 'Give'}</span>
				<strong>{r.holder_name}</strong>
				{r.weaker && <span class="mafo-chip">Weaker</span>}
				<span class="pf-help">{day(r.requested_at)}</span>
			</div>
			<p class="mafo-qwhat">
				{r.action === 'steal' ? (
					<>
						Steal <strong>{r.card?.name ?? 'a card that’s gone'}</strong> {r.card?.kind && `(${worth(r.card, !r.weaker)})`} from <strong>{r.victim_name}</strong>
					</>
				) : (
					<>
						Give <strong>{r.item?.name ?? 'a power'}</strong> {r.item && `(${worth(r.item, false)})`} to <strong>{r.target_name}</strong>
					</>
				)}
			</p>
			{r.note && <p class="mafo-qnote">“{r.note}”</p>}
			<div class="pw-actions">
				<input type="text" class="mafo-reason" aria-label="Reason (shown if denied)" placeholder="Reason, if you deny it" maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
				<button type="button" class="pf-button primary" disabled={busy} onClick={() => decide(true)}>
					Approve
				</button>
				<button type="button" class="pf-button danger" disabled={busy} onClick={() => decide(false)}>
					Deny
				</button>
				{msg && (
					<span class="pf-help" role="status">
						{msg}
					</span>
				)}
			</div>
		</div>
	);
}

/** The character page: what an M:AFO holds, in short. */
export function MafoSummary(props: { characterId: string; cardKey: string }) {
	const { state } = useMafo(props.characterId, props.cardKey);
	if (!state) return null;
	const stored = state.items.filter((i) => i.status === 'stored' && !i.decayed);
	return (
		<div class="wk-power mafo-summary">
			<p class="wk-sub-label">Storage</p>
			<p class="wk-prose">
				{mafoUsage(state)
					.map((u) => `${u.plural} ${u.used}/${state.capacity.unlimited ? '∞' : u.cap}`)
					.join(' · ')}
				{inSingularity(state) && <strong> · Singularity</strong>}
			</p>
			{stored.length > 0 && (
				<ul class="mafo-summary-list">
					{stored.map((i) => (
						<li key={i.id}>
							<strong>{i.name}</strong> <span>{worth(i, false)}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
