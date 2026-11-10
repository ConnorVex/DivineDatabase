// The shared review inbox: characters and evolutions, new families, family perks and equipment. Each character shows a read-only sheet with the same checks players see, what changed
// for evolutions, and approve / send back / deny with a note. Family owners get the new
// characters that picked their family; row-level security decides what each reviewer can read.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	adminDeleteCharacter,
	staffEditCharacter,
	setProgressed,
	heavenlyGrantFor,
	discoverCombos,
	listPlayers,
	loadAllCharacters,
	loadClaimBoard,
	loadEvolutions,
	loadHeldClaims,
	loadReviewNotes,
	setPinnedNotes,
	setEncryption,
	rememberPermissions,
	characterPageHref,
	loadUniverses,
	reviewCharacter,
	reviewEvolution,
	setCharacterHidden,
	setExtraTraitSlots,
	setBonusPtp,
	type AdminCharacter,
	type ClaimRow,
	type Combo,
	type EvolutionRequest,
	type PlayerSummary,
	type ReviewNote,
	type Status,
	type Universe,
} from '../../lib/portal/api.ts';
import { sheetChanges } from '../../lib/portal/diff.ts';
import { CharacterArticle } from './CharacterArticle.tsx';
import { PinnedNotesEditor, type PinRequest } from './PinnedNotes.tsx';
import { STEP_OF_SECTION, type PinnedNote } from '../../lib/portal/pins.ts';
import { PointsPanel } from './PointsPanel.tsx';
import { ChangeList } from './ChangeList.tsx';
import { ReviewFamily, ReviewRequest } from '../families/FamilyAdmin.tsx';
import { EquipmentReview } from './EquipmentReview.tsx';
import { loadCraftingItems, loadEquipmentQueue, type CraftingItem, type EquipmentQueueItem } from '../../lib/portal/equipment.ts';
import { familyHref, loadFamilies, loadMyFamily, loadPerkQueue, type Family, type FamilyCard, type PerkRequest } from '../../lib/families/api.ts';
import { loadFamilyChoices, loadLinkablePerks, type LinkablePerk } from '../../lib/portal/families.ts';
import { applyApproved, approvedText, checkSheet, denyStatOverride, ENCRYPTION_ITEM, isStatOverride, type Issue } from '../../lib/portal/rules.ts';
import { AdminRail } from './AdminRail.tsx';
import { MaintenancePanel } from './MaintenancePanel.tsx';
import { ClaimsPanel } from './ClaimsPanel.tsx';
import { PlayersView } from './OverridePanel.tsx';
import { OwnerCard } from './OwnerCard.tsx';
import { startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = (iso: string | null) => {
	if (!iso) return '';
	const h = (Date.now() - new Date(iso).getTime()) / 36e5;
	return h < 1 ? 'just now' : h < 48 ? `${Math.floor(h)}h\u00A0ago` : `${Math.floor(h / 24)}\u00A0days\u00A0ago`;
};

const TABS: { id: string; label: string; match: (c: AdminCharacter) => boolean }[] = [
	{ id: 'pending', label: 'In review', match: (c) => c.status === 'pending' },
	{ id: 'needs_correction', label: 'Sent back', match: (c) => c.status === 'needs_correction' },
	{ id: 'approved', label: 'Approved', match: (c) => c.status === 'approved' || (Boolean(c.approved_at) && c.status === 'draft') },
	{ id: 'denied', label: 'Denied', match: (c) => c.status === 'denied' },
	{ id: 'draft', label: 'Drafts', match: (c) => c.status === 'draft' && !c.approved_at },
];

// What the inbox holds. Family owners only see characters.
const KINDS = [
	{ id: 'characters', label: 'Characters', icon: '👤' },
	{ id: 'families', label: 'New families', icon: '🏛️' },
	{ id: 'perks', label: 'Family perks', icon: '✨' },
	{ id: 'equipment', label: 'Equipment', icon: '⚔️' },
] as const;
type Kind = (typeof KINDS)[number]['id'] | 'players' | 'claims' | 'site';
const kindFromUrl = (): Kind => {
	const t = new URLSearchParams(location.search).get('type');
	return t === 'players' || t === 'claims' || t === 'site' || KINDS.some((k) => k.id === t) ? (t as Kind) : 'characters';
};

const STATUS_LABEL: Record<Status, string> = {
	draft: 'Draft',
	pending: 'In review',
	approved: 'Approved',
	needs_correction: 'Sent back',
	denied: 'Denied',
};

const Block = ({ title, children }: { title: string; children: ComponentChildren }) => (
	<div class="hud-panel rv-block">
		<h3 class="hud-panel-title">{title}</h3>
		{children}
	</div>
);

const Row = ({ label, value }: { label: string; value: ComponentChildren }) =>
	value === '' || value === null || value === undefined ? null : (
		<div class="rv-row">
			<span class="pf-label">{label}</span>
			<span class="rv-value">{value}</span>
		</div>
	);


type PermissionDecision = 'approved' | 'denied';

/** Issues by level. With `onDecide`, each “needs permission” item gets Approve / Deny buttons. */
function IssueList({
	issues,
	decisions,
	onDecide,
	onPin,
}: {
	issues: Issue[];
	decisions?: Record<string, PermissionDecision>;
	onDecide?: (message: string, d: PermissionDecision | null) => void;
	/** Pin this check as a note on its part of the form. */
	onPin?: (issue: Issue) => void;
}) {
	if (issues.length === 0) return <p class="pf-ok">✅ No problems found.</p>;
	const groups = [
		['error', '⛔ Breaks the rules'],
		['warning', '⚠️ Warnings'],
		['permission', '🔑 Needs permission'],
		['approved', '✅ Already approved'],
	] as const;
	return (
		<>
			{groups.map(([level, title]) => {
				const list = issues.filter((i) => i.level === level);
				return list.length ? (
					<div key={level} class={`pf-issue-group ${level}`}>
						<h3>
							{title} ({list.length})
						</h3>
						<ul>
							{list.map((i, n) => {
								const d = decisions?.[i.message];
								return (
									<li key={n} class={d ? `rv-perm ${d}` : undefined}>
										<span class="pf-issue-section">{i.section}</span> {level === 'approved' ? `${approvedText(i.message)} · approved` : i.message}
										{onPin && STEP_OF_SECTION[i.section] && (
											<button type="button" class="pin-add" title="Pin this as a note for the player" aria-label="Pin this as a note for the player" onClick={() => onPin(i)}>
												📌
											</button>
										)}
										{level === 'permission' && onDecide && (
											<span class="rv-perm-buttons">
												{(['approved', 'denied'] as const).map((choice) => (
													<button
														key={choice}
														type="button"
														class={`pf-button subtle${d === choice ? ` active ${choice}` : ''}`}
														aria-pressed={d === choice}
														onClick={() => onDecide(i.message, d === choice ? null : choice)}
													>
														{choice === 'approved' ? '✓ Approve' : '✕ Deny'}
													</button>
												))}
											</span>
										)}
									</li>
								);
							})}
						</ul>
					</div>
				) : null;
			})}
		</>
	);
}

function Detail(props: {
	c: AdminCharacter;
	owner?: PlayerSummary;
	board: ClaimRow[];
	universes: Universe[];
	families: FamilyCard[];
	/** Admins get the settings and can decide any character; family owners only new submissions. */
	admin: boolean;
	onDecided: () => void;
	onChanged: () => void;
	onOpenPlayer?: (id: string, characterId?: string) => void;
}) {
	const { c } = props;
	const [combos, setCombos] = useState<Combo[]>([]);
	const [held, setHeld] = useState<Set<string>>(new Set());
	const [notes, setNotes] = useState<ReviewNote[]>([]);
	const [evolutions, setEvolutions] = useState<EvolutionRequest[]>([]);
	const [perks, setPerks] = useState<LinkablePerk[] | null>(null);
	const [heavenlyGrant, setHeavenlyGrant] = useState<string | null | undefined>(undefined);
	const [memberOf, setMemberOf] = useState<string[]>([]);
	const [note, setNote] = useState('');
	const [permissions, setPermissions] = useState<Record<string, PermissionDecision>>({});
	const [confirm, setConfirm] = useState<'approved' | 'denied' | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [slots, setSlots] = useState(String(c.extra_trait_slots));
	const [bonus, setBonus] = useState(String(c.bonus_ptp));
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [pins, setPins] = useState<PinnedNote[]>(c.pinned_notes);
	const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

	useEffect(() => setPins(c.pinned_notes), [c.id, c.updated_at]);
	useEffect(() => {
		setPinRequest(null);
		setNote('');
		setConfirm(null);
		setConfirmDelete(false);
		setError('');
		setSlots(String(c.extra_trait_slots));
		setBonus(String(c.bonus_ptp));
		// The perks this character links, to check the links against what the families offer now.
		setPerks(null);
		loadFamilyChoices(c.id)
			.then(async (fc) => {
				const ids = fc.memberships.map((m) => m.family_id);
				setMemberOf(ids);
				setPerks(await loadLinkablePerks([...new Set([...c.sheet.families, ...ids])]));
			})
			.catch(() => setPerks([]));
		// The Heavenly Restriction this character may use (left unknown if it can't be loaded).
		setHeavenlyGrant(undefined);
		heavenlyGrantFor(c.owner_id, c.id).then(setHeavenlyGrant, () => setHeavenlyGrant(undefined));
		Promise.all([discoverCombos(c.id), loadHeldClaims(c.id), loadReviewNotes([c.id]), c.approved_at ? loadEvolutions([c.id]).catch(() => []) : Promise.resolve([])]).then(
			([k, h, n, e]) => {
				setCombos(k);
				setHeld(h);
				setNotes(n);
				setEvolutions(e);
			},
			(e) => setError(messageOf(e)),
		);
	}, [c.id, c.updated_at]);

	const isEvolution = Boolean(c.approved_at);
	// The evolution submission waiting for a decision, if any.
	const openEvolution = evolutions.find((e) => e.status === 'pending' || e.status === 'needs_correction') ?? null;
	const issues = useMemo(
		() =>
			applyApproved(checkSheet(c.sheet, {
				kind: c.kind,
				name: c.name,
				canonUniverse: c.canon_universe,
				isEvolution,
				extraTraitSlots: c.extra_trait_slots,
				bonusPtp: c.bonus_ptp,
				approvedSheet: c.approved_sheet,
				claims: new Map(props.board.map((r) => [r.id, { name: r.name, usedSlots: r.used_slots, maxUsers: r.max_users, category: r.category, universe: r.universe, claimType: r.claim_type }])),
				heldClaimIds: held,
				requestedClaims: c.requested_claims,
				comboSystemLimits: combos.map((k) => k.system_limits ?? {}),
				combos: combos.map((k) => k.name),
				families: [...c.sheet.families, ...memberOf],
				familyPerks: perks ? new Map(perks.map((p) => [p.id, p])) : undefined,
				heavenlyGrant,
				staffOverrides: c.staff_overrides,
				progressed: c.progressed,
				adminCharacter: c.admin_character,
				encryptionRequest: c.encryption_requested && !c.encrypted ? { reason: c.encryption_reason } : null,
			}), c.approved_permissions),
		[c, held, combos, props.board, perks, memberOf, heavenlyGrant],
	);
	const changes = useMemo(() => (c.approved_sheet ? sheetChanges(c.approved_sheet, c.sheet) : []), [c]);
	const errors = issues.filter((i) => i.level === 'error').length;
	const theme = c.kind === 'oc' ? themeForRole(c.sheet.role) : null;
	const decidable = props.admin
		? c.status === 'pending' || c.status === 'needs_correction' || c.status === 'denied' || c.status === 'draft'
		: c.status === 'pending' || c.status === 'needs_correction';
	const canPin = decidable && c.status !== 'approved' && c.status !== 'denied';
	const askPin = (step: string, target?: string, text?: string) => setPinRequest({ step, target, text, nonce: Date.now() });
	const unpin = canPin ? (id: string) => setPinnedNotes(c.id, pins.filter((n) => n.id !== id)).then(() => setPins((p) => p.filter((n) => n.id !== id)), (e) => setError(messageOf(e))) : undefined;
	const picked = c.sheet.families.map((id) => props.families.find((f) => f.id === id)).filter((f): f is FamilyCard => Boolean(f));

	// Permission decisions go into the review note, so the player sees them in Discord and their history.
	const permissionNote = () => {
		const pick = (d: PermissionDecision) =>
			issues.filter((i) => i.level === 'permission' && permissions[i.message] === d).map((i) => i.message.replace(/ needs? permission\.?$/, ''));
		const ok = pick('approved');
		const no = pick('denied');
		return [ok.length ? `✅ Approved: ${ok.join('; ')}` : '', no.length ? `❌ Denied: ${no.join('; ')}` : ''].filter(Boolean).join('\n');
	};
	const denied = issues.some((i) => i.level === 'permission' && permissions[i.message] === 'denied');

	async function decide(outcome: 'approved' | 'needs_correction' | 'denied') {
		if ((outcome === 'denied' || (outcome === 'approved' && (errors > 0 || denied))) && confirm !== outcome) {
			setConfirm(outcome);
			return;
		}
		setBusy(true);
		setError('');
		try {
			// A denied stat override puts the card back to the starting stats before it's approved or sent back.
			const deniedOverrides = issues.filter((i) => isStatOverride(i) && permissions[i.message] === 'denied');
			if (props.admin && outcome !== 'denied' && deniedOverrides.length && !openEvolution) {
				const sheet = deniedOverrides.reduce((sh, i) => denyStatOverride(sh, i.card!, c.staff_overrides ?? {}), c.sheet);
				await staffEditCharacter(c.id, sheet, c.staff_overrides ?? {});
			}
			const full = [permissionNote(), note.trim()].filter(Boolean).join('\n\n');
			if (openEvolution) await reviewEvolution(openEvolution.id, outcome, full);
			else await reviewCharacter(c.id, outcome, full);
			// Approving the encryption request (and the character) encrypts it. Only admins can.
			const encryption = issues.find((i) => i.level === 'permission' && i.message.startsWith(ENCRYPTION_ITEM));
			if (props.admin && outcome === 'approved' && encryption && permissions[encryption.message] === 'approved') await setEncryption(c.id, true);
			// Approved 🔑 items stay approved, even if the character is sent back for something else.
			const approvedNow = issues.filter((i) => i.level === 'permission' && permissions[i.message] === 'approved').map((i) => i.message);
			if (props.admin && outcome !== 'denied' && approvedNow.length) await rememberPermissions(c.id, [...c.approved_permissions, ...approvedNow]);
			props.onDecided();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
			setConfirm(null);
		}
	}

	const heldNames = props.board.filter((b) => held.has(b.id)).map((b) => b.name);

	async function remove() {
		setBusy(true);
		setError('');
		try {
			await adminDeleteCharacter(c.id);
			props.onDecided();
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
			setConfirmDelete(false);
		}
	}

	async function change(fn: () => Promise<void>) {
		setError('');
		try {
			await fn();
			props.onChanged();
		} catch (e) {
			setError(messageOf(e));
		}
	}

	return (
		<div class="rv-detail" style={theme ? { '--card-accent': theme.color } : undefined}>
			<header class="rv-head">
				<div>
					<h2>{c.name}</h2>
					<p class="pf-help">
						{c.encrypted && <span class="rv-enc">🔒 Encrypted · </span>}
						{props.owner ? `by ${props.owner.display_name}` : 'unknown player'} · {STATUS_LABEL[c.status]}
						{isEvolution && c.status !== 'approved' ? ' · evolution of an approved character' : ''}
						{c.submitted_at ? ` · sent ${ago(c.submitted_at)}` : ''}
					</p>
				</div>
				<span class="rv-head-links">
					{c.approved_at && (
						<a class="pf-button subtle" href={characterPageHref(c.id)}>
							View page
						</a>
					)}
					{props.admin && (
						<a class="pf-button subtle" href={`${base}submit/?id=${c.id}`}>
							Open in form
						</a>
					)}
				</span>
			</header>
			{error && <p class="portal-error">{error}</p>}

			<div class="rv-grid">
				<div class="rv-side rv-side-top">
					{props.admin && props.owner && props.onOpenPlayer && (
						<OwnerCard player={props.owner} characterId={c.id} onOpen={() => props.onOpenPlayer!(props.owner!.id, c.id)} />
					)}
					<Block title="Checks">
						<IssueList
							issues={issues}
							decisions={decidable ? permissions : undefined}
							onDecide={decidable ? (message, d) => setPermissions((p) => {
								const next = { ...p };
								if (d) next[message] = d;
								else delete next[message];
								return next;
							}) : undefined}
							onPin={canPin ? (i) => askPin(STEP_OF_SECTION[i.section], undefined, i.message) : undefined}
						/>
					</Block>

					{canPin && (
						<Block title={`Pinned notes${pins.length ? ` (${pins.length})` : ''}`}>
							<PinnedNotesEditor characterId={c.id} kind={c.kind} sheet={c.sheet} notes={pins} request={pinRequest} onSaved={setPins} />
						</Block>
					)}


				</div>
				<div class="rv-main">
					{openEvolution && (
						<Block title="Evolution submission">
							<p class="pf-help">Sent {when(openEvolution.submitted_at)}. Approving adds this to the character’s evolution log.</p>
							<Row label="What evolved" value={openEvolution.summary} />
							{openEvolution.earned && <Row label="How it was earned" value={openEvolution.earned} />}
							{openEvolution.links && (
								<p class="rv-text">
									{openEvolution.links
										.split(/\s+/)
										.filter((l) => /^https:\/\//.test(l))
										.map((l, i) => (
											<a key={l} href={l} target="_blank" rel="noreferrer noopener">
												{i === 0 ? 'Proof ↗' : ` · proof ${i + 1} ↗`}
											</a>
										))}
								</p>
							)}
						</Block>
					)}

					{isEvolution && c.status !== 'approved' && (
						<Block title={`What changed since approval (${changes.length})`}>
							<ChangeList before={c.approved_sheet!} after={c.sheet} />
						</Block>
					)}

					<CharacterArticle
						name={c.name}
						kind={c.kind}
						universeName={props.universes.find((u) => u.slug === c.canon_universe)?.name ?? c.canon_universe}
						sheet={c.sheet}
						bonusPtp={c.bonus_ptp}
						extraTraitSlots={c.extra_trait_slots}
						staffOverrides={c.staff_overrides}
						progressed={c.progressed}
						combos={combos}
						claims={props.board.filter((b) => c.requested_claims.includes(b.id))}
						perks={perks ?? []}
						families={props.families}
						adminCharacter={c.admin_character}
						pins={pins}
						onPin={canPin ? (step, target) => askPin(step, target) : undefined}
						onUnpin={unpin}
					/>

					{c.approved_sheet && (
						<Block title="Upgrade points">
							<PointsPanel characterId={c.id} sheet={c.approved_sheet} admin={props.admin} staffOverrides={c.staff_overrides} progressed={c.progressed} />
						</Block>
					)}

					{notes.length > 0 && (
						<Block title="Review history">
							<ul class="ov-events">
								{notes.map((n) => (
									<li key={n.id}>
										<span class="pf-issue-section">{when(n.created_at)}</span> {n.outcome ? STATUS_LABEL[n.outcome] : 'Note'}
										{n.body && `: ${n.body}`}
									</li>
								))}
							</ul>
						</Block>
					)}

				</div>
				<div class="rv-side rv-side-bottom">
					{decidable && (
						<div class="rv-decide">
							<div class="pf-field">
								<label class="pf-label" for="rv-note">
									Note to the player
								</label>
								<textarea
									id="rv-note"
									rows={3}
									value={note}
									onInput={(e) => setNote(e.currentTarget.value)}
									placeholder="What to fix, or a welcome message. The player sees this on My Stuff."
								/>
							</div>
							{permissionNote() && (
								<p class="pf-help rv-perm-note">
									Added to the note: <span>{permissionNote()}</span>
								</p>
							)}
							{confirm && (
								<p class="roll-note bad" role="alert">
									{confirm === 'denied' && openEvolution
										? 'Denying the evolution throws these changes away; the character goes back to its last approved version. Click again to confirm.'
										: confirm === 'denied'
										? 'Denying is final for the player: the character is locked and they must make a new one. Click Deny again to confirm.'
										: `${[errors > 0 ? `This sheet still has ${errors} rule problem${errors === 1 ? '' : 's'}` : '', denied ? 'you denied something that needs permission' : ''].filter(Boolean).join(', and ').replace(/^y/, 'Y')}. Click Approve again to approve anyway, or Send back so the player can change it.`}
								</p>
							)}
							<div class="rv-buttons">
								<button type="button" class="pf-button primary" disabled={busy} onClick={() => decide('approved')}>
									{confirm === 'approved' ? 'Approve anyway' : openEvolution ? 'Approve evolution' : 'Approve'}
								</button>
								<button type="button" class="pf-button" disabled={busy || c.status === 'needs_correction'} onClick={() => decide('needs_correction')}>
									Send back
								</button>
								<button type="button" class="pf-button danger" disabled={busy || c.status === 'denied' || (isEvolution && !openEvolution)} onClick={() => decide('denied')}>
									{confirm === 'denied' ? 'Yes, deny' : openEvolution ? 'Deny evolution' : 'Deny'}
								</button>
							</div>
						</div>
					)}
					{picked.length > 0 && (
						<Block title="Families">
							<p class="pf-help">
								{isEvolution
									? 'Picked when the character was first sent.'
									: 'Approving adds the character to these families. Families whose owner didn’t approve it get a join request instead.'}
							</p>
							<ul class="rv-families">
								{picked.map((f) => (
									<li key={f.id} style={{ '--fam': f.colour }}>
										<a href={familyHref(f.slug)}>{f.name}</a>
										<span class="pf-help">{f.ownerName ? `owner: ${f.ownerName}` : 'no owner yet'}</span>
									</li>
								))}
							</ul>
						</Block>
					)}

					{props.admin && (
						<Block title="Settings">
							<div class="rv-settings-grid">
								<div class="rv-settings-checks">
									<label class="pf-check">
										<input type="checkbox" checked={c.hidden} onChange={(e) => change(() => setCharacterHidden(c.id, e.currentTarget.checked))} />
										Hide from the gallery
									</label>
									<label class="pf-check" title="Only the owner, admins and the players the owner adds can see it.">
										<input type="checkbox" checked={c.encrypted} onChange={(e) => change(() => setEncryption(c.id, e.currentTarget.checked))} />
										🔒 Encrypted
									</label>
									{c.kind === 'oc' && !c.approved_at && (
										<label class="pf-check" title="For characters coming in already progressed: the sheet skips every starting limit, like an evolution.">
											<input type="checkbox" checked={c.progressed} onChange={(e) => change(() => setProgressed(c.id, e.currentTarget.checked))} />
											Already progressed (skip starting limits)
										</label>
									)}
								</div>
								{c.kind === 'oc' && (
									<div class="rv-settings-numbers">
										<div class="pf-field rv-slots">
											<label class="pf-label" for="rv-slots">
												Extra trait slots
											</label>
											<input
												id="rv-slots"
												type="number"
												min={0}
												max={20}
												value={slots}
												onInput={(e) => setSlots(e.currentTarget.value)}
												onBlur={() => Number(slots) !== c.extra_trait_slots && change(() => setExtraTraitSlots(c.id, Math.max(0, Math.min(20, Number(slots) || 0))))}
											/>
										</div>
										<div class="pf-field rv-slots">
											<label class="pf-label" for="rv-bonus-ptp">
												Bonus PTP
											</label>
											<input
												id="rv-bonus-ptp"
												type="number"
												min={0}
												max={200}
												value={bonus}
												onInput={(e) => setBonus(e.currentTarget.value)}
												onBlur={() => Number(bonus) !== c.bonus_ptp && change(() => setBonusPtp(c.id, Math.max(0, Math.min(200, Math.round(Number(bonus)) || 0))))}
											/>
										</div>
									</div>
								)}
							</div>
							<div class="rv-danger">
								{confirmDelete ? (
									<>
										<p role="alert">
											Delete <strong>{c.name}</strong> for good? Its review history goes too
											{heldNames.length > 0 ? `, and its canon claims are freed: ${heldNames.join(', ')}` : ''}. The player’s rolls stay in their history.
										</p>
										<div class="rv-buttons">
											<button type="button" class="pf-button danger" disabled={busy} onClick={remove}>
												Yes, delete
											</button>
											<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(false)}>
												Cancel
											</button>
										</div>
									</>
								) : (
									<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(true)}>
										Delete character…
									</button>
								)}
							</div>
						</Block>
					)}

				</div>
			</div>
		</div>
	);
}

