// Fire Force's card: what the levels work out to, the Pyrokinetic Techniques and who taught them,
// the Adolla Links seen (a Stigma holder can peer into them), and Tephrosis moving through its stages.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ALL_OR_NOTHING, BREATH, PRESS, TECHNIQUE_COST, TEPHROSIS, fireStats, hasBurst, hasGrace, isSecond, levelTag, pointsOf } from '../../lib/portal/fireforce.ts';
import { PEEK_TRIES, TAUGHT, TEPHROSIS_RPS, linkLog, newLink, peekCooldown, peekIds, techniqueLog, tephrosisStage, today, type LinkEntry, type TechniqueEntry } from '../../lib/portal/fireforceLogs.ts';
import { EVOLUTION_DICE, RESULT_TEXT, RP_MS, chance, type EvolutionRoll } from '../../lib/portal/evolutionRolls.ts';
import { rankValue } from '../../lib/portal/rules.ts';
import type { Fields } from '../../lib/portal/systems.ts';
import { useNow, waitText } from './EvolutionRolls.tsx';

const dateText = (d: string) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const rpText = (rpMs: number) => (rpMs === RP_MS ? '1 day' : waitText(rpMs));

/** Manipulation / Power and Oxygen as tiles. */
export function FireStats({ fields }: { fields: Fields }) {
	const s = fireStats(fields);
	if (!s.manipulation && !s.power) return null;
	const teph = TEPHROSIS.find((t) => t.id === fields.tephrosis);
	return (
		<div class="sp-group pf-wide dv-stats ff-stats">
			<h4 class="pf-subhead">
				Your fire
				{hasGrace(fields) ? <span class="ff-badge grace">Fourth Generation</span> : hasBurst(fields) ? <span class="ff-badge">Adolla Burst</span> : null}
			</h4>
			<dl class="dv-tiles">
				{s.manipulation && (
					<div class="dv-tile blood">
						<dt>Manipulation {levelTag(s.manipulation.level)}</dt>
						<dd class="dv-text">{s.manipulation.name}</dd>
						<dd class="ff-power">
							{s.manipulation.standard} <small>Standard</small> · {s.manipulation.ultimate} <small>Ultimate</small>
						</dd>
					</div>
				)}
				{s.power && (
					<div class="dv-tile blood">
						<dt>Power {levelTag(s.power.level)}</dt>
						<dd class="dv-text">{s.power.name}</dd>
						<dd class="ff-power">
							{s.power.standard} <small>Standard</small> · {s.power.ultimate} <small>Ultimate</small>
						</dd>
					</div>
				)}
				{s.oxygen && (
					<>
						<div class="dv-tile">
							<dt>Oxygen Tank</dt>
							<dd>
								{s.oxygen.op} <small>OP</small>
							</dd>
						</div>
						<div class="dv-tile">
							<dt>Each skill burns</dt>
							<dd class="ff-power">
								{s.oxygen.cost[0]} <small>Standard</small> · {s.oxygen.cost[1]} <small>Ultimate</small>
							</dd>
						</div>
						<div class="dv-tile">
							<dt>Refill</dt>
							<dd>
								+{s.oxygen.refill} <small>OP a turn</small>
							</dd>
						</div>
					</>
				)}
			</dl>
			<p class="pf-help ff-growth">
				{s.manipulation && 'Growing: +5 SGUP per training or combat session; new skills cost 15 SGUP (Standard) or 25 (Ultimate). '}
				{s.power && `Growing: +3 TGUP per training or combat session${hasBurst(fields) ? ', +5 more with your Adolla Burst' : ''}; new skills cost 10 TGUP (Standard) or 20 (Ultimate).${hasBurst(fields) ? '' : ' Pyrokinetic Power stops at Level 15 without an Adolla Burst.'}`}
			</p>
			{s.manipulation && <p class="pf-help">You can cancel a Third Generation’s fire when your Manipulation is at least their Pyrokinetic Power.</p>}
			{s.oxygen && <p class="pf-help">You refill after a full turn without Pyrokinetics. Run dry and keep going, and you get Tephrosis.</p>}
			{teph && (
				<p class="ff-teph">
					<strong>Tephrosis: {teph.id}.</strong> {teph.effects.join('. ')}.
				</p>
			)}
		</div>
	);
}

