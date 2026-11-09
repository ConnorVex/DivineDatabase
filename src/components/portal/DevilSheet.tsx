// Chainsaw Man's card: the Devil's numbers (worked out from class, path and upgrades) and, after
// approval, Fear Points spent on Blood Tank and Regeneration upgrades, plus Metamorphosis.
import {
	DEVIL_CLASSES,
	REGEN_STEPS,
	TANK_BONUS,
	TANK_MAX,
	TANK_STEPS,
	devilClassOf,
	devilStats,
	fearSpent,
	nextClass,
	regenCost,
	regenLevel,
	tankBonus,
	tankLevel,
} from '../../lib/portal/devils.ts';
import type { Fields } from '../../lib/portal/systems.ts';

/** Blood Tank, DAP and healing as tiles, with what the class means. */
export function DevilStats({ fields }: { fields: Fields }) {
	const c = devilClassOf(fields);
	const s = devilStats(fields);
	const path = String(fields.path ?? '');
	if (!c || s.tank === null) return null;
	return (
		<div class="sp-group pf-wide dv-stats">
			<h4 class="pf-subhead">
				{c.id} {path}
			</h4>
			<p class="pf-help">{c.fears}</p>
			<dl class="dv-tiles">
				<div class="dv-tile blood">
					<dt>Blood Tank</dt>
					<dd>
						{s.tank} <small>BP</small>
					</dd>
				</div>
				<div class="dv-tile">
					<dt>Devil Ability Power</dt>
					<dd>{s.dap}</dd>
				</div>
				<div class="dv-tile">
					<dt>Healing</dt>
					<dd class="dv-text">{s.healing}</dd>
				</div>
			</dl>
			{path === 'Fiend' && <p class="pf-help">A Fiend’s stats, DAP and Blood Tank are halved, the tank can’t be upgraded, and Fiends can’t make contracts.</p>}
			{path === 'Hybrid' && (
				<div class="dv-transform">
					<h5 class="sp-pot-head">Transformation</h5>
					<ul class="sp-perks">
						<li>Full: costs 100 BP, then 20 BP a turn. +{c.boost[0]} Sub-Tiers.</li>
						<li>Partial: needs 50 BP. +{c.boost[1]} Sub-Tiers, DAP halved.</li>
						<li>+25 BP for every bite of blood.</li>
					</ul>
				</div>
			)}
			{path === 'Devil' && <p class="pf-help">Fear Points raise these on the Fear & Evolution tab once you’re approved.</p>}
		</div>
	);
}

interface FearProps {
	fields: Fields;
	/** Why it's locked (browse only), or null. */
	locked: string | null;
	readOnly: boolean;
	isEvolution: boolean;
	onChange: (patch: Fields) => void;
}

