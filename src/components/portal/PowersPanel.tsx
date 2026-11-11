// The admin panel's Powers view: design custom powers (a Cursed Technique, a Stand, a Quirk…) on a
// series' card, with drawbacks and an optional skill tree, then grant them to a player's account or
// straight onto one of their characters. The database checks admin rights on every action.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AdminCharacter, PlayerSummary } from '../../lib/portal/api.ts';
import {
	deletePower,
	familyList,
	grantPower,
	grantPowerToFamily,
	powerFamilies,
	revokeFamilyPower,
	type PowerFamilyRow,
	grantPowerToCharacter,
	loadPowers,
	powerGrants,
	revokePowerGrant,
	savePower,
	DEFAULT_EVOLUTION,
	lockText,
	type EvolutionRules,
	type CustomPower,
	type PowerAbility,
	type PowerGrantRow,
} from '../../lib/portal/powers.ts';
import type { SystemEntry } from '../../lib/portal/sheet.ts';
import { systemById } from '../../lib/portal/systems.ts';
import { AbilityBuilder } from '../families/PerkBuilders.tsx';
import { CustomTreeBuilder } from './CustomTreeBuilder.tsx';
import { PowerScalingBox } from './SkillScaling.tsx';
import { defaults } from './SystemsSection.tsx';
import { SelectField, TextArea, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const ACCOUNT = '__account__';

interface Draft {
	id: string | null;
	name: string;
	ability: PowerAbility;
	description: string;
	drawbacks: string;
	tree: CustomPower['tree'];
	evolves_to: string | null;
	evolution: EvolutionRules;
}

const blankDraft = (): Draft => ({ id: null, name: '', ability: { system: 'abilities', fields: defaults(systemById.get('abilities')!.fields), skills: [] }, description: '', drawbacks: '', tree: null, evolves_to: null, evolution: { ...DEFAULT_EVOLUTION } });
const draftOf = (p: CustomPower): Draft => ({ id: p.id, name: p.name, ability: structuredClone(p.ability), description: p.description, drawbacks: p.drawbacks, tree: p.tree ? structuredClone(p.tree) : null, evolves_to: p.evolves_to ?? null, evolution: { ...DEFAULT_EVOLUTION, ...(p.evolution ?? {}) } });
const systemOf = (d: { ability: PowerAbility }) => d.ability.system ?? 'abilities';

export function PowersPanel(props: { players: PlayerSummary[]; characters: AdminCharacter[]; onChanged?: () => void }) {
	const [powers, setPowers] = useState<CustomPower[] | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [error, setError] = useState('');

	const reload = () =>
		loadPowers().then(
			(p) => (setPowers(p), p),
			(e) => (setError(messageOf(e)), [] as CustomPower[]),
		);
	useEffect(() => void reload(), []);

	if (error && !powers) return <p class="portal-error">{error}</p>;
	if (!powers) return <p class="portal-status">Loading powers…</p>;

	if (draft)
		return (
			<PowerEditor
				key={draft.id ?? 'new'}
				initial={draft}
				saved={powers.find((p) => p.id === draft.id) ?? null}
				powers={powers}
				players={props.players}
				characters={props.characters}
				onClose={() => setDraft(null)}
				onSaved={async (id) => {
					const list = await reload();
					const p = list.find((x) => x.id === id);
					if (p) setDraft(draftOf(p));
				}}
				onDeleted={async () => {
					setDraft(null);
					await reload();
				}}
				onGranted={props.onChanged}
			/>
		);

	return (
		<div class="pw">
			<div class="pw-head">
				<p class="pf-intro">Design custom powers on a series’ card, then grant them to a player’s account or straight onto one of their characters.</p>
				<button type="button" class="pf-button primary" onClick={() => setDraft(blankDraft())}>
					＋ New power
				</button>
			</div>
			{powers.length ? (
				<ul class="pw-grid">
					{powers.map((p) => (
						<li key={p.id}>
							<button type="button" class="pw-tile" onClick={() => setDraft(draftOf(p))}>
								<span class="pw-tile-system">{systemById.get(p.system)?.label ?? p.system}</span>
								<strong>{p.name}</strong>
								{p.description.trim() && <span class="pw-tile-about">{p.description.replace(/\*\*|(^|\W)_|_(?=\W|$)/g, '$1').trim().slice(0, 140)}</span>}
								<span class="pw-tile-meta">
									{p.tree ? 'Skill tree · ' : ''}
									{p.evolves_to ? `Evolves into ${powers.find((x) => x.id === p.evolves_to)?.name ?? 'another power'} · ` : ''}
									{powers.some((x) => x.evolves_to === p.id) ? 'Evolved stage · ' : ''}Updated {when(p.updated_at)}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<p class="pf-empty">No powers yet. Make the first one.</p>
			)}
		</div>
	);
}

function PowerEditor(props: {
	initial: Draft;
	saved: CustomPower | null;
	powers: CustomPower[];
	players: PlayerSummary[];
	characters: AdminCharacter[];
	onClose: () => void;
	onSaved: (id: string) => void;
	onDeleted: () => void;
	onGranted?: () => void;
}) {
	const [d, setD] = useState<Draft>(props.initial);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [confirmDelete, setConfirmDelete] = useState(false);
	const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
	const system = systemOf(d);
	const dirty = JSON.stringify(d) !== JSON.stringify(props.initial);

	// The tree builder works on a card; this one stands in for the power's.
	const entry: SystemEntry = { key: 'power', system, fields: d.ability.fields, skills: d.ability.skills, description: '', rollProofs: {}, customTree: d.tree };

	async function save() {
		setBusy(true);
		setMsg('');
		try {
			// With the usual scaling, skills keep none of their own.
			const ability = d.ability.scaling?.custom ? d.ability : { ...d.ability, scaling: undefined, skills: d.ability.skills.map(({ scaling: _, ...sk }) => sk) };
			const id = await savePower({ id: d.id, name: d.name.trim(), system, ability, description: d.description, drawbacks: d.drawbacks, tree: d.tree, evolves_to: d.evolves_to, evolution: d.evolution });
			setMsg('Saved.');
			props.onSaved(id);
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	async function remove() {
		if (!d.id) return;
		setBusy(true);
		try {
			await deletePower(d.id);
			props.onDeleted();
		} catch (e) {
			setMsg(messageOf(e));
			setBusy(false);
		}
	}

	return (
		<div class="pw pf">
			<div class="pw-head">
				<button type="button" class="df-back-btn" onClick={props.onClose}>
					← All powers
				</button>
				<h3 class="pw-title">{d.name.trim() || (d.id ? 'Unnamed power' : 'New power')}</h3>
			</div>

			<fieldset class="sys-group pf-wide">
				<legend>Power</legend>
				<div class="pf-grid">
					<TextField label="Name" required value={d.name} placeholder="e.g. Maximum All For One" onInput={(v) => set({ name: v })} help="The card’s title on the character." />
				</div>
			</fieldset>

			<PowerScalingBox system={system} value={d.ability.scaling} onChange={(scaling) => set({ ability: { ...d.ability, scaling } })} />

			<AbilityBuilder forPower ownScaling={Boolean(d.ability.scaling?.custom)} value={d.ability} onChange={(ability) => set({ ability, tree: systemOf({ ability }) === system ? d.tree : null })} description={d.description} onDescription={(description) => set({ description })} />

			<fieldset class="sys-group pf-wide">
				<legend>Drawbacks</legend>
				<div class="pf-grid">
					<TextArea label="Drawbacks" rows={4} value={d.drawbacks} placeholder="What it costs, what it can’t do, what can go wrong. **bold** and _italic_ work." onInput={(drawbacks) => set({ drawbacks })} />
				</div>
			</fieldset>

			<fieldset class="sys-group pf-wide">
				<legend>Skill tree</legend>
				<p class="pf-help">Optional. Players get this tree on the card and unlock its skills with its points; they can’t change it.</p>
				<CustomTreeBuilder entry={entry} disabled={false} onChange={(tree) => set({ tree })} />
			</fieldset>

			<EvolutionBox d={d} powers={props.powers} onChange={set} />

			<div class="pw-actions">
				<button type="button" class="pf-button primary" disabled={busy || !d.name.trim() || (!dirty && Boolean(d.id))} onClick={save}>
					{d.id ? 'Save changes' : 'Create power'}
				</button>
				{d.id &&
					(confirmDelete ? (
						<>
							<span class="pf-help">Delete it and its unused grants? Cards already on characters stay.</span>
							<button type="button" class="pf-button danger" disabled={busy} onClick={remove}>
								Yes, delete
							</button>
							<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(false)}>
								Keep it
							</button>
						</>
					) : (
						<button type="button" class="pf-button subtle" onClick={() => setConfirmDelete(true)}>
							Delete power
						</button>
					))}
				{msg && (
					<span class="pf-help" role="status">
						{msg}
					</span>
				)}
			</div>
			{dirty && d.id && <p class="pf-help">Save your changes before granting. Players with this power see an “Update the card” button after you change it.</p>}

			{props.saved && !dirty && <GrantBox power={props.saved} players={props.players} characters={props.characters} onGranted={props.onGranted} />}
			{props.saved && !dirty && <FamilyGrantBox power={props.saved} />}
		</div>
	);
}

/** Grant a saved power, and the list of who has it. */
function GrantBox(props: { power: CustomPower; players: PlayerSummary[]; characters: AdminCharacter[]; onGranted?: () => void }) {
	const [grants, setGrants] = useState<PowerGrantRow[] | null>(null);
	const [player, setPlayer] = useState('');
	const [target, setTarget] = useState(ACCOUNT);
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [revoking, setRevoking] = useState<number | null>(null);

	const load = () => powerGrants({ power: props.power.id }).then(setGrants, (e) => setMsg(messageOf(e)));
	useEffect(() => void load(), [props.power.id]);

	const players = useMemo(() => [...props.players].sort((a, b) => a.display_name.localeCompare(b.display_name)), [props.players]);
	const theirs = props.characters.filter((c) => c.owner_id === player && c.status !== 'denied');

	async function grant() {
		setBusy(true);
		setMsg('');
		try {
			if (target === ACCOUNT) await grantPower(props.power.id, player, note.trim());
			else await grantPowerToCharacter(props.power, target, note.trim());
			const who = players.find((p) => p.id === player)?.display_name ?? 'the player';
			const where = target === ACCOUNT ? `${who}’s account` : (theirs.find((c) => c.id === target)?.name ?? 'the character');
			setMsg(`Granted to ${where}.`);
			setNote('');
			await load();
			props.onGranted?.();
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	async function revoke(g: PowerGrantRow, removeCard: boolean) {
		setBusy(true);
		try {
			await revokePowerGrant(g.id, removeCard);
			setRevoking(null);
			await load();
			props.onGranted?.();
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<fieldset class="sys-group pf-wide pw-grant">
			<legend>Grant it</legend>
			<div class="pf-grid">
				<SelectField
					label="Player"
					value={player}
					placeholder="Pick a player…"
					options={players.map((p) => ({ value: p.id, label: p.display_name }))}
					onChange={(v) => (setPlayer(v), setTarget(ACCOUNT))}
				/>
				<SelectField
					label="Where"
					value={target}
					disabled={!player}
					options={[
						{ value: ACCOUNT, label: 'Their account (they add it as a card)' },
						...theirs.map((c) => ({ value: c.id, label: `${c.name || 'Unnamed'} (${c.status.replace('_', ' ')})`, group: 'Straight onto a character' })),
					]}
					onChange={setTarget}
					help={target === ACCOUNT ? 'Waits on their account until they add it on a new character or an evolution. Approval uses it up.' : 'Added to the character’s card list now, approved sheet included.'}
				/>
				<TextField label="Note" value={note} placeholder="Optional, e.g. event reward" onInput={setNote} help="They see it next to the power." />
			</div>
			<div class="pw-actions">
				<button type="button" class="pf-button primary" disabled={busy || !player} onClick={grant}>
					Grant {props.power.name}
				</button>
				{msg && (
					<span class="pf-help" role="status">
						{msg}
					</span>
				)}
			</div>

			<h4 class="pf-subhead">Who has it</h4>
			{!grants ? (
				<p class="portal-status">Loading…</p>
			) : grants.length ? (
				<ul class="pw-grants">
					{grants.map((g) => (
						<li key={g.id} class="pw-grant-row">
							<div>
								<strong>{g.player_name ?? 'Unknown player'}</strong>
								<span class="pf-help">
									{g.character_id ? `On ${g.character_name ?? 'a character'}` : 'Waiting on their account'} · {when(g.granted_at)}
									{g.note ? ` · ${g.note}` : ''}
								</span>
							</div>
							{revoking === g.id ? (
								<div class="pw-revoke">
									<button type="button" class="pf-button danger" disabled={busy} onClick={() => revoke(g, true)}>
										Take back and remove the card
									</button>
									{g.character_id && (
										<button type="button" class="pf-button" disabled={busy} onClick={() => revoke(g, false)}>
											Take back, keep the card
										</button>
									)}
									<button type="button" class="pf-button subtle" onClick={() => setRevoking(null)}>
										Cancel
									</button>
								</div>
							) : (
								<button type="button" class="pf-button subtle" onClick={() => setRevoking(g.id)}>
									Take back
								</button>
							)}
						</li>
					))}
				</ul>
			) : (
				<p class="pf-empty">Not granted to anyone yet.</p>
			)}
		</fieldset>
	);
}

/** Give a saved power to a family (its owner hands it to members), and the families that have it. */
function FamilyGrantBox(props: { power: CustomPower }) {
	const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
	const [rows, setRows] = useState<PowerFamilyRow[] | null>(null);
	const [family, setFamily] = useState('');
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState('');
	const [revoking, setRevoking] = useState<number | null>(null);

	const load = () => powerFamilies(props.power.id).then(setRows, (e) => setMsg(messageOf(e)));
	useEffect(() => {
		familyList().then(setFamilies, (e) => setMsg(messageOf(e)));
	}, []);
	useEffect(() => void load(), [props.power.id]);
	const has = new Set(rows?.map((r) => r.family_id));

	async function run(fn: () => Promise<void>, done: string) {
		setBusy(true);
		setMsg('');
		try {
			await fn();
			setMsg(done);
			await load();
		} catch (e) {
			setMsg(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<fieldset class="sys-group pf-wide pw-grant">
			<legend>Give it to a family</legend>
			<p class="pf-help">The family’s owner hands it to members on the family’s Roster tab, and the card goes straight onto that character. The owner can take it back.</p>
			<div class="pf-grid">
				<SelectField
					label="Family"
					value={family}
					placeholder="Pick a family…"
					options={families.filter((f) => !has.has(f.id)).map((f) => ({ value: f.id, label: f.name }))}
					onChange={setFamily}
				/>
				<TextField label="Note" value={note} placeholder="Optional, e.g. founding technique" onInput={setNote} help="The owner sees it next to the power." />
			</div>
			<div class="pw-actions">
				<button
					type="button"
					class="pf-button primary"
					disabled={busy || !family}
					onClick={() => run(() => grantPowerToFamily(props.power.id, family, note.trim()).then(() => (setFamily(''), setNote(''))), `Given to ${families.find((f) => f.id === family)?.name ?? 'the family'}.`)}
				>
					Give {props.power.name}
				</button>
				{msg && (
					<span class="pf-help" role="status">
						{msg}
					</span>
				)}
			</div>
			{rows && rows.length > 0 && (
				<>
					<h4 class="pf-subhead">Families with it</h4>
					<ul class="pw-grants">
						{rows.map((r) => (
							<li key={r.id} class="pw-grant-row">
								<div>
									<strong>{r.family_name}</strong>
									<span class="pf-help">
										{r.holders === 0 ? 'Not handed out yet' : `On ${r.holders} member${r.holders === 1 ? '' : 's'}`} · {when(r.granted_at)}
										{r.note ? ` · ${r.note}` : ''}
									</span>
								</div>
								{revoking === r.id ? (
									<div class="pw-revoke">
										<button type="button" class="pf-button danger" disabled={busy} onClick={() => run(() => revokeFamilyPower(r.id).then(() => setRevoking(null)), `Taken back from ${r.family_name}.`)}>
											Take back{r.holders ? ' and remove the cards' : ''}
										</button>
										<button type="button" class="pf-button subtle" onClick={() => setRevoking(null)}>
											Cancel
										</button>
									</div>
								) : (
									<button type="button" class="pf-button subtle" onClick={() => setRevoking(r.id)}>
										Take back
									</button>
								)}
							</li>
						))}
					</ul>
				</>
			)}
		</fieldset>
	);
}

/** What this power evolves into, and how: the meter on the card and the wait after pressing Evolve. */
function EvolutionBox({ d, powers, onChange }: { d: Draft; powers: CustomPower[]; onChange: (patch: Partial<Draft>) => void }) {
	const e = d.evolution;
	const setE = (patch: Partial<EvolutionRules>) => onChange({ evolution: { ...e, ...patch } });
	const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));
	const from = powers.filter((p) => p.evolves_to === d.id && d.id);
	return (
		<fieldset class="sys-group pf-wide pw-evolve">
			<legend>Evolution</legend>
			<p class="pf-help">
				Optional. Build each stage as its own power (e.g. Inferior Shrine, then Superior Shrine) and pick the next stage here. The card shows a meter; once it’s full the
				player presses Evolve, waits out the lock, and the card becomes the next stage.
				{from.length > 0 && ` ${from.map((p) => p.name).join(', ')} evolve${from.length === 1 ? 's' : ''} into this one.`}
			</p>
			<div class="pf-grid">
				<SelectField
					label="Evolves into"
					value={d.evolves_to ?? ''}
					options={[{ value: '', label: 'Nothing (final stage)' }, ...powers.filter((p) => p.id !== d.id).map((p) => ({ value: p.id, label: p.name }))]}
					onChange={(v) => onChange({ evolves_to: v || null })}
				/>
				{d.evolves_to && (
					<>
						<TextField label="Meter name" value={e.meter} placeholder="e.g. Metamorphosis" onInput={(meter) => setE({ meter })} />
						<TextField label="Meter size" type="text" value={String(e.max)} onInput={(v) => setE({ max: num(v, 1, 100000) })} help="Full at this many points." />
						<TextField
							label="Points per training log"
							type="text"
							value={String(e.perLog)}
							onInput={(v) => setE({ perLog: num(v, 0, 1000) })}
							help="Added when staff approve a training log that used the card. Traits don’t change it. Staff add the rest (combat) by hand."
						/>
						<TextField label="Lock: days" type="text" value={String(e.lockDays)} onInput={(v) => setE({ lockDays: num(v, 0, 365) })} help="0 for none." />
						<TextField label="Lock: RPs that end it early" type="text" value={String(e.lockRps)} onInput={(v) => setE({ lockRps: num(v, 0, 100) })} help="Approved training logs after pressing Evolve. 0 for none." />
					</>
				)}
			</div>
			{d.evolves_to && (
				<>
					<label class="mafo-toggle">
						<input type="checkbox" checked={e.treeFirst} onChange={(ev) => setE({ treeFirst: ev.currentTarget.checked })} />
						<span>The skill tree must be complete first (the meter only fills after that)</span>
					</label>
					<p class="pf-help">
						{e.lockDays || e.lockRps ? `The card is locked for ${lockText(e)} after pressing Evolve.` : 'With no lock, the card evolves as soon as Evolve is pressed.'} Skills the player wrote and their description carry over; the next stage starts with its own tree.
					</p>
				</>
			)}
		</fieldset>
	);
}