interface GuideProps {
	fields: Fields;
	stamina: string;
	/** Who taught what can be logged (after approval, or once staff open the tab). */
	canLog: boolean;
	onLog: (log: TechniqueEntry[]) => void;
}

/** The four techniques, with the card's levels, what the next one costs, and who taught each one. */
export function TechniqueGuide({ fields, stamina, canLog, onLog }: GuideProps) {
	const taught = Array.isArray(fields.techniques) ? (fields.techniques as string[]) : [];
	const log = techniqueLog(fields);
	const points = pointsOf(fields);
	const level = (k: string) => Number(fields[k] ?? 0) || 0;
	const have = rankValue(stamina) ?? -Infinity;
	const aon = ALL_OR_NOTHING.reduce((n, l, i) => ((rankValue(l.stamina) ?? Infinity) <= have ? i : n), -1);
	const crimson = Array.isArray(fields.crimson) ? (fields.crimson as Record<string, string>[]) : [];
	const set = (name: string, patch: Partial<TechniqueEntry>) => onLog(log.map((e) => (e.technique === name ? { ...e, ...patch } : e)));
	/** Who taught it: a line once logged, inputs while it's being logged, or the button to log it. */
	const teacher = (name: string) => {
		const e = log.find((x) => x.technique === name);
		if (!e)
			return canLog ? (
				<button type="button" class="pf-button subtle ff-learn" onClick={() => onLog([...log, { technique: name, teacher: '', date: today() }])}>
					I was taught {name}
				</button>
			) : null;
		if (!canLog)
			return (
				<p class="ff-taught">
					Taught by <strong>{e.teacher || 'someone'}</strong>
					{e.date && <span> · {dateText(e.date)}</span>}
				</p>
			);
		return (
			<div class="ff-taught-edit">
				<label class="cy-field">
					<span>Taught by</span>
					<input type="text" value={e.teacher} placeholder="Who taught you" onInput={(ev) => set(name, { teacher: ev.currentTarget.value })} />
				</label>
				<label class="cy-field">
					<span>When</span>
					<input type="date" value={e.date} onInput={(ev) => set(name, { date: ev.currentTarget.value })} />
				</label>
				<button type="button" class="pf-button subtle" onClick={() => onLog(log.filter((x) => x.technique !== name))} aria-label={`Remove ${name}`}>
					Remove
				</button>
			</div>
		);
	};
	const card = (name: string, about: string, rows: { label: string; cost: string }[], at: number | null, note?: string) => (
		<section class={`dv-ladder ff-tech${taught.includes(name) ? ' taught' : ''}`} key={name}>
			<header class="dv-ladder-head">
				<h5 class="sp-pot-head">{name}</h5>
				<span class="dv-now">{taught.includes(name) ? (at !== null ? `Level ${at}` : 'Taught') : 'Not taught'}</span>
			</header>
			<p class="pf-help">{about}</p>
			{rows.length > 0 && (
				<ol class="dv-steps">
					{rows.map((r, i) => (
						<li key={i} class={taught.includes(name) && at !== null ? (i < at ? 'done' : i === at ? 'next' : '') : ''}>
							<span>{r.label}</span>
							<small>{r.cost}</small>
						</li>
					))}
				</ol>
			)}
			{note && <p class="pf-help">{note}</p>}
			{(TAUGHT as readonly string[]).includes(name) ? teacher(name) : crimson.length > 0 && (
				<ul class="ff-crimson">
					{crimson.map((c, i) => (
						<li key={i}>
							<strong>{c.name || 'Unnamed'}</strong>
							{c.inventor && <span> · from {c.inventor}</span>}
						</li>
					))}
				</ul>
			)}
		</section>
	);
	return (
		<div class="dv-fear ff-techs pf-wide">
			{card(
				'Breath of Life',
				'Sense the “life” in an attack and boost your reaction time. 3 uses per battle, then you pass out.',
				BREATH.map((b, i) => ({ label: b, cost: i ? `${TECHNIQUE_COST[i]} ${points}` : 'Start' })),
				taught.includes('Breath of Life') ? level('breathLevel') : null,
			)}
			{card(
				'Press of Death',
				'Use your body at 100% and beyond. 30 Stamina a turn. Near-death activation is always Level 0.',
				PRESS.map(([phys, pyro], i) => ({ label: `${phys}, ${pyro}`, cost: i ? `${TECHNIQUE_COST[i]} ${points}` : 'Start' })),
				taught.includes('Press of Death') ? level('pressLevel') : null,
			)}
			{card(
				'All or Nothing',
				'Everything into one devastating attack, then you pass out. It levels up with your Stamina, not points.',
				ALL_OR_NOTHING.map((l) => ({ label: `+${l.bonus} Power`, cost: `Stamina ${l.stamina}` })),
				taught.includes('All or Nothing') ? Math.max(0, aon) : null,
				aon < 0 ? `You need Stamina 2A to use it (you have ${stamina || 'none set'}).` : undefined,
			)}
			{card(
				'Crimson Technique',
				'The Domain Expansion of Pyrokinetics. 8 exist, each learned from its inventor, and a hit leaves you near death.',
				[],
				null,
				canLog ? 'Add each one you learn to the Crimson Techniques list below.' : undefined,
			)}
		</div>
	);
}

