// A character's public page (/character/?id=…). The database decides what each viewer gets:
// the full article, or, for an encrypted character they aren't allowed to see, only its name.
import { useEffect, useState } from 'preact/hooks';
import { loadCharacterPage, type CharacterPageData } from '../../lib/portal/api.ts';
import { applyTheme, startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { CharacterArticle } from './CharacterArticle.tsx';
import { EncryptedScreen } from './EncryptedScreen.tsx';
import { ViewerPanel } from './ViewerPanel.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const portal = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export default function CharacterPage() {
	const id = new URLSearchParams(location.search).get('id') ?? '';
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [page, setPage] = useState<CharacterPageData | null | undefined>(undefined);
	const [error, setError] = useState('');

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p))), []);
	const load = () => {
		if (!id) return setPage(null);
		loadCharacterPage(id).then(setPage, (e) => setError(messageOf(e)));
	};
	// Load once the login is known, so the database knows who's asking.
	useEffect(() => {
		if (player !== undefined) load();
	}, [player?.id ?? null, player === undefined]);
	useEffect(() => {
		if (page?.sheet && page.kind === 'oc') applyTheme(themeForRole(page.sheet.role));
	}, [page]);

	if (error) return <p class="portal-error">Couldn’t load this character: {error}</p>;
	if (page === undefined) return <p class="portal-status">Loading…</p>;
	if (page === null)
		return (
			<div class="portal-card">
				<p>This character doesn’t exist, or it hasn’t been approved yet.</p>
				<p>
					<a class="pf-button" href={`${portal}characters/`}>
						← My Stuff
					</a>
				</p>
			</div>
		);

	if (!page.allowed)
		return (
			<div class="pf">
				<EncryptedScreen name={page.name} owner={page.owner} sealedBy={page.sealed_by}>
					{player === null && (
						<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
							Log in with Discord
						</button>
					)}
					{player && <p class="pf-help enc-help">If the owner added you, make sure you’re logged in with the right Discord account.</p>}
				</EncryptedScreen>
			</div>
		);

	const admin = Boolean(player?.isAdmin);
	return (
		<div class="pf cp">
			{page.sealed_by && (
				<div class="pf-status enc-banner" role="note">
					<strong>🔒 Sealed</strong> · {page.sealed_by} is sealed: only the family and the admins can see its members.
				</div>
			)}
			{page.encrypted && (
				<div class="pf-status enc-banner" role="note">
					<strong>🔒 Encrypted</strong> · Only {page.mine ? 'you' : 'the owner'}, the admins{page.mine ? ' and the players you add' : ' and the players they added'} can see this character.
				</div>
			)}
			{page.mine && !page.approved && (
				<div class="pf-status" role="note">
					<strong>Not approved yet</strong> · Only you and the admins can see this page until it is.
				</div>
			)}
			<CharacterArticle
				name={page.name}
				kind={page.kind ?? 'oc'}
				universeName={page.canon_universe}
				sheet={page.sheet!}
				adminCharacter={page.admin_character}
				hideErrors={!admin}
			/>
			{page.encrypted && (page.mine || admin) && (
				<section class="hud-panel cp-viewers">
					<h3 class="hud-panel-title">Who can see this</h3>
					<ViewerPanel characterId={page.id} ownerId={page.owner_id} onStopped={load} />
				</section>
			)}
			{page.mine && (
				<p>
					<a class="pf-button" href={`${portal}submit/?id=${page.id}`}>
						✎ Edit
					</a>
				</p>
			)}
		</div>
	);
}
