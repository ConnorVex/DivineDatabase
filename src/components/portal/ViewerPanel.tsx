// "Who can see this": the owner of an encrypted character adds or removes players.
// Admins always see every character, so they aren't listed.
import { useEffect, useState } from 'preact/hooks';
import { addCharacterViewer, characterViewers, findViewerCandidates, removeCharacterViewer, stopEncryption, type Viewer } from '../../lib/portal/api.ts';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

const Avatar = ({ v }: { v: Viewer }) =>
	v.avatar_url ? <img class="vw-avatar" src={v.avatar_url} alt="" /> : <span class="vw-avatar empty" aria-hidden="true">{v.display_name.slice(0, 1)}</span>;

export function ViewerPanel({ characterId, ownerId, onStopped }: { characterId: string; ownerId?: string; onStopped?: () => void }) {
	const [viewers, setViewers] = useState<Viewer[] | null>(null);
	const [query, setQuery] = useState('');
	const [found, setFound] = useState<Viewer[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [confirmStop, setConfirmStop] = useState(false);

	const reload = () => characterViewers(characterId).then(setViewers, (e) => setError(messageOf(e)));
	useEffect(() => void reload(), [characterId]);
	// Search as the owner types, a moment after they stop.
	useEffect(() => {
		if (query.trim().length < 2) return setFound([]);
		const timer = setTimeout(() => findViewerCandidates(query).then(setFound, (e) => setError(messageOf(e))), 250);
		return () => clearTimeout(timer);
	}, [query]);

	const run = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		setError('');
		try {
			await fn();
			await reload();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	};
	const listed = new Set((viewers ?? []).map((v) => v.profile_id));
	const results = found.filter((v) => !listed.has(v.profile_id) && v.profile_id !== ownerId);

	return (
		<div class="vw">
			<p class="pf-help">Besides you and the admins, only these players can open this character. Everyone else sees the encrypted screen.</p>
			{viewers === null ? (
				<p class="pf-help">Loading…</p>
			) : viewers.length === 0 ? (
				<p class="pf-empty">Nobody else yet.</p>
			) : (
				<ul class="vw-list">
					{viewers.map((v) => (
						<li key={v.profile_id}>
							<Avatar v={v} />
							<span class="vw-name">{v.display_name}</span>
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => run(() => removeCharacterViewer(characterId, v.profile_id))}>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
			<div class="pf-field">
				<label class="pf-label" for="vw-search">
					Add a player
				</label>
				<input id="vw-search" type="search" value={query} placeholder="Type their name…" autocomplete="off" onInput={(e) => setQuery(e.currentTarget.value)} />
			</div>
			{results.length > 0 && (
				<ul class="vw-list vw-found">
					{results.map((v) => (
						<li key={v.profile_id}>
							<Avatar v={v} />
							<span class="vw-name">{v.display_name}</span>
							<button
								type="button"
								class="pf-button"
								disabled={busy}
								onClick={() =>
									run(async () => {
										await addCharacterViewer(characterId, v.profile_id);
										setQuery('');
									})
								}
							>
								+ Add
							</button>
						</li>
					))}
				</ul>
			)}
			{query.trim().length >= 2 && results.length === 0 && <p class="pf-help">No players match “{query.trim()}”.</p>}
			{error && <p class="portal-error">{error}</p>}
			{onStopped && (
				<div class="vw-stop">
					{confirmStop ? (
						<>
							<span class="pf-help">Anyone will be able to see it again. Asking for encryption again needs staff approval.</span>
							<button type="button" class="pf-button danger" disabled={busy} onClick={() => run(async () => (await stopEncryption(characterId), onStopped()))}>
								Yes, decrypt it
							</button>
							<button type="button" class="pf-button subtle" onClick={() => setConfirmStop(false)}>
								Cancel
							</button>
						</>
					) : (
						<button type="button" class="pf-button subtle" onClick={() => setConfirmStop(true)}>
							Stop encrypting this character
						</button>
					)}
				</div>
			)}
		</div>
	);
}