export function CharacterQueue(props: {
	all: AdminCharacter[];
	players: Map<string, PlayerSummary>;
	board: ClaimRow[];
	universes: Universe[];
	families: FamilyCard[];
	admin: boolean;
	reload: () => Promise<AdminCharacter[] | null>;
	/** Admins: open this player in the Players view. */
	onOpenPlayer?: (id: string, characterId?: string) => void;
}) {
	const { all, players } = props;
	// Family owners only decide new submissions, so they only get the first two queues.
	const tabs = props.admin ? TABS : TABS.slice(0, 2);
	const [tab, setTab] = useState('pending');
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<string | null>(null);

	const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.id, all.filter(t.match).length])), [all]);
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = all.filter(tabs.find((t) => t.id === tab)!.match);
		return list.filter((c) => !q || c.name.toLowerCase().includes(q) || (players.get(c.owner_id)?.display_name ?? '').toLowerCase().includes(q));
	}, [all, tab, query, players]);
	const current = all.find((c) => c.id === selected) ?? null;

	return (
		<>
			<nav class="pf-nav" aria-label="Character queues">
				{tabs.map((t) => (
					<a
						key={t.id}
						href={`#${t.id}`}
						class={tab === t.id ? 'active' : undefined}
						aria-current={tab === t.id ? 'true' : undefined}
						onClick={(e) => {
							e.preventDefault();
							setTab(t.id);
						}}
					>
						{t.label} <span class="mc-count">{counts[t.id]}</span>
					</a>
				))}
			</nav>
			<div class="ov-layout">
				<div class="hud-panel ov-list">
					<input type="search" class="ov-search" placeholder="Search characters or players…" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search submissions" />
					<ul>
						{shown.map((c) => {
							const owner = players.get(c.owner_id);
							const errors = checkSheet(c.sheet, {
								kind: c.kind,
								name: c.name,
								canonUniverse: c.canon_universe,
								isEvolution: Boolean(c.approved_at),
								extraTraitSlots: c.extra_trait_slots,
								bonusPtp: c.bonus_ptp,
								approvedSheet: c.approved_sheet,
								staffOverrides: c.staff_overrides,
								progressed: c.progressed,
								adminCharacter: c.admin_character,
								families: c.sheet.families,
							}).filter((i) => i.level === 'error').length;
							return (
								<li key={c.id}>
									<button type="button" class={selected === c.id ? 'active' : undefined} onClick={() => setSelected(c.id)}>
										{owner?.avatar_url ? <img class="rv-avatar" src={owner.avatar_url} alt="" width={28} height={28} loading="lazy" /> : <span class="rv-avatar" aria-hidden="true" />}
										<span class="rv-item">
											<strong>{c.name}</strong>
											<span class="pf-help">
												{owner?.display_name ?? 'unknown'} · {c.kind === 'canon' ? 'canon tryout' : 'OC'}
												{c.progressed ? ' · progressed' : ''}
												{c.admin_character ? ' · admin character' : ''}
												{c.approved_at && c.status === 'pending' ? ' · evolution' : ''}
												{!c.approved_at && c.sheet.families.length > 0 ? ' · family' : ''}
												{c.submitted_at && tab === 'pending' ? ` · ${ago(c.submitted_at)}` : ''}
											</span>
										</span>
										{errors > 0 && (
											<span class="rv-flag" title={`${errors} rule problems`}>
												⛔ {errors}
											</span>
										)}
									</button>
								</li>
							);
						})}
						{shown.length === 0 && <li class="pf-empty">{tab === 'pending' ? 'Nothing waiting for review. 🎉' : 'Nothing here.'}</li>}
					</ul>
				</div>
				{current ? (
					<Detail
						// A fresh note and permission decisions for each character.
						key={current.id}
						c={current}
						owner={players.get(current.owner_id)}
						board={props.board}
						universes={props.universes}
						families={props.families}
						admin={props.admin}
						onOpenPlayer={props.onOpenPlayer}
						onChanged={props.reload}
						onDecided={async () => {
							const fresh = await props.reload();
							// Move on to the next submission waiting in this queue.
							const next = fresh?.filter(tabs.find((t) => t.id === tab)!.match).find((c) => c.id !== current.id);
							setSelected(next?.id ?? null);
						}}
					/>
				) : (
					<p class="pf-empty ov-pick">Pick a submission to review it.</p>
				)}
			</div>
		</>
	);
}

