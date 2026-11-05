// A compact card for the player who owns the character under review: roll ban, this character's
// rolls, open codes, and a link to the full Players view.
import { useEffect, useState } from 'preact/hooks';
import { loadPlayerRolls, type PlayerRollInfo, type PlayerSummary } from '../../lib/portal/api.ts';
import { describe } from './OverridePanel.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

/** What the card shows, given the data (the dev preview passes mock data). */
export function OwnerCardView({ player, characterId, info, error, onOpen }: { player: PlayerSummary; characterId: string; info: PlayerRollInfo | null; error?: string; onOpen: () => void }) {
	const rolls = info?.rolls.filter((r) => r.character_id === characterId && r.status !== 'void') ?? [];
	const others = info ? info.characters.length - 1 : 0;
	return (
		<section class="hud-panel own-card" aria-label={`Player ${player.display_name}`}>
			<header class="own-head">
				{player.avatar_url ? <img src={player.avatar_url} alt="" width={36} height={36} /> : <span class="own-avatar" aria-hidden="true">{player.display_name.slice(0, 1)}</span>}
				<div class="own-name">
					<strong>{player.display_name}</strong>
					<span class="pf-help">{info ? `${others > 0 ? `${others} other character${others === 1 ? '' : 's'}` : 'No other characters'}` : 'Loading…'}</span>
				</div>
				{info?.lock && <span class="pf-badge bad" title={info.lock.reason || undefined}>Roll banned</span>}
			</header>
			{error && <p class="portal-error">{error}</p>}
			{info && (
				<ul class="own-facts">
					{rolls.length ? (
						rolls.map((r) => (
							<li key={r.id}>
								<span>{r.kind === 'potential' ? 'Potential' : 'Cursed Energy'}</span>
								<span>{describe(r)}</span>
							</li>
						))
					) : (
						<li class="pf-empty">No rolls on this character.</li>
					)}
					{info.codes.length > 0 && (
						<li>
							<span>Open codes</span>
							<span>{info.codes.length}</span>
						</li>
					)}
				</ul>
			)}
			<button type="button" class="pf-button subtle own-open" onClick={onOpen}>
				Open player →
			</button>
		</section>
	);
}

export function OwnerCard({ player, characterId, onOpen }: { player: PlayerSummary; characterId: string; onOpen: () => void }) {
	const [info, setInfo] = useState<PlayerRollInfo | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		setInfo(null);
		loadPlayerRolls(player.id).then(setInfo, (e) => setError(messageOf(e)));
	}, [player.id, characterId]);
	return <OwnerCardView player={player} characterId={characterId} info={info} error={error} onOpen={onOpen} />;
}
