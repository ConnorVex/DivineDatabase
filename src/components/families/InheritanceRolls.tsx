// Manage family → Inheritance: the rolls new characters asked for. The owner rolls (on Discord,
// say), then records how it went here, with a link to the roll.
import { useEffect, useState } from 'preact/hooks';
import type { FamilyBundle } from '../../lib/families/api.ts';
import {
	decideInheritanceAccess,
	decideInheritanceRoll,
	loadFamilyInheritanceRolls,
	loadInheritanceAccessList,
	type AccessRequest,
} from '../../lib/families/inheritanceApi.ts';
import type { InheritanceRoll } from '../../lib/portal/inheritance.ts';
import { messageOf } from './shared.tsx';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const STATE = { pending: 'Waiting', won: 'Got it', lost: 'Missed' } as const;

function RollCard({ r, onDecided }: { r: InheritanceRoll; onDecided: (r: InheritanceRoll) => void }) {
	const [proof, setProof] = useState(r.proof);
	const [note, setNote] = useState(r.note);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [editing, setEditing] = useState(r.status === 'pending');
	const proofBad = proof.trim() !== '' && !/^https:\/\//.test(proof.trim());

	async function decide(won: boolean) {
		setBusy(true);
		setError('');
		try {
			onDecided(await decideInheritanceRoll(r.id, won, proof, note));
			setEditing(false);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<article class={`ih-ask ${r.status}`}>
			<header class="ih-ask-head">
				<div>
					<p class="ih-ask-label">{r.label}</p>
					<p class="pf-help">
						For <strong>{r.character_name || 'an unnamed character'}</strong> · asked {when(r.created_at)}
					</p>
				</div>
				<span class={`ih-ask-state ${r.status}`}>{STATE[r.status]}</span>
			</header>
			{editing ? (
				<div class="ih-ask-form">
					<div class="pf-field">
						<label class="pf-label" for={`ih-proof-${r.id}`}>
							Link to the roll
						</label>
						<input id={`ih-proof-${r.id}`} type="url" value={proof} placeholder="https://discord.com/channels/…" onInput={(e) => setProof(e.currentTarget.value)} />
						{proofBad && <p class="pf-help bad">The link must start with https://</p>}
					</div>
					<div class="pf-field">
						<label class="pf-label" for={`ih-note-${r.id}`}>
							Note
						</label>
						<input id={`ih-note-${r.id}`} value={note} maxLength={500} placeholder="Optional" onInput={(e) => setNote(e.currentTarget.value)} />
					</div>
					<div class="ih-ask-actions">
						{r.status !== 'pending' && (
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => setEditing(false)}>
								Cancel
							</button>
						)}
						<button type="button" class="pf-button" disabled={busy || proofBad} onClick={() => decide(false)}>
							❌ Missed
						</button>
						<button type="button" class="pf-button primary" disabled={busy || proofBad} onClick={() => decide(true)}>
							✅ Got it
						</button>
					</div>
				</div>
			) : (
				<p class="ih-ask-result">
					{r.proof && (
						<a href={r.proof} target="_blank" rel="noreferrer">
							The roll
						</a>
					)}
					{r.note && <span>“{r.note}”</span>}
					<button type="button" class="pf-button subtle" onClick={() => setEditing(true)}>
						Change
					</button>
				</p>
			)}
			{error && <p class="portal-error">{error}</p>}
		</article>
	);
}

const ACCESS = { pending: 'Asking', allowed: 'Let in', declined: 'Declined' } as const;

/** Players asking to see the hidden perks (every perk, when the family is sealed) while they build. */
function AccessList({ b }: { b: FamilyBundle }) {
	const [list, setList] = useState<AccessRequest[] | null>(null);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		loadInheritanceAccessList(b.family.id).then(setList, (e) => setError(messageOf(e)));
	}, [b.family.id]);

	async function decide(r: AccessRequest, allow: boolean | null) {
		setBusy(r.player_id);
		setError('');
		try {
			await decideInheritanceAccess(b.family.id, r.player_id, allow);
			setList((l) =>
				allow === null
					? (l ?? []).filter((x) => x.player_id !== r.player_id)
					: (l ?? []).map((x) => (x.player_id === r.player_id ? { ...x, status: allow ? 'allowed' : 'declined', decided_at: new Date().toISOString() } : x)),
			);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy('');
		}
	}

	const hidden = b.family.sealed || b.perks.some((p) => p.hidden);
	if (!hidden && !list?.length) return null;
	return (
		<>
			<p class="pf-subhead">Asking to see the Inheritance</p>
			<p class="pf-help">
				{b.family.sealed ? 'The family is sealed, so builders' : 'Builders'} only see the hidden perks once you let them in. Members always see them.
			</p>
			{error && <p class="portal-error">{error}</p>}
			{list && list.length === 0 && <p class="pf-empty">Nobody is asking.</p>}
			<div class="ih-asks">
				{(list ?? []).map((r) => (
					<article class={`ih-ask ih-access-ask ${r.status}`} key={r.player_id}>
						<header class="ih-ask-head">
							<div class="ih-access-who">
								{r.avatar_url ? <img src={r.avatar_url} alt="" width={32} height={32} /> : <span class="ih-access-avatar" aria-hidden="true" />}
								<div>
									<p class="ih-ask-label">{r.display_name || 'A player'}</p>
									<p class="pf-help">asked {when(r.created_at)}</p>
								</div>
							</div>
							<span class={`ih-ask-state ${r.status === 'allowed' ? 'won' : r.status === 'declined' ? 'lost' : 'pending'}`}>{ACCESS[r.status]}</span>
						</header>
						{r.message && <p class="ih-ask-result">“{r.message}”</p>}
						<div class="ih-ask-actions">
							{r.status === 'allowed' ? (
								<button type="button" class="pf-button subtle" disabled={busy === r.player_id} onClick={() => decide(r, null)}>
									Close it again
								</button>
							) : (
								<>
									{r.status === 'pending' && (
										<button type="button" class="pf-button" disabled={busy === r.player_id} onClick={() => decide(r, false)}>
											Decline
										</button>
									)}
									<button type="button" class="pf-button primary" disabled={busy === r.player_id} onClick={() => decide(r, true)}>
										Let in
									</button>
								</>
							)}
						</div>
					</article>
				))}
			</div>
		</>
	);
}

