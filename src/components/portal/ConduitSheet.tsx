// inFAMOUS card pieces: what the class and levels work out to, evolution items with the Arc Roll,
// and the Karma bar.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BIO_ITEMS, DOMINATION, ITEMS, KARMA_BOMB_RELAYS, KARMA_RANKS, KARMA_THRESHOLDS, PHASES, PUPPET_KINDS, PUPPET_TARGETS, bioGain, conduitStats, growsMoves, karmaRank, puppetRolls, puppetsOf, relayMoves, type Puppet } from '../../lib/portal/conduits.ts';
import { RESULT_TEXT, type EvolutionRoll } from '../../lib/portal/evolutionRolls.ts';
import type { Fields } from '../../lib/portal/systems.ts';
import { RollHistory } from './EvolutionRolls.tsx';
import { SelectField, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const num = (v: unknown) => Number(v) || 0;

export function ConduitStats({ fields }: { fields: Fields }) {
	const s = conduitStats(fields);
	const bio = fields.class === 'Biologically Enhanced';
	if (!s.power && !s.phase && !bio) return null;
	const fuel = fields.class === 'Energy' ? 'Energy' : 'Elemental';
	return (
		<div class="sp-group pf-wide dv-stats cf-stats">
			<h4 class="pf-subhead">Your {String(fields.class)} Conduit</h4>
			<dl class="dv-tiles">
				{s.tank && (
					<div class="dv-tile blood">
						<dt>{fuel} Tank</dt>
						<dd>
							{s.tank.ep} <small>EP</small>
						</dd>
						<dd class="ff-power">
							{s.tank.specials} Specials{s.tank.max ? ' · Max' : ''}
						</dd>
					</div>
				)}
				{s.power && (
					<div class="dv-tile">
						<dt>Power {s.power.level}</dt>
						<dd class="dv-text">Gets through {s.power.beats} Defense</dd>
					</div>
				)}
				{s.drain && (
					<div class="dv-tile">
						<dt>Drain</dt>
						<dd class="dv-text">
							{s.drain.gain} · {s.drain.turns} turn{s.drain.turns === 1 ? '' : 's'}
						</dd>
					</div>
				)}
				{s.charge !== null && (
					<div class="dv-tile">
						<dt>Charge</dt>
						<dd>
							+{s.charge} <small>EP a turn</small>
						</dd>
					</div>
				)}
				{s.heal && (
					<div class="dv-tile">
						<dt>Heal {s.heal[0]}</dt>
						<dd class="dv-text">{s.heal[1]} or below</dd>
					</div>
				)}
				{s.phase && (
					<>
						<div class="dv-tile blood">
							<dt>Phase {s.phase.id}</dt>
							<dd class="dv-text">Telekinesis: {s.phase.lifts}</dd>
						</div>
						<div class="dv-tile">
							<dt>Takeover</dt>
							<dd class="dv-text">{s.phase.takeover}</dd>
						</div>
						<div class="dv-tile">
							<dt>Victim resists</dt>
							<dd class="dv-text">{s.phase.resist}</dd>
						</div>
						<div class="dv-tile">
							<dt>Breaks free</dt>
							<dd class="dv-text">{s.phase.breakFree}</dd>
						</div>
					</>
				)}
				{bio &&
					bioGain(fields).map((b) => (
						<div class="dv-tile" key={b.key}>
							<dt>{b.item}</dt>
							<dd>
								+{b.gain} <small>Physical Points</small>
							</dd>
						</div>
					))}
			</dl>
			{s.tank && (
				<p class="pf-help">
					{fuel} Blast costs {fuel === 'Energy' ? 50 : 30} EP; a Special hits for 3× your Power and comes back when your tank is {fuel === 'Energy' ? 'full again' : 'refilled with Drain'}.
				</p>
			)}
			{s.phase && <p class="pf-help">Stay calm: when you get angry, roll 1d50. On 30+ you’re destabilized: no powers and incapacitated for 2 turns, and so is everyone you control.</p>}
			{bio && <p class="pf-help">Training doesn’t raise your stats: absorb evolution items instead, and spend the energy on stats or on that item’s Efficiency Node (+5 a level). You can reach 15A in every stat.</p>}
		</div>
	);
}

interface ItemsProps {
	fields: Fields;
	locked: string | null;
	readOnly: boolean;
	onChange: (patch: Fields) => void;
	rolls?: EvolutionRoll[];
	roll?: () => Promise<EvolutionRoll>;
}

const ITEM_OF: Record<string, string> = { blast_shard: 'blastShards', blast_core: 'blastCores', core_relay: 'coreRelays' };

/** Arc Rolls, the items absorbed, and what Core Relays have given. */
export function EvolutionItems({ fields, locked, readOnly, onChange, rolls, roll }: ItemsProps) {
	const canEdit = !locked && !readOnly;
	const [rolling, setRolling] = useState(false);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const [fresh, setFresh] = useState<EvolutionRoll | null>(null);
	const [added, setAdded] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);
	const moves = relayMoves(fields);
	const relays = num(fields.coreRelays);
	const ordered = [...(rolls ?? [])].sort((a, b) => b.id - a.id);
	const empty = ordered.findIndex((r) => r.result !== 'no_item');
	const emptyRun = empty < 0 ? ordered.length : empty;
	const add = (key: string) => onChange({ [key]: num(fields[key]) + 1 });

	async function go() {
		setError('');
		setRolling(true);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * 1000)), 60);
		const started = Date.now();
		try {
			const result = await roll!();
			await new Promise((r) => setTimeout(r, Math.max(0, (reduced ? 200 : 1200) - (Date.now() - started))));
			setFresh(result);
			// Shards and Cores go straight on the card; a Core Relay only counts on the Mainland.
			if (result.result === 'blast_shard' || result.result === 'blast_core') {
				add(ITEM_OF[result.result]);
				setAdded(result.id);
			}
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(false);
		}
	}

	return (
		<div class="dv-fear cf-items pf-wide">
			{locked && (
				<p class="dv-locked">
					<span aria-hidden="true">🔒</span> {locked}
				</p>
			)}
			<div class="er-box" aria-live="polite">
				<div class="er-head">
					<h5 class="sp-pot-head">Arc Roll</h5>
					<span class="er-fails">1d1000</span>
				</div>
				<ul class="cf-odds">
					<li>
						<span>0–499</span> Nothing
					</li>
					<li>
						<span>500–790</span> Blast Shard
					</li>
					<li>
						<span>791–899</span> Blast Core
					</li>
					<li>
						<span>900+</span> Core Relay <small>(Mainland only)</small>
					</li>
				</ul>
				<p class="pf-help">3 rolls per location each RP, 5 turns apart. 3 empty rolls and you can’t roll in that channel again for 4 RPs.</p>
				{emptyRun >= 3 && <p class="er-note">Your last {emptyRun} rolls found nothing. If they were in the same channel, move on for 4 RPs.</p>}
				{!rolls || !roll ? (
					<p class="pf-help">You can roll here once your character is approved.</p>
				) : rolling ? (
					<div class="roll-value rolling er-rolling">
						<strong>{ticker}</strong>
						<span>Following your ARC Sense…</span>
					</div>
				) : (
					!readOnly && (
						<div class="er-action">
							<button type="button" class="pf-button primary" onClick={go}>
								Make an Arc Roll · 1d1000
							</button>
						</div>
					)
				)}
				{fresh && !rolling && fresh.result !== 'no_item' && (
					<p class="er-note">
						{fresh.roll}: {RESULT_TEXT[fresh.result]}.{' '}
						{added === fresh.id ? (
							'Added to your card.'
						) : fresh.result === 'core_relay' && canEdit ? (
							<>
								On the Mainland?{' '}
								<button
									type="button"
									class="pf-button subtle"
									onClick={() => {
										add('coreRelays');
										setAdded(fresh.id);
									}}
								>
									Add the Core Relay
								</button>
							</>
						) : (
							'Outside the Mainland it’s nothing.'
						)}
					</p>
				)}
				{error && (
					<p class="roll-note bad" role="alert">
						{error}
					</p>
				)}
				{rolls && rolls.length > 0 && <RollHistory rolls={rolls} fresh={fresh?.id ?? null} limit={5} />}
			</div>

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Absorbed</h5>
				</header>
				<dl class="dv-tiles cf-counts">
					{ITEMS.map((item) => (
						<div class="dv-tile" key={item.key}>
							<dt>{item.label}</dt>
							<dd>{num(fields[item.key])}</dd>
							<dd class="ff-power">{item.rarity}</dd>
							{canEdit && (
								<dd class="cf-step">
									<button type="button" class="pf-button subtle" aria-label={`One less ${item.label}`} disabled={!num(fields[item.key])} onClick={() => onChange({ [item.key]: num(fields[item.key]) - 1 })}>
										−
									</button>
									<button type="button" class="pf-button subtle" aria-label={`One more ${item.label}`} onClick={() => add(item.key)}>
										+
									</button>
								</dd>
							)}
						</div>
					))}
				</dl>
				<p class="pf-help">Upgrades on the Skill Tree are bought with these. 50 Blast Cores make 1 Core Relay. Absorbing a Relay can attract unwanted attention.</p>
			</section>

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">New moves</h5>
					<span class="dv-now">
						{relays} Relay{relays === 1 ? '' : 's'}
					</span>
				</header>
				{growsMoves(fields) ? (
					<>
						<p class="pf-help">
							Every Core Relay gives a Standard skill and every 2 a Special, ready straight away. So far: <strong>{moves.standard}</strong> Standard and <strong>{moves.specials}</strong> Special
							{moves.specials === 1 ? '' : 's'}. Add them on the Skills tab.
						</p>
						<div class="jj-gauge">
							<div class="jj-gauge-head">
								<span>Karma Bomb</span>
								<strong>
									{Math.min(relays, KARMA_BOMB_RELAYS)} / {KARMA_BOMB_RELAYS}
								</strong>
							</div>
							<span class="sp-req-bar" role="img" aria-label={`${relays} of ${KARMA_BOMB_RELAYS} Core Relays`}>
								<span style={{ width: `${Math.min(100, (relays / KARMA_BOMB_RELAYS) * 100)}%` }} />
							</span>
						</div>
					</>
				) : (
					<p class="pf-help">{String(fields.class || 'This')} Conduits can’t develop new skills; Relays still buy upgrades{fields.class === 'Biologically Enhanced' ? ' and Physical Points' : ''}.</p>
				)}
			</section>
			{fields.class === 'Biologically Enhanced' && (
				<p class="pf-help">
					Each absorb gives {BIO_ITEMS.map((b) => `${b.item} +${b.base}`).join(', ')}, +5 for every level of that item’s Efficiency Node.
				</p>
			)}
		</div>
	);
}