/** Fear Points: the balance, the two upgrade ladders, and Metamorphosis. */
export function FearUpgrades({ fields, locked, readOnly, isEvolution, onChange }: FearProps) {
	const c = devilClassOf(fields);
	if (!c) return <p class="pf-help pf-wide">Pick your Devil’s class first.</p>;
	const canEdit = !locked && !readOnly;
	const earned = Number(fields.fearPoints) || 0;
	const left = earned - fearSpent(fields);
	const tank = tankLevel(fields);
	const bonus = tankBonus(fields);
	const regen = regenLevel(fields);
	const s = devilStats(fields);
	const next = nextClass(fields);

	return (
		<div class="dv-fear pf-wide">
			{locked && (
				<p class="dv-locked">
					<span aria-hidden="true">🔒</span> {locked}
				</p>
			)}
			<div class="dv-balance">
				<div>
					<p class="dv-kicker">Fear Points</p>
					<p class="dv-fp">
						<strong>{left}</strong> FP to spend
					</p>
					<p class="pf-help">
						{earned} earned · {earned - left} spent
					</p>
				</div>
				{canEdit && (
					<div class="dv-earn">
						<button type="button" class="pf-button" onClick={() => onChange({ fearPoints: Math.max(fearSpent(fields), earned - 5) })} disabled={earned - 5 < fearSpent(fields)} aria-label="5 fewer Fear Points earned">
							−5
						</button>
						<button type="button" class="pf-button" onClick={() => onChange({ fearPoints: earned + 5 })} aria-label="5 more Fear Points earned">
							+5
						</button>
						<label class="dv-earn-input">
							<span class="sr-only">Fear Points earned</span>
							<input type="number" min={0} value={earned} onInput={(e) => onChange({ fearPoints: Math.max(0, Number(e.currentTarget.value) || 0) })} />
						</label>
					</div>
				)}
			</div>
			{canEdit && <p class="pf-help">Add Fear Points as you earn them in RP. Staff check new ones when you submit.</p>}

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Blood Tank</h5>
					<span class="dv-now">{s.tank} BP</span>
				</header>
				<ol class="dv-steps">
					{TANK_STEPS.map((step, i) => (
						<li key={i} class={i < tank ? 'done' : i === tank ? 'next' : ''}>
							<span>+{step.add}</span>
							<small>{step.cost} FP</small>
						</li>
					))}
					<li class={tank >= TANK_MAX ? 'done' : tank === TANK_STEPS.length ? 'next' : ''}>
						<span>Max: {c.max}</span>
						<small>Staff confirm</small>
					</li>
					<li class={tank >= TANK_MAX ? 'next' : ''}>
						<span>+{TANK_BONUS.add} each{bonus ? ` ×${bonus}` : ''}</span>
						<small>{TANK_BONUS.cost} FP</small>
					</li>
				</ol>
				{canEdit && (
					<div class="dv-buy">
						{tank < TANK_STEPS.length ? (
							<button type="button" class="pf-button primary" disabled={left < TANK_STEPS[tank].cost} onClick={() => onChange({ tankUpgrades: tank + 1 })}>
								Buy +{TANK_STEPS[tank].add} BP · {TANK_STEPS[tank].cost} FP
							</button>
						) : tank < TANK_MAX ? (
							<button type="button" class="pf-button primary" onClick={() => onChange({ tankUpgrades: TANK_MAX })}>
								Max it: {c.max} BP · staff confirm
							</button>
						) : (
							<button type="button" class="pf-button primary" disabled={left < TANK_BONUS.cost} onClick={() => onChange({ tankBonus: bonus + 1 })}>
								Buy +{TANK_BONUS.add} BP · {TANK_BONUS.cost} FP
							</button>
						)}
						{(tank > 0 || bonus > 0) && (
							<button type="button" class="pf-button subtle" onClick={() => onChange(bonus > 0 ? { tankBonus: bonus - 1 } : { tankUpgrades: tank - 1 })}>
								Undo
							</button>
						)}
					</div>
				)}
			</section>

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Regeneration</h5>
					<span class="dv-now">{regenCost(regen)} BP</span>
				</header>
				<ol class="dv-steps">
					{REGEN_STEPS.map((step, i) => (
						<li key={i} class={i < regen ? 'done' : i === regen ? 'next' : ''}>
							<span>{i === REGEN_STEPS.length - 1 ? `Max: ${regenCost(REGEN_STEPS.length)} BP` : `${regenCost(i + 1)} BP`}</span>
							<small>{step.cost} FP</small>
						</li>
					))}
				</ol>
				{canEdit && (
					<div class="dv-buy">
						{regen < REGEN_STEPS.length ? (
							<button type="button" class="pf-button primary" disabled={left < REGEN_STEPS[regen].cost} onClick={() => onChange({ regenUpgrades: regen + 1 })}>
								Regenerate for {regenCost(regen + 1)} BP · {REGEN_STEPS[regen].cost} FP
							</button>
						) : (
							<span class="pf-help">Regeneration is maxed.</span>
						)}
						{regen > 0 && (
							<button type="button" class="pf-button subtle" onClick={() => onChange({ regenUpgrades: regen - 1 })}>
								Undo
							</button>
						)}
					</div>
				)}
			</section>

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Metamorphosis</h5>
				</header>
				<ol class="dv-classes">
					{DEVIL_CLASSES.map((x) => (
						<li key={x.id} class={x.id === c.id ? 'now' : DEVIL_CLASSES.indexOf(x) < DEVIL_CLASSES.indexOf(c) ? 'done' : ''}>
							<strong>{x.id}</strong>
							<small>
								{x.tank} BP · DAP {x.dap}
							</small>
						</li>
					))}
				</ol>
				<p class="pf-help">A GM runs Metamorphosis: it takes 3 real-life days and moves you up one class, with new physical stats and stronger powers.</p>
				{next && canEdit && isEvolution && (
					<button type="button" class="pf-button" onClick={() => onChange({ devilClass: next.id })}>
						Ask to become {next.id}
					</button>
				)}
			</section>
		</div>
	);
}
