// The Inheritance: the first step of a character made for a family, on the family's own page.
// The player sees every perk the way members get it: Guaranteed ones are theirs, they take the
// ones members can pick, ask the owner to roll the rolled ones, and choose how their family's
// systems start. Then they carry on to the rest of the sheet in the character form.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PERK_ACCESS, PERK_KINDS, groupPerks, type BoardPerk, type FamilyBundle, type SystemOption } from '../../lib/families/api.ts';
import {
	askInheritanceAccess,
	loadCharacterInheritanceRolls,
	loadMyInheritanceAccess,
	type AccessStatus,
	loadInheritanceCharacter,
	requestInheritanceRoll,
	saveInheritanceCharacter,
	withdrawInheritanceRoll,
} from '../../lib/families/inheritanceApi.ts';
import { inheritedPerks, readable, type InheritanceRoll, type ReadablePerk } from '../../lib/portal/inheritance.ts';
import type { CharacterDraft } from '../../lib/portal/api.ts';
import { rules } from '../../lib/portal/rules.ts';
import { optionKey, type Inheritance } from '../../lib/portal/sheet.ts';
import { systemById } from '../../lib/portal/systems.ts';
import { PerkBuilt, isBuilt } from './PerkBuilders.tsx';
import { messageOf } from './shared.tsx';

const portal = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const kindLabel = (p: BoardPerk) => PERK_KINDS.find((k) => k.id === p.kind)?.label ?? 'Perk';
const fieldLabel = (system: string, key: string) => systemById.get(system)?.fields.find((f) => f.key === key)?.label ?? key;
const potentialLabel = (id: string) => rules.potentials.find((p) => p.id === id)?.label ?? id;

const LATER: Record<string, string> = { earned: 'Earned in RP once you’re a member', taught: 'Taught by a member once you’re in' };

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

/** One roll: ask for it, wait, or see how it went. */
function RollControl(props: { roll: InheritanceRoll | undefined; busy: boolean; locked: boolean; onAsk: () => void; onWithdraw: (r: InheritanceRoll) => void }) {
	const r = props.roll;
	if (!r)
		return (
			<button type="button" class="pf-button" disabled={props.busy || props.locked} onClick={props.onAsk}>
				🎲 Ask the owner to roll
			</button>
		);
	if (r.status === 'pending')
		return (
			<span class="ih-roll waiting">
				<span>⏳ Waiting for the owner’s roll</span>
				{!props.locked && (
					<button type="button" class="pf-button subtle" disabled={props.busy} onClick={() => props.onWithdraw(r)}>
						Take back
					</button>
				)}
			</span>
		);
	return (
		<span class={`ih-roll ${r.status}`}>
			<span>{r.status === 'won' ? '✅ Rolled: you got it' : '❌ Rolled: it didn’t land'}</span>
			{r.proof && (
				<a href={r.proof} target="_blank" rel="noreferrer">
					See the roll
				</a>
			)}
			{r.note && <span class="ih-roll-note">“{r.note}”</span>}
		</span>
	);
}