const ACTS = {
	Good: [
		['Rescue or heal a civilian', 5],
		['Stop a crime', 6],
		['Incapacitate a villain (OC)', 10],
		['…a surrendering villain (OC)', 20],
	],
	Evil: [
		['Kill a civilian', 10],
		['Commit a crime', 12],
		['Kill a hero/vigilante (OC)', 20],
		['…a surrendering one (OC)', 40],
	],
} as const;

/** The Karma bar: rank, progress, and acts that move it. */
export function KarmaBar({ fields, locked, readOnly, onChange }: { fields: Fields; locked: string | null; readOnly: boolean; onChange: (patch: Fields) => void }) {
	const canEdit = !locked && !readOnly;
	const k = karmaRank(fields);
	const path = fields.karma === 'Good' || fields.karma === 'Evil' ? fields.karma : null;
	const from = k.reached ? KARMA_THRESHOLDS[k.reached - 1] : 0;
	const to = k.next ?? from;
	const pct = k.next ? ((k.points - from) / (to - from)) * 100 : 100;
	const code = path === 'Evil' ? 'NK' : 'PK';
	/** An act on your path adds; one against it subtracts. Leaning one way picks the path. */
	const act = (side: 'Good' | 'Evil', n: number) => {
		if (!path) onChange({ karma: side, karmaPoints: n });
		else onChange({ karmaPoints: Math.max(0, k.points + (side === path ? n : -n)) });
	};
	return (
		<div class="dv-fear cf-karma pf-wide">
			{locked && (
				<p class="dv-locked">
					<span aria-hidden="true">🔒</span> {locked}
				</p>
			)}
			<div class="dv-balance">
				<div>
					<p class="dv-kicker">{path ? (path === 'Good' ? 'Path of Selflessness' : 'Path of Selfishness') : 'No path yet'}</p>
					<p class="dv-fp">
						<strong>{k.name ?? (path ? 'Unranked' : 'Neutral')}</strong>
					</p>
					<p class="pf-help">
						{k.points} {code}
						{k.next ? ` · ${to - k.points} to the next rank` : ' · top rank'}
					</p>
				</div>
			</div>
			<span class={`sp-req-bar cf-bar${path === 'Evil' ? ' evil' : ''}`} role="img" aria-label={`${k.points} of ${to} Karma`}>
				<span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
			</span>
			<ol class="dv-steps cf-ranks">
				{(KARMA_RANKS[path ?? 'Good'] ?? []).map((name, i) => (
					<li key={name} class={i < k.reached ? 'done' : i === k.reached ? 'next' : ''}>
						<span>{path ? name : '—'}</span>
						<small>{KARMA_THRESHOLDS[i]}</small>
					</li>
				))}
			</ol>
			<p class="pf-help">
				The first rank needs 100, and each one after +30 more. Good Conduits grow toward incapacitating powers and lose all lethality by Champion; Evil ones grow toward lethal powers and lose all incapacitation by Bio-Terrorist.
			</p>
			{canEdit && (
				<div class="cf-acts">
					{(['Good', 'Evil'] as const).map((side) => (
						<section key={side}>
							<h5 class="sp-pot-head">
								{side === 'Good' ? 'Positive Karma' : 'Negative Karma'}
								{path && side !== path ? <small> (subtracts)</small> : null}
							</h5>
							<div class="cf-act-list">
								{ACTS[side].map(([label, n]) => (
									<button type="button" class="pf-button subtle" key={label} onClick={() => act(side, n)}>
										<span>{label}</span>
										<strong>
											{side === path || !path ? '+' : '−'}
											{n}
										</strong>
									</button>
								))}
							</div>
						</section>
					))}
					<p class="pf-help">Staff check new Karma against your RPs.</p>
				</div>
			)}
		</div>
	);
}