export default function ReviewDashboard() {
	const [me, setMe] = useState<Player | null | undefined>(undefined);
	// The family a non-admin owns; undefined while checking.
	const [ownFamily, setOwnFamily] = useState<Family | null | undefined>(undefined);
	const [all, setAll] = useState<AdminCharacter[] | null>(null);
	const [players, setPlayers] = useState<Map<string, PlayerSummary>>(new Map());
	const [board, setBoard] = useState<ClaimRow[]>([]);
	const [universes, setUniverses] = useState<Universe[]>([]);
	const [families, setFamilies] = useState<FamilyCard[]>([]);
	const [perks, setPerks] = useState<PerkRequest[]>([]);
	const [equipment, setEquipment] = useState<EquipmentQueueItem[]>([]);
	const [craftItems, setCraftItems] = useState<CraftingItem[]>([]);
	const [kind, setKindState] = useState<Kind>(kindFromUrl);
	// The player open in the Players view (?player=…).
	const [focus, setFocusState] = useState<string | null>(() => new URLSearchParams(location.search).get('player'));
	const [error, setError] = useState('');

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setMe(p))), []);

	const admin = Boolean(me?.isAdmin);
	const reviewer = admin || ownFamily?.status === 'approved';

	function setKind(k: Kind, player: string | null = k === 'players' ? focus : null) {
		setKindState(k);
		setFocusState(player);
		const url = new URL(location.href);
		if (k === 'characters') url.searchParams.delete('type');
		else url.searchParams.set('type', k);
		if (player) url.searchParams.set('player', player);
		else url.searchParams.delete('player');
		if (k !== 'claims') url.searchParams.delete('universe');
		history.replaceState(null, '', url);
	}
	// From a review: open the owner in Players & rolls, on the character being reviewed.
	const [focusChar, setFocusChar] = useState<string | null>(null);
	const openPlayer = (id: string, characterId?: string) => {
		setFocusChar(characterId ?? null);
		setKind('players', id);
	};

	async function load() {
		try {
			const [chars, ps, b, u, f, pr, eq, ci] = await Promise.all([
				loadAllCharacters(),
				listPlayers(),
				loadClaimBoard(),
				loadUniverses(),
				loadFamilies().catch(() => [] as FamilyCard[]),
				admin ? loadPerkQueue().catch(() => [] as PerkRequest[]) : Promise.resolve([] as PerkRequest[]),
				admin ? loadEquipmentQueue().catch(() => [] as EquipmentQueueItem[]) : Promise.resolve([] as EquipmentQueueItem[]),
				admin ? loadCraftingItems().catch(() => [] as CraftingItem[]) : Promise.resolve([] as CraftingItem[]),
			]);
			// Row-level security also returns the reviewer's own characters; those aren't theirs to review.
			const queue = admin ? chars : chars.filter((c) => c.owner_id !== me?.id);
			setAll(queue);
			setPlayers(new Map(ps.map((p) => [p.id, p])));
			setBoard(b);
			setUniverses(u);
			setFamilies(f);
			setPerks(pr);
			setEquipment(eq);
			setCraftItems(ci);
			return queue;
		} catch (e) {
			setError(messageOf(e));
			return null;
		}
	}
	useEffect(() => {
		if (!me) return;
		if (me.isAdmin) setOwnFamily(null);
		else loadMyFamily().then(setOwnFamily, () => setOwnFamily(null));
	}, [me?.id, me?.isAdmin]);
	useEffect(() => {
		if (me && ownFamily !== undefined && reviewer) load();
	}, [me?.id, admin, ownFamily === undefined, ownFamily?.id]);

	if (error) return <p class="portal-error">{error}</p>;
	if (me === undefined) return <p class="portal-status">Checking your login…</p>;
	if (me === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to continue.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn()}>
					Log in with Discord
				</button>
			</div>
		);
	if (ownFamily === undefined) return <p class="portal-status">Checking your login…</p>;
	if (!reviewer) return <p class="portal-error">The review inbox is for admins and the owners of approved families.</p>;
	if (!all) return <p class="portal-status">Loading submissions…</p>;

	const pendingFamilies = families.filter((f) => f.status === 'pending');
	const counts: Record<Exclude<Kind, 'players' | 'claims' | 'site'>, number> = {
		characters: all.filter((c) => c.status === 'pending').length,
		families: pendingFamilies.length,
		perks: perks.reduce((n, r) => n + r.perks.length, 0),
		equipment: equipment.filter((r) => r.status === 'pending').length,
	};
	const shownKind: Kind = admin ? kind : 'characters';

	const content = (
		<>
			{shownKind === 'characters' && (
				<CharacterQueue all={all} players={players} board={board} universes={universes} families={families} admin={admin} reload={load} onOpenPlayer={admin ? openPlayer : undefined} />
			)}
			{shownKind === 'families' && (
				<div class="fm fm-admin-list">
					{pendingFamilies.length ? (
						pendingFamilies.map((f) => <ReviewFamily key={f.id} f={f} owner={f.ownerName ?? players.get(f.owner_id ?? '')?.display_name ?? 'Unknown player'} onDone={load} />)
					) : (
						<p class="pf-empty">No families waiting. 🎉</p>
					)}
					<p class="pf-help">
						Renaming families, assigning owners and special statuses are in the <a href={`${base}families/admin/#all`}>family tools</a>.
					</p>
				</div>
			)}
			{shownKind === 'perks' && (
				<div class="fm fm-admin-list">{perks.length ? perks.map((r) => <ReviewRequest key={r.id} r={r} onDone={load} />) : <p class="pf-empty">No perks waiting. 🎉</p>}</div>
			)}
			{shownKind === 'equipment' && <EquipmentReview requests={equipment} items={craftItems} players={players} onDone={load} />}
			{shownKind === 'claims' && <ClaimsPanel universes={universes} onChanged={load} />}
			{shownKind === 'site' && <MaintenancePanel />}
			{shownKind === 'players' && <PlayersView players={[...players.values()]} focus={focus} focusCharacter={focusChar} onFocus={(id) => (setFocusChar(null), setKind('players', id))} />}
		</>
	);
	if (!admin)
		return (
			<div class="pf rv">
				<p class="pf-intro">
					New characters that picked <a href={familyHref(ownFamily!.slug)}>{ownFamily!.name}</a> wait here for you. Approving accepts the whole character
					and adds it to your family. Admins can review them too.
				</p>
				{content}
			</div>
		);
	return (
		<div class="pf rv adm">
			<AdminRail
				inbox={KINDS.map((k) => ({ id: k.id, label: k.label, icon: k.icon, count: counts[k.id] }))}
				tools={[
					{ id: 'players', label: 'Players & rolls', icon: '🎲' },
					{ id: 'claims', label: 'Claims', icon: '📌' },
					{ id: 'site', label: 'Maintenance', icon: '🛠️' },
				]}
				active={shownKind}
				onPick={(k) => setKind(k)}
			/>
			<div class="adm-main">{content}</div>
		</div>
	);
}
