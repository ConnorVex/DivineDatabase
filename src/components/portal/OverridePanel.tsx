// The admin panel's Players view: a player's characters and the rolls on each, with a per-roll
// override code or a hand-set value, the roll ban, grants, and the history. The database checks
// admin rights on every action.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	adminSetRoll,
	adminVoidRoll,
	cancelOverride,
	grantHeavenly,
	heavenlyGrantsOf,
	revokeHeavenly,
	type HeavenlyGrantRow,
	createOverrideFor,
	loadAdminCharacter,
	loadPlayerRolls,
	type AdminCharacter,
	setRollLock,
	type ActiveCode,
	type PlayerRollInfo,
	type PlayerSummary,
	type RollKind,
	type RollRow,
} from '../../lib/portal/api.ts';
import { HEAVENLY } from '../../lib/portal/heavenly.ts';
import { rules } from '../../lib/portal/rules.ts';
import { CharacterPicker, type PickerOption } from './CharacterPicker.tsx';
import { StaffEditor } from './StaffEditor.tsx';
import { SelectField, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const potentialLabel = (grade?: string) => rules.potentials.find((p) => p.id === grade)?.label ?? grade ?? '?';
const { note: _note, ...ceLevels } = rules.cursedEnergyLevels;
const LOOSE = 'carried-over';
const STATUS_TONE: Record<string, PickerOption['tone']> = { approved: 'ok', pending: 'info', needs_correction: 'warn', denied: 'bad', draft: undefined };
const KIND_LABEL: Record<RollKind, string> = { potential: 'Potential', cursed_energy: 'Cursed Energy' };

export function describe(row: Pick<RollRow, 'kind' | 'result'>) {
	const r = row.result;
	if (row.kind === 'potential') return `${potentialLabel(r.grade)}${r.roll ? ` (rolled ${r.roll}/500)` : ' (set by admin)'}`;
	return `${r.class} · ${r.level} · ${r.cep} CEP${r.classRoll ? ` (rolled ${r.classRoll}/1260, ${r.amountRoll})` : ' (set by admin)'}`;
}

const EVENT_TEXT: Record<string, string> = {
	rolled: 'Rolled',
	moved: 'Carried a roll to another character',
	consumed: 'Roll settled by an approval',
	override_created: 'Override code created',
	override_cancelled: 'Override code cancelled',
	override_used: 'Used an override code',
	override_failed: 'Wrong override code entered',
	locked: 'Rolling locked',
	unlocked: 'Rolling unlocked',
	admin_set: 'Roll set by an admin',
	admin_voided: 'Unsettled roll cleared by an admin',
};

const valueOptions = (kind: RollKind) =>
	kind === 'potential'
		? rules.potentials.map((p) => ({ value: p.id, label: p.label }))
		: Object.entries(ceLevels).flatMap(([cls, levels]) => (levels as [string, number][]).map(([level, cep]) => ({ value: level, label: `${level} (${cep} CEP)`, group: cls })));

/** One rolled value (a character's Potential or Cursed Energy) with its override code or hand-set controls. */
function RollLine(props: {
	kind: RollKind;
	row: RollRow | null;
	code: ActiveCode | null;
	ownerId: string;
	characterId: string | null;
	act: (fn: () => Promise<unknown>) => Promise<void>;
	busy: boolean;
}) {
	const { kind, row, code } = props;
	const [hours, setHours] = useState('2');
	const [setting, setSetting] = useState(false);
	const [value, setValue] = useState('');
	const [copied, setCopied] = useState(false);
	const status = !row ? 'Not rolled' : row.status === 'active' ? 'Locked in' : 'Settled (approved)';

	return (
		<div class="ov-roll">
			<div class="ov-roll-head">
				<span class="pf-label">{KIND_LABEL[kind]}</span>
				<strong class="ov-roll-value">{row ? describe(row) : '—'}</strong>
				<span class={`ov-roll-status ${row?.status ?? 'none'}`}>{status}</span>
			</div>

			{code ? (
				<div class="ov-code" role="status">
					<strong>{(code.code_plain ?? '········').replace(/(\d{4})(\d{4})/, '$1 $2')}</strong>
					<span class="pf-help">Override code for this roll · expires {when(code.expires_at)}</span>
					<button
						type="button"
						class="pf-button subtle"
						disabled={!code.code_plain}
						onClick={() => navigator.clipboard?.writeText(code.code_plain ?? '').then(() => setCopied(true), () => setCopied(false))}
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button type="button" class="pf-button subtle" disabled={props.busy} onClick={() => props.act(() => cancelOverride(code.id))}>
						Cancel code
					</button>
				</div>
			) : (
				<div class="ov-row">
					{row && (
						<>
							<SelectField
								label="Code valid for"
								value={hours}
								onChange={(v) => setHours(v || '2')}
								options={[
									{ value: '2', label: '2 hours' },
									{ value: '6', label: '6 hours' },
									{ value: '24', label: '24 hours' },
								]}
							/>
							<button type="button" class="pf-button primary" disabled={props.busy} onClick={() => props.act(() => createOverrideFor(row.id, Number(hours)))}>
								Give override code
							</button>
						</>
					)}
					<button type="button" class="pf-button" onClick={() => setSetting(!setting)} aria-expanded={setting}>
						Set manually
					</button>
					{row?.status === 'active' && (
						<button type="button" class="pf-button subtle" disabled={props.busy} onClick={() => props.act(() => adminVoidRoll(props.ownerId, kind))}>
							Clear without a code
						</button>
					)}
				</div>
			)}

			{setting && (
				<div class="ov-row">
					<SelectField label={`New ${KIND_LABEL[kind]}`} value={value} onChange={setValue} options={valueOptions(kind)} />
					<button
						type="button"
						class="pf-button primary"
						disabled={props.busy || !value}
						onClick={() =>
							props.act(async () => {
								await adminSetRoll(props.ownerId, kind, value, props.characterId);
								setSetting(false);
								setValue('');
							})
						}
					>
						Save
					</button>
				</div>
			)}
		</div>
	);
}

/** Grant a Heavenly Restriction to the account; the next character approved with it uses it up. */
function HeavenlyPanel({ player, players }: { player: PlayerSummary; players: PlayerSummary[] }) {
	const [grants, setGrants] = useState<HeavenlyGrantRow[] | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [kind, setKind] = useState('');
	const [twin, setTwin] = useState('');
	const [note, setNote] = useState('');
	const isTwin = kind === 'Cursed Twin' || kind === 'Physical Twin';
	const reload = () => heavenlyGrantsOf(player.id).then(setGrants, (e) => setError(messageOf(e)));
	useEffect(() => {
		setGrants(null);
		setError('');
		setKind('');
		setTwin('');
		reload();
	}, [player.id]);
	async function act(fn: () => Promise<unknown>) {
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
	}
	const open = grants?.find((g) => !g.used_at);
	return (
		<div class="hud-panel">
			<h3 class="hud-panel-title">Heavenly Restriction</h3>
			{error && <p class="portal-error">{error}</p>}
			{!grants ? (
				<p class="portal-status">Loading…</p>
			) : (
				<>
					{grants.length === 0 && <p class="pf-empty">None granted.</p>}
					{grants.map((g) => (
						<div class="ov-code" key={g.id}>
							<strong>⛩ {g.restriction}</strong>
							<span class="pf-help">
								{g.twin_name ? `twin: ${g.twin_name} · ` : ''}
								{g.used_at ? `used by ${g.character_name ?? 'a deleted character'}` : 'unused: their next character gets it'} · granted {when(g.granted_at)}
								{g.note ? ` · ${g.note}` : ''}
							</span>
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => act(() => revokeHeavenly(g.id))}>
								Revoke
							</button>
						</div>
					))}
					{!open && (
						<div class="pf-grid">
							<SelectField
								label="Grant"
								value={kind}
								placeholder="Pick a restriction…"
								options={HEAVENLY.map((h) => ({ value: h }))}
								onChange={setKind}
								help={isTwin ? 'Twins are granted to two players at once; the other player gets the other twin.' : undefined}
							/>
							{isTwin && (
								<SelectField
									label="The other twin"
									required
									value={twin}
									placeholder="Pick a player…"
									options={players.filter((p) => p.id !== player.id).map((p) => ({ value: p.id, label: p.display_name }))}
									onChange={setTwin}
								/>
							)}
							<TextField label="Note (optional)" value={note} onInput={setNote} placeholder="e.g. Tryout won in #events" />
							<button
								type="button"
								class="pf-button primary"
								disabled={busy || !kind || (isTwin && !twin)}
								onClick={() =>
									act(async () => {
										await grantHeavenly(player.id, kind, isTwin ? twin : null, note);
										setKind('');
										setTwin('');
										setNote('');
									})
								}
							>
								Grant {kind || 'restriction'}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

function PlayerDetail({ player, players, initialCharacter }: { player: PlayerSummary; players: PlayerSummary[]; initialCharacter?: string | null }) {
	const [picked, setPicked] = useState<string | null>(initialCharacter ?? null);
	const [info, setInfo] = useState<PlayerRollInfo | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [reason, setReason] = useState('');

	const reload = () => loadPlayerRolls(player.id).then(setInfo, (e) => setError(messageOf(e)));
	useEffect(() => {
		setInfo(null);
		setError('');
		reload();
	}, [player.id]);

	async function act(fn: () => Promise<unknown>) {
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
	}

	// The latest roll of each kind on a character (ignoring thrown-away ones).
	const rollFor = (characterId: string | null, kind: RollKind) =>
		info?.rolls.find((r) => r.character_id === characterId && r.kind === kind && r.status !== 'void') ?? null;
	const codeFor = (row: RollRow | null) => (row ? (info?.codes.find((c) => c.roll_id === row.id) ?? null) : null);
	const ocs = info?.characters.filter((c) => c.kind === 'oc') ?? [];
	// Unsettled rolls whose character was deleted: they carry to the player's next character.
	const loose = info?.rolls.filter((r) => r.status === 'active' && !info.characters.some((c) => c.id === r.character_id)) ?? [];
	// One character at a time, picked from the dropdown.
	const pickerOptions: PickerOption[] = [
		...ocs.map((c) => ({ id: c.id, name: c.name, note: c.status.replace('_', ' '), tone: STATUS_TONE[c.status] })),
		...(loose.length ? [{ id: LOOSE, name: 'Carried over', note: 'from a deleted character', tone: 'info' as const }] : []),
	];
	const shownId = pickerOptions.some((o) => o.id === picked) ? picked : (pickerOptions[0]?.id ?? null);

	return (
		<div class="ov-detail">
			<header class="ov-player">
				{player.avatar_url && <img src={player.avatar_url} alt="" width={48} height={48} />}
				<div>
					<strong>{player.display_name}</strong>
					<span class="pf-help">Discord ID {player.discord_id}</span>
				</div>
				{info?.lock && <span class="pf-badge bad">Rolling locked</span>}
			</header>
			{error && <p class="portal-error">{error}</p>}
			{!info ? (
				<p class="portal-status">Loading…</p>
			) : (
				<>
					<div class="hud-panel">
						<h3 class="hud-panel-title">Characters</h3>
						<p class="pf-help">Pick a character: its rolls and the staff edit below are for that character only.</p>
						{ocs.length === 0 && loose.length === 0 && <p class="pf-empty">No characters yet.</p>}
						{pickerOptions.length > 0 && <CharacterPicker options={pickerOptions} value={shownId} onChange={setPicked} />}
						{ocs.filter((c) => c.id === shownId).map((c) => {
							const hasJjk = (c.systems ?? []).some((e) => e?.system === 'jujutsu-kaisen');
							const kinds: RollKind[] = ['potential', ...(hasJjk || rollFor(c.id, 'cursed_energy') ? (['cursed_energy'] as RollKind[]) : [])];
							return (
								<div key={c.id} class="ov-char">
									<p class="ov-char-name">
										<strong>{c.name}</strong> <span class="pf-help">{c.status.replace('_', ' ')}</span>
									</p>
									<p class="pf-subhead">Rolls</p>
									{kinds.map((k) => {
										const row = rollFor(c.id, k);
										return <RollLine key={k} kind={k} row={row} code={codeFor(row)} ownerId={player.id} characterId={c.id} act={act} busy={busy} />;
									})}
									<StaffEditPanel characterId={c.id} />
								</div>
							);
						})}
						{shownId === LOOSE && (
							<div class="ov-char">
								<p class="ov-char-name">
									<strong>Carried over</strong> <span class="pf-help">from a deleted character; goes to their next character</span>
								</p>
								{loose.map((r) => (
									<RollLine key={r.id} kind={r.kind} row={r} code={codeFor(r)} ownerId={player.id} characterId={null} act={act} busy={busy} />
								))}
							</div>
						)}
					</div>

					<p class="ov-account-head">
						Account <span class="pf-help">· applies to all of {player.display_name}’s characters</span>
					</p>

					{info.codes.some((c) => !c.roll_id) && (
						<div class="hud-panel">
							<h3 class="hud-panel-title">Account-wide codes</h3>
							<p class="pf-help">Older codes that clear every unsettled roll on the account when used. New codes are made per roll above.</p>
							{info.codes
								.filter((c) => !c.roll_id)
								.map((c) => (
									<div class="ov-code" key={c.id}>
										<strong>{(c.code_plain ?? '········').replace(/(\d{4})(\d{4})/, '$1 $2')}</strong>
										<span class="pf-help">expires {when(c.expires_at)}</span>
										<button type="button" class="pf-button subtle" disabled={busy} onClick={() => act(() => cancelOverride(c.id))}>
											Cancel code
										</button>
									</div>
								))}
						</div>
					)}

					<div class="hud-panel">
						<h3 class="hud-panel-title">Rolling lock</h3>
						{info.lock ? (
							<>
								<p>
									Locked since {when(info.lock.locked_at)}
									{info.lock.reason ? `: ${info.lock.reason}` : ''}. The player keeps their current rolls but can’t roll new ones.
								</p>
								<button type="button" class="pf-button" disabled={busy} onClick={() => act(() => setRollLock(player.id, false, ''))}>
									Unlock rolling
								</button>
							</>
						) : (
							<>
								<TextField label="Reason (the player sees this)" value={reason} onInput={setReason} placeholder="e.g. Abusing rerolls" />
								<button type="button" class="pf-button danger" disabled={busy} onClick={() => act(() => setRollLock(player.id, true, reason))}>
									Lock rolling
								</button>
							</>
						)}
					</div>

					<HeavenlyPanel player={player} players={players} />

					<div class="hud-panel">
						<h3 class="hud-panel-title">History</h3>
						{info.events.length === 0 ? (
							<p class="pf-empty">Nothing yet.</p>
						) : (
							<ul class="ov-events">
								{info.events.map((e) => (
									<li key={e.id}>
										<span class="pf-issue-section">{when(e.created_at)}</span> {EVENT_TEXT[e.action] ?? e.action}
										{e.detail.kind ? ` · ${KIND_LABEL[e.detail.kind as RollKind] ?? ''}` : ''}
										{e.action === 'rolled' && e.detail.result ? `: ${describe({ kind: e.detail.kind as RollKind, result: e.detail.result as RollRow['result'] })}` : ''}
										{e.action === 'admin_set' && e.detail.result ? `: ${describe({ kind: e.detail.kind as RollKind, result: e.detail.result as RollRow['result'] })}` : ''}
										{e.action === 'locked' && e.detail.reason ? `: ${String(e.detail.reason)}` : ''}
										{e.actor_id && e.actor_id !== player.id ? ' (by an admin)' : ''}
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</div>
	);
}

/** Staff edit for the picked character (inside its section): set its stats, Potential or power fields by hand. */
function StaffEditPanel({ characterId }: { characterId: string }) {
	const [c, setC] = useState<AdminCharacter | null | undefined>(undefined);
	const [error, setError] = useState('');
	const reload = () => loadAdminCharacter(characterId).then(setC, (e) => setError(messageOf(e)));
	useEffect(() => {
		setC(undefined);
		setError('');
		reload();
	}, [characterId]);
	return (
		<div class="ov-staff">
			<p class="pf-subhead">Staff edit</p>
			{error ? (
				<p class="portal-error">{error}</p>
			) : c === undefined ? (
				<p class="portal-status">Loading…</p>
			) : !c ? (
				<p class="pf-empty">This character no longer exists.</p>
			) : c.kind !== 'oc' ? (
				<p class="pf-help">Canon tryouts don’t have stats to set.</p>
			) : c.approved_at ? (
				<p class="pf-help">{c.name} is approved, so its stats change through evolutions. Staff edit is for characters that aren’t approved yet.</p>
			) : (
				<StaffEditor c={c} onSaved={reload} />
			)}
		</div>
	);
}

/** Players: search, then one player's characters, rolls, codes, roll ban, grants and history. */
export function PlayersView({
	players,
	focus,
	focusCharacter,
	onFocus,
}: {
	players: PlayerSummary[];
	focus: string | null;
	/** The character to show first (opened from a review). */
	focusCharacter?: string | null;
	onFocus: (id: string | null) => void;
}) {
	const [query, setQuery] = useState('');
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return players.filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.discord_id.includes(q));
	}, [players, query]);
	const selected = players.find((p) => p.id === focus) ?? null;

	return (
		<div class="ov ov-layout">
			<div class="hud-panel ov-list">
				<h3 class="hud-panel-title">Players</h3>
				<input type="search" class="ov-search" placeholder="Search name or Discord ID" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search players" />
				<ul>
					{shown.map((p) => (
						<li key={p.id}>
							<button type="button" class={selected?.id === p.id ? 'active' : undefined} onClick={() => onFocus(p.id)}>
								{p.avatar_url && <img src={p.avatar_url} alt="" width={28} height={28} />}
								<span>{p.display_name}</span>
							</button>
						</li>
					))}
					{shown.length === 0 && <li class="pf-empty">No players found. Players appear here after they log in once.</li>}
				</ul>
			</div>
			{selected ? <PlayerDetail key={selected.id} player={selected} players={players} initialCharacter={focusCharacter} /> : <p class="pf-empty ov-pick">Pick a player to see their rolls, roll ban and grants.</p>}
		</div>
	);
}