/** A Psychic's Mind tab: the OCs, Canons and NPCs under their Mental Domination, and when each one
 * gets to resist or break free at the card's phase (Index: Psychic Conduits). */
export function PsychicMind({ fields, locked, readOnly, onChange }: { fields: Fields; locked: string | null; readOnly: boolean; onChange: (puppets: Puppet[]) => void }) {
	const canEdit = !locked && !readOnly;
	const phaseId = String(fields.psychicPhase ?? '5');
	const phase = PHASES.find((p) => p.id === phaseId) ?? PHASES[0];
	const dom = DOMINATION[phase.id] ?? DOMINATION['5'];
	const puppets = puppetsOf(fields);
	const [draft, setDraft] = useState<Puppet | null>(null);
	const counts = PUPPET_KINDS.map((k) => [k, puppets.filter((p) => (p.kind || 'OC') === k).length] as const);
	const set = (i: number, patch: Partial<Puppet>) => onChange(puppets.map((p, j) => (j === i ? { ...p, ...patch } : p)));
	const bump = (i: number, key: 'commands' | 'rps') => set(i, { [key]: String(num(puppets[i][key]) + 1) });
	const release = (i: number) => onChange(puppets.filter((_, j) => j !== i));
	const higher = phase.id === 'X';

	return (
		<div class="psy pf-wide">
			<div class="psy-head">
				<div class="psy-orb" aria-hidden="true">
					<span>{phase.id}</span>
				</div>
				<div class="psy-head-text">
					<span class="psy-kicker">Psychic Phase {phase.id}</span>
					<strong>{puppets.length === 1 ? '1 mind under your influence' : `${puppets.length} minds under your influence`}</strong>
					<span class="psy-counts">
						{counts.map(([k, n]) => (
							<span key={k} class={n ? 'on' : ''}>
								{n} {k}
								{n === 1 ? '' : 's'}
							</span>
						))}
					</span>
				</div>
			</div>

			<dl class="psy-rules">
				<div>
					<dt>Takeover</dt>
					<dd>{phase.takeover}</dd>
				</div>
				<div>
					<dt>They resist</dt>
					<dd>{dom.resistEvery === null ? 'They can’t' : `Every ${dom.resistEvery} commands (${dom.resistRoll})`}</dd>
				</div>
				<div>
					<dt>They break free</dt>
					<dd>{dom.breakEvery === null ? 'They can’t' : `Every ${dom.breakEvery === 1 ? 'RP' : `${dom.breakEvery} RPs`} (${dom.breakRoll})`}</dd>
				</div>
			</dl>

			{locked && <p class="pf-help">{locked}</p>}

			{puppets.length > 0 && (
				<ul class="psy-list">
					{puppets.map((p, i) => {
						const due = puppetRolls(p, phase.id);
						const cantHold = p.target && p.target !== PUPPET_TARGETS[0] && !higher;
						return (
							<li key={i} class={`psy-card${due.resist || due.breakFree ? ' due' : ''}`}>
								<div class="psy-card-top">
									<span class={`psy-kind k-${(p.kind || 'OC').toLowerCase()}`}>{p.kind || 'OC'}</span>
									<strong>{p.name || 'Unnamed'}</strong>
									{p.target && p.target !== PUPPET_TARGETS[0] && <span class="psy-target">{p.target}</span>}
								</div>
								{p.how && <p class="psy-how">Taken over by {p.how}</p>}
								{cantHold && <p class="pf-error">Only a Phase X Psychic can hold a {p.target}.</p>}
								<div class="psy-meters">
									<div class="psy-meter">
										<span>Commands</span>
										<b>{num(p.commands)}</b>
										{due.resist ? <em class="psy-due">Resist roll due ({due.resist})</em> : due.nextResist !== null ? <em>Resists in {due.nextResist}</em> : <em>Can’t resist</em>}
										{canEdit && (
											<button type="button" class="pf-button subtle" aria-label={`One more command to ${p.name}`} onClick={() => bump(i, 'commands')}>
												+1
											</button>
										)}
									</div>
									<div class="psy-meter">
										<span>RPs held</span>
										<b>{num(p.rps)}</b>
										{due.breakFree ? <em class="psy-due">Break-free roll due ({due.breakFree})</em> : due.nextBreak !== null ? <em>Rolls to break free in {due.nextBreak} RP{due.nextBreak === 1 ? '' : 's'}</em> : <em>Can’t break free</em>}
										{canEdit && (
											<button type="button" class="pf-button subtle" aria-label={`One more RP holding ${p.name}`} onClick={() => bump(i, 'rps')}>
												+1
											</button>
										)}
									</div>
								</div>
								{canEdit && (
									<div class="psy-actions">
										<button type="button" class="pf-button subtle" onClick={() => release(i)}>
											Released / broke free
										</button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{canEdit &&
				(draft ? (
					<div class="psy-add-form">
						<TextField label="Who" required value={draft.name} onInput={(name) => setDraft({ ...draft, name })} />
						<SelectField label="OC, Canon or NPC" value={draft.kind} options={PUPPET_KINDS.map((value) => ({ value }))} onChange={(kind) => setDraft({ ...draft, kind })} />
						<SelectField
							label="What they are"
							value={draft.target}
							options={PUPPET_TARGETS.map((value) => ({ value, label: value !== PUPPET_TARGETS[0] && !higher ? `${value} (Phase X only)` : value, disabled: value !== PUPPET_TARGETS[0] && !higher }))}
							onChange={(target) => setDraft({ ...draft, target })}
						/>
						<TextField label="Taken over by" placeholder="Contact, or a medium like Black Tar" value={draft.how} onInput={(how) => setDraft({ ...draft, how })} />
						<div class="psy-actions">
							<button type="button" class="pf-button subtle" onClick={() => setDraft(null)}>
								Cancel
							</button>
							<button
								type="button"
								class="pf-button"
								disabled={!draft.name.trim()}
								onClick={() => {
									onChange([...puppets, { ...draft, name: draft.name.trim() }]);
									setDraft(null);
								}}
							>
								Take over
							</button>
						</div>
					</div>
				) : (
					<button type="button" class="psy-add" onClick={() => setDraft({ name: '', kind: 'OC', target: PUPPET_TARGETS[0], how: '', commands: '0', rps: '0' })}>
						<span class="df-add-icon">＋</span>
						<span>Add someone under your influence</span>
					</button>
				))}

			<div class="psy-notes">
				<div>
					<strong>Who you can take over</strong>
					<p>OCs, Canons and NPCs with no Will Manipulation and no Psychic abilities, after prolonged contact or through a medium. Not Bio-Enhanced, Psychic, Meta or Quantum Conduits (Phase X can take Bio-Conduits and lower-phase Psychics). Puppets get a slight ARC Sense, so they can find Blast Shards, Cores and Relays for you.</p>
				</div>
				<div>
					<strong>Keep calm</strong>
					<p>If you get angry, roll 1d50: 30+ and you’re destabilized. No powers and incapacitated for 2 turns, and so is everyone you control.</p>
				</div>
			</div>
		</div>
	);
}