const PEEK_CHANCE = chance(5, 10, 10);

interface LinkProps {
	fields: Fields;
	/** Links can be logged (after approval). */
	canAdd: boolean;
	/** This card's peek rolls. Missing before approval. */
	rolls?: EvolutionRoll[];
	roll?: () => Promise<EvolutionRoll>;
	rpMs?: number;
	onChange: (links: LinkEntry[]) => void;
}

/** The Adolla Links the character has been part of or near, and a Stigma holder's peeks into them. */
export function AdollaLinks({ fields, canAdd, rolls, roll, rpMs = RP_MS, onChange }: LinkProps) {
	const links = linkLog(fields);
	const stigma = fields.stigma === 'Yes';
	const burst = hasBurst(fields);
	const [rolling, setRolling] = useState<number | null>(null);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);
	const waitUntil = rolls ? peekCooldown(rolls, Date.now(), rpMs) : null;
	const now = useNow(Boolean(waitUntil));
	const readyAt = rolls ? peekCooldown(rolls, now, rpMs) : null;
	const byId = new Map((rolls ?? []).map((r) => [r.id, r]));
	const set = (i: number, patch: Partial<LinkEntry>) => onChange(links.map((e, j) => (j === i ? { ...e, ...patch } : e)));
	const seen = links.filter((l) => peekIds(l).some((id) => byId.get(id)?.result === 'seen')).length;

	async function peek(i: number) {
		setError('');
		setRolling(i);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * 10)), 60);
		const started = Date.now();
		try {
			const r = await roll!();
			await new Promise((res) => setTimeout(res, Math.max(0, (reduced ? 200 : 1000) - (Date.now() - started))));
			const link = links[i];
			set(i, { peeks: [...peekIds(link), r.id].join(',') });
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(null);
		}
	}

	return (
		<div class="dv-stats qa-log ff-links pf-wide">
			<h4 class="pf-subhead">Adolla Links</h4>
			<dl class="dv-tiles">
				<div class="dv-tile blood">
					<dt>Links</dt>
					<dd>{links.length}</dd>
					{stigma && <dd class="ff-power">{seen} peered into</dd>}
				</div>
				<div class="dv-tile">
					<dt>{stigma ? 'Peering in' : 'Seeing them'}</dt>
					{stigma ? (
						<>
							<dd>
								{PEEK_CHANCE} <small>a try</small>
							</dd>
							<dd class="ff-power">5+ on 1d10 · {PEEK_TRIES} tries per Link</dd>
						</>
					) : (
						<dd class="dv-text">{burst ? 'No ill effects' : 'Leaves a Stigma'}</dd>
					)}
				</div>
			</dl>
			<p class="pf-help">
				{stigma
					? `When a Link happens nearby, log it and peer into it. Until RPs are tracked, a Link is one RP: ${PEEK_TRIES} peeks per ${rpText(rpMs)}.`
					: burst
						? 'Your Burst lets you experience Links with no ill effects.'
						: 'Without an Adolla Burst, experiencing a Link leaves you permanently scarred with a Stigma (staff confirm it on the Stigma above).'}
			</p>

			{links.length === 0 ? (
				<p class="qa-empty">No Adolla Links yet.</p>
			) : (
				<ol class="qa-entries">
					{links.map((l, i) => {
						const peeks = peekIds(l).map((id) => byId.get(id)).filter((r): r is EvolutionRoll => Boolean(r));
						const left = PEEK_TRIES - peekIds(l).length;
						const got = peeks.some((r) => r.result === 'seen');
						return (
							<li key={i} class={`qa-entry${got ? '' : peeks.length ? ' rolled' : ''}`}>
								<header class="qa-head">
									<strong>Link #{i + 1}</strong>
									{peeks.length > 0 && <span class="qa-how">{got ? 'Peered in' : 'Couldn’t see in'}</span>}
									<span class="qa-date">{dateText(l.date)}</span>
									{canAdd && i === links.length - 1 && peeks.length === 0 && (
										<button type="button" class="pf-button subtle qa-remove" onClick={() => onChange(links.slice(0, -1))} aria-label={`Remove Link #${i + 1}`}>
											Remove
										</button>
									)}
								</header>
								{canAdd ? (
									<>
										<label class="cy-field">
											<span>Between</span>
											<input type="text" value={l.who} placeholder="Who the Link connected" onInput={(e) => set(i, { who: e.currentTarget.value })} />
										</label>
										<label class="cy-field">
											<span>What it showed</span>
											<textarea rows={2} value={l.revealed} placeholder="Feelings, memories, something that happened…" onInput={(e) => set(i, { revealed: e.currentTarget.value })} />
										</label>
									</>
								) : (
									<dl class="qa-read">
										<dt>Between</dt>
										<dd>{l.who || '—'}</dd>
										<dt>Showed</dt>
										<dd>{l.revealed || '—'}</dd>
									</dl>
								)}
								{stigma && (
									<div class="ff-peeks">
										{peeks.map((r) => (
											<span key={r.id} class={`ff-peek${r.result === 'seen' ? ' seen' : ''}`}>
												{r.roll} · {RESULT_TEXT[r.result] ?? r.result}
											</span>
										))}
										{rolling === i ? (
											<span class="ff-peek rolling">
												<strong>{ticker}</strong> Rolling…
											</span>
										) : (
											canAdd &&
											roll &&
											left > 0 &&
											!got && (
												<button type="button" class="pf-button primary" disabled={rolling !== null || Boolean(readyAt)} onClick={() => peek(i)}>
													{readyAt ? `Next peek in ${waitText(readyAt - now)}` : `Peer in (${left} ${left === 1 ? 'try' : 'tries'} left)`}
												</button>
											)
										)}
									</div>
								)}
							</li>
						);
					})}
				</ol>
			)}
			{error && (
				<p class="roll-note bad" role="alert">
					{error}
				</p>
			)}
			{canAdd ? (
				<div class="qa-add">
					<button type="button" class="pf-button primary" onClick={() => onChange([...links, newLink()])}>
						Log an Adolla Link
					</button>
					<span class="pf-help">{stigma && !roll ? 'Peeks are rolled here once your character is approved.' : 'Staff check Links when they review your evolution.'}</span>
				</div>
			) : (
				<p class="pf-help">Links happen in RP, so you log them here once your character is approved.</p>
			)}
		</div>
	);
}