export function InheritanceTab({ b }: { b: FamilyBundle }) {
	const [rolls, setRolls] = useState<InheritanceRoll[] | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		loadFamilyInheritanceRolls(b.family.id).then(setRolls, (e) => setError(messageOf(e)));
	}, [b.family.id]);

	const replace = (r: InheritanceRoll) => setRolls((list) => (list ?? []).map((x) => (x.id === r.id ? r : x)));
	const pending = (rolls ?? []).filter((r) => r.status === 'pending');
	const decided = (rolls ?? []).filter((r) => r.status !== 'pending');

	return (
		<section class="pf-section">
			<header class="pf-section-head">
				<h2>Inheritance</h2>
				<span class="pf-badge">{pending.length}</span>
			</header>
			<p class="pf-intro">
				New characters for {b.family.name} start with its Inheritance. When one asks for a Rolled perk (or a rolled option), roll it and record how it went. The finished
				character comes to you for review in the Admin Panel’s Family Reviews.
			</p>
			{error && <p class="portal-error">{error}</p>}
			{!rolls && !error && <p class="portal-status">Loading rolls…</p>}
			{rolls && pending.length === 0 && <p class="pf-empty">No rolls waiting.</p>}
			<div class="ih-asks">
				{pending.map((r) => (
					<RollCard key={r.id} r={r} onDecided={replace} />
				))}
			</div>
			{decided.length > 0 && (
				<>
					<p class="pf-subhead">Rolled</p>
					<div class="ih-asks">
						{decided.map((r) => (
							<RollCard key={r.id} r={r} onDecided={replace} />
						))}
					</div>
				</>
			)}
			<AccessList b={b} />
		</section>
	);
}