/** Hidden perks (all of a sealed family's) stay locked until the owner lets the player in. */
function AccessPanel({ b, locked }: { b: FamilyBundle; locked: number }) {
	const [status, setStatus] = useState<AccessStatus | null | undefined>(undefined);
	const [message, setMessage] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		loadMyInheritanceAccess(b.family.id).then((a) => setStatus(a?.status ?? null), () => setStatus(null));
	}, [b.family.id]);
	if (status === undefined || status === 'allowed') return null;

	async function ask() {
		setBusy(true);
		setError('');
		try {
			await askInheritanceAccess(b.family.id, message);
			setStatus('pending');
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	const what = b.family.sealed ? `${b.family.name} is sealed` : `${locked} of ${b.family.name}’s perks ${locked === 1 ? 'is' : 'are'} for members only`;
	return (
		<div class="ih-access">
			<p class="ih-access-title">🔒 {what}</p>
			{status === 'pending' ? (
				<p class="pf-help">You asked to see the whole Inheritance. You’ll be pinged on Discord when the owner decides.</p>
			) : (
				<>
					<p class="pf-help">
						{status === 'declined' ? 'The owner declined last time. You can ask again.' : 'Ask the owner to let you in, and you’ll see every perk while you build.'}
					</p>
					<div class="ih-access-form">
						<div class="pf-field">
							<input aria-label="Message to the owner" value={message} maxLength={500} placeholder="A message to the owner (optional)" onInput={(e) => setMessage(e.currentTarget.value)} />
						</div>
						<button type="button" class="pf-button primary" disabled={busy} onClick={ask}>
							Ask to see the Inheritance
						</button>
					</div>
				</>
			)}
			{error && <p class="portal-error">{error}</p>}
		</div>
	);
}

export function InheritanceBuilder({ b, characterId }: { b: FamilyBundle; characterId: string }) {
	const [draft, setDraft] = useState<CharacterDraft | null>(null);
	const [rolls, setRolls] = useState<InheritanceRoll[]>([]);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [save, setSave] = useState<SaveState>('saved');
	const latest = useRef<CharacterDraft | null>(null);
	latest.current = draft;

	useEffect(() => {
		Promise.all([loadInheritanceCharacter(characterId), loadCharacterInheritanceRolls(characterId)]).then(([c, r]) => {
			setDraft(c);
			setRolls(r);
		}, (e) => setError(messageOf(e)));
	}, [characterId]);

	// Save a moment after the last change.
	useEffect(() => {
		if (save !== 'unsaved') return;
		const t = setTimeout(async () => {
			const c = latest.current;
			if (!c?.name.trim()) return;
			setSave('saving');
			try {
				await saveInheritanceCharacter(c);
				setSave((s) => (s === 'saving' ? 'saved' : s));
			} catch (e) {
				setError(messageOf(e));
				setSave('error');
			}
		}, 700);
		return () => clearTimeout(t);
	}, [draft, save]);

	const perks = useMemo(() => b.perks.filter((p) => p.family_id === b.family.id), [b.perks]);
	const groups = useMemo(() => groupPerks(perks, b.family.perk_sections), [perks]);

	if (error && !draft) return <p class="portal-error">{error}</p>;
	if (!draft) return <p class="portal-status">Loading your character…</p>;
	const inh = draft.sheet.inheritance;
	if (!inh || inh.familyId !== b.family.id)
		return <p class="portal-error">This character wasn’t started for {b.family.name}. Only characters made here can join it.</p>;

	const locked = Boolean(draft.approvedAt) || draft.status === 'denied';
	const got = inheritedPerks(perks, inh, rolls);
	const gotIds = new Set(got.map((p) => p.id));
	const rollOf = (perkId: string, option = '') => rolls.find((r) => r.perk_id === perkId && r.option === option);
	const waiting = rolls.filter((r) => r.status === 'pending').length;

	function changeInh(fn: (i: Inheritance) => void) {
		setDraft((d) => {
			if (!d?.sheet.inheritance) return d;
			const next = structuredClone(d);
			fn(next.sheet.inheritance!);
			return next;
		});
		setSave('unsaved');
	}
	const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	async function ask(perkId: string, option = '') {
		setBusy(true);
		setError('');
		try {
			// The database checks the saved sheet, so save the picks first.
			if (save !== 'saved') await saveInheritanceCharacter(latest.current!);
			const r = await requestInheritanceRoll(characterId, perkId, option);
			setRolls((list) => [...list.filter((x) => x.id !== r.id), r]);
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}
	async function withdraw(r: InheritanceRoll) {
		setBusy(true);
		setError('');
		try {
			await withdrawInheritanceRoll(r.id);
			setRolls((list) => list.filter((x) => x.id !== r.id));
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	function control(p: ReadablePerk) {
		if (p.access === 'automatic') return <span class="ih-state got">✓ Inherited</span>;
		if (p.access === 'choice') {
			const on = inh!.picks.includes(p.id);
			return (
				<button type="button" class={`pf-button${on ? ' primary' : ''}`} aria-pressed={on} disabled={locked} onClick={() => changeInh((i) => void (i.picks = toggle(i.picks, p.id)))}>
					{on ? '✓ Taken' : 'Take it'}
				</button>
			);
		}
		if (p.access === 'rolled') return <RollControl roll={rollOf(p.id)} busy={busy} locked={locked} onAsk={() => ask(p.id)} onWithdraw={withdraw} />;
		return <span class="ih-state later">{LATER[p.access] ?? 'Later'}</span>;
	}

	function optionControl(p: ReadablePerk, o: SystemOption) {
		if (o.access === 'banned') return <span class="ih-state banned">Not allowed</span>;
		if (o.access === 'rolled') return <RollControl roll={rollOf(p.id, `${o.field}=${o.value}`)} busy={busy} locked={locked} onAsk={() => ask(p.id, `${o.field}=${o.value}`)} onWithdraw={withdraw} />;
		const key = optionKey(p.id, o.field, o.value);
		const on = inh!.options.includes(key);
		return (
			<button
				type="button"
				class={`pf-button${on ? ' primary' : ''}`}
				aria-pressed={on}
				disabled={locked}
				onClick={() =>
					changeInh((i) => {
						// One start value per field.
						const same = (k: string) => k.startsWith(`${p.id}|${o.field}=`);
						i.options = on ? i.options.filter((k) => k !== key) : [...i.options.filter((k) => !same(k)), key];
					})
				}
			>
				{on ? '✓ Starting with it' : 'Start with it'}
			</button>
		);
	}

	function extras(p: ReadablePerk) {
		if (!gotIds.has(p.id)) return null;
		const sr = p.kind === 'system_start' ? p.details?.systemRules : undefined;
		const tr = p.kind === 'trait_slots' ? p.details?.traitRules : undefined;
		return (
			<>
				{sr && sr.options.length > 0 && (
					<ul class="ih-options">
						{sr.options.map((o) => (
							<li key={`${o.field}=${o.value}`}>
								<span class="ih-option-name">
									{fieldLabel(sr.system, o.field)}: <strong>{o.value}</strong>
									{o.detail && <span class="pf-help"> · {o.detail}</span>}
								</span>
								{optionControl(p, o)}
							</li>
						))}
					</ul>
				)}
				{tr && tr.potentials.length > 0 && (
					<div class="pf-field ih-potential">
						<label class="pf-label" for={`ih-pot-${p.id}`}>
							Your Potential
						</label>
						<select id={`ih-pot-${p.id}`} value={inh!.potential} disabled={locked} onChange={(e) => changeInh((i) => void (i.potential = e.currentTarget.value))}>
							<option value="">Roll it as usual</option>
							{tr.potentials.map((id) => (
								<option key={id} value={id}>
									{potentialLabel(id)}
								</option>
							))}
						</select>
						<p class="pf-help">{b.family.name} members can pick their Potential instead of rolling.</p>
					</div>
				)}
			</>
		);
	}

	async function continueToSheet() {
		setBusy(true);
		try {
			if (!locked && save !== 'saved') await saveInheritanceCharacter(latest.current!);
			location.href = sheetHref;
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
		}
	}

	const saveText = { saved: 'Saved', saving: 'Saving…', unsaved: 'Saving soon…', error: 'Couldn’t save' }[save];
	const sheetHref = `${portal}submit/?id=${encodeURIComponent(characterId)}#basics`;

	return (
		<section class="pf-section ih">
			<header class="ih-head">
				<p class="ih-kicker">Inheritance · {b.family.name}</p>
				<div class="pf-field ih-name">
					<label class="pf-label" for="ih-name">
						Character name
					</label>
					<input
						id="ih-name"
						value={draft.name}
						maxLength={100}
						disabled={locked}
						onInput={(e) => {
							const name = e.currentTarget.value;
							setDraft((d) => (d ? { ...d, name } : d));
							setSave('unsaved');
						}}
					/>
				</div>
				<p class="pf-intro">
					This is what {draft.name.trim() || 'your character'} is born with. Guaranteed perks are already yours. Take the ones members can pick, and ask the owner to roll the
					rolled ones. When you’re happy, carry on to the rest of the sheet. {b.family.name}’s owner reviews the character first.
				</p>
				<p class="ih-tally">
					<span class="fm-chip good">{got.length} inherited</span>
					{waiting > 0 && <span class="fm-chip">{waiting} roll{waiting === 1 ? '' : 's'} waiting</span>}
				</p>
			</header>

			{perks.some((p) => !readable(p)) && !locked && <AccessPanel b={b} locked={perks.filter((p) => !readable(p)).length} />}

			{groups.map((g) => (
				<div class="ih-group" key={g.id}>
					<h3 class="fm-perk-kind">{g.label}</h3>
					<div class="ih-list">
						{g.rows.map((p) => {
							if (!readable(p))
								return (
									<article class="ih-perk locked" key={p.id}>
										<div class="ih-perk-main">
											<p class="ih-perk-title">🔒 Hidden perk</p>
											<p class="pf-help">Members only. You’ll see it once the owner lets you in.</p>
										</div>
									</article>
								);
							const mine = gotIds.has(p.id);
							return (
								<article class={`ih-perk${mine ? ' got' : ''}`} key={p.id}>
									<div class="ih-perk-main">
										<p class="ih-perk-title">{p.title}</p>
										<p class="ih-perk-sub">
											{kindLabel(p)} · {PERK_ACCESS.find((a) => a.id === p.access)?.label.replace(/:.*/, '')}
										</p>
										{p.description && <p class="ih-perk-text">{p.description}</p>}
										{isBuilt(p.kind) && (
											<details class="ih-more">
												<summary>What it gives</summary>
												<PerkBuilt kind={p.kind} details={p.details} />
											</details>
										)}
									</div>
									<div class="ih-perk-act">{control(p)}</div>
									{extras(p)}
								</article>
							);
						})}
					</div>
				</div>
			))}
			{groups.length === 0 && <p class="pf-empty">{b.family.name} hasn’t listed any perks yet.</p>}

			{error && <p class="portal-error">{error}</p>}
			<div class="ih-bar">
				<span class="ih-save" role="status">
					{locked ? (draft.approvedAt ? 'Approved' : 'Denied') : saveText}
				</span>
				<button type="button" class="pf-button primary" disabled={!draft.name.trim() || busy} onClick={continueToSheet}>
					Continue to the sheet →
				</button>
			</div>
		</section>
	);
}