interface ClockProps {
	fields: Fields;
	/** Tephrosis can be started (its tab is open, after approval). */
	canStart: boolean;
	hasAdaptation: boolean;
	readOnly: boolean;
	rpMs?: number;
	onChange: (patch: Fields) => void;
}

/** Tephrosis moving through its stages: it can't be stopped, so the clock only runs forward. */
export function TephrosisClock({ fields, canStart, hasAdaptation, readOnly, rpMs = RP_MS, onChange }: ClockProps) {
	const since = typeof fields.tephrosisSince === 'string' && fields.tephrosisSince ? fields.tephrosisSince : undefined;
	const adapted = fields.tephrosis === 'Adaptation';
	const now = useNow(Boolean(since) && !adapted);
	const clock = tephrosisStage(since, now, rpMs);
	const stored = TEPHROSIS.findIndex((t) => t.id === fields.tephrosis);
	const at = adapted ? 3 : Math.max(stored, clock?.stage ?? -1);
	// The stage on the card keeps up with the clock (never back).
	useEffect(() => {
		if (!readOnly && clock && !adapted && clock.stage > stored) onChange({ tephrosis: TEPHROSIS[clock.stage].id });
	}, [clock?.stage, stored, adapted, readOnly]);
	const steps = TEPHROSIS.slice(0, 3);
	const ends = (i: number) => (since ? Date.parse(since) + TEPHROSIS_RPS.slice(0, i + 1).reduce((n, r) => n + r, 0) * rpMs : null);

	return (
		<div class={`dv-ladder ff-teph-clock pf-wide${at >= 0 ? ' on' : ''}`}>
			<header class="dv-ladder-head">
				<h5 class="sp-pot-head">Tephrosis</h5>
				<span class="dv-now">{at < 0 ? 'None' : TEPHROSIS[at].id}</span>
			</header>
			<ol class="ff-teph-steps">
				{[...steps, ...(hasAdaptation || adapted ? [TEPHROSIS[3]] : [])].map((t, i) => {
					const end = i < 2 ? ends(i) : null;
					const state = i === 3 ? (adapted ? 'now' : '') : adapted || at > i ? 'done' : at === i ? 'now' : '';
					return (
						<li key={t.id} class={state}>
							<header>
								<strong>{t.id}</strong>
								<small>{state === 'now' && end && end > now ? `${waitText(end - now)} left` : state === 'done' ? 'Passed' : t.badge}</small>
							</header>
							<p>{t.effects.join(' · ')}</p>
						</li>
					);
				})}
			</ol>
			<p class="pf-help">
				{at < 0
					? `It starts when your oxygen goes into the negatives. Until RPs are tracked, 1 RP = ${rpText(rpMs)}, so the stages move on by themselves.`
					: adapted
						? 'Adapted: your Pyrokinetics are smoke now, and the debuffs are gone.'
						: at === 2
							? hasAdaptation
								? 'End Stage. With Body Of Adaptation, staff decide when your body adapts.'
								: 'End Stage, until death. There’s no stopping or curing it.'
							: 'There’s no stopping or curing it: the next stage comes on its own.'}
			</p>
			{!readOnly && canStart && at < 0 && (
				<div class="qa-add">
					<button type="button" class="pf-button primary" onClick={() => onChange({ tephrosisSince: new Date().toISOString(), tephrosis: TEPHROSIS[0].id })}>
						My oxygen went negative
					</button>
					<span class="pf-help">Starts the clock at Initial Overheat. Staff confirm it.</span>
				</div>
			)}
			{!readOnly && hasAdaptation && at === 2 && (
				<div class="qa-add">
					<button type="button" class="pf-button subtle" onClick={() => onChange({ tephrosis: TEPHROSIS[3].id })}>
						My body adapted
					</button>
				</div>
			)}
		</div>
	);
}
