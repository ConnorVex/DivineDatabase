// Tokyo Ghoul's card: what the sub-species and Kagune work out to, and (after approval) the Rc Tank's
// GEP upgrades and Mutated Rc toward Kakuja.
import { KAKUJA, RC_START, TANK_STEPS, gepSpent, ghoulStats, hasKagune, kaguneOf, tankLevel } from '../../lib/portal/ghouls.ts';
import type { Fields } from '../../lib/portal/systems.ts';

export function GhoulStats({ fields }: { fields: Fields }) {
	if (!hasKagune(fields)) return null;
	const s = ghoulStats(fields);
	const k = kaguneOf(fields);
	return (
		<div class="sp-group pf-wide dv-stats tg-stats">
			<h4 class="pf-subhead">Your {s.kind}</h4>
			<dl class="dv-tiles">
				{s.base && (
					<div class="dv-tile blood">
						<dt>Starting stats</dt>
						<dd>{s.base.rank}</dd>
						<dd class="ff-power">
							Power {s.base.power} <small>· no PTP</small>
						</dd>
					</div>
				)}
				<div class="dv-tile">
					<dt>Rc Tank</dt>
					<dd>
						{s.tank} <small>Rc</small>
					</dd>
				</div>
				<div class="dv-tile">
					<dt>Lost each RP</dt>
					<dd>
						{s.lostPerRp} <small>Rc</small>
					</dd>
				</div>
				{s.multiplier && (
					<div class="dv-tile">
						<dt>Physical gains</dt>
						<dd class="dv-text">{s.multiplier}</dd>
					</div>
				)}
				{s.frames !== null && (
					<div class="dv-tile">
						<dt>Quinx frames</dt>
						<dd>
							{s.frames} <small>(−{s.frames * 2} Sub-Tiers on boosts)</small>
						</dd>
					</div>
				)}
			</dl>
			{k && (
				<div class="dv-transform">
					<h5 class="sp-pot-head">{k.id}</h5>
					<p class="pf-help">{k.about}</p>
					<ul class="sp-perks">
						<li>
							Deploy {k.deploy} Rc, regenerate {k.regen} Rc (retract it intact and you get the Rc back)
						</li>
						<li>Boosts (Sub-Tiers): {k.boosts}</li>
						{k.recoil && <li>Recoil protection</li>}
					</ul>
				</div>
			)}
			{s.base && <p class="pf-help">Grow with Rc: {s.growCost}. Heal NL-Class 5 to L-Class 1 injuries for 20 to 460 Rc.</p>}
			{s.starves ? <p class="pf-help">Below 36 Rc you’re Starving, below 18 you go into a Feeding Frenzy, and at 0 you starve to death if you don’t eat before the RP ends.</p> : <p class="pf-help">Immune to starvation: at 0 Rc you just can’t use your Kagune. You live 100 Roleplays.</p>}
		</div>
	);
}

interface TankProps {
	fields: Fields;
	locked: string | null;
	readOnly: boolean;
	onChange: (patch: Fields) => void;
}

/** GEP earned and spent on the Rc Tank, and M-Rc toward Kakuja. */
export function RcTank({ fields, locked, readOnly, onChange }: TankProps) {
	const canEdit = !locked && !readOnly;
	const earned = Number(fields.gep) || 0;
	const spent = gepSpent(fields);
	const left = earned - spent;
	const level = tankLevel(fields);
	const tank = ghoulStats(fields).tank;
	const mrc = Number(fields.mutatedRc) || 0;
	const next = level < TANK_STEPS.length ? TANK_STEPS[level] : null;
	return (
		<div class="dv-fear tg-tank pf-wide">
			{locked && (
				<p class="dv-locked">
					<span aria-hidden="true">🔒</span> {locked}
				</p>
			)}
			<div class="dv-balance">
				<div>
					<p class="dv-kicker">Ghoul Evolution Points</p>
					<p class="dv-fp">
						<strong>{left}</strong> GEP to spend
					</p>
					<p class="pf-help">
						{earned} earned · {spent} spent
					</p>
				</div>
				{canEdit && (
					<div class="dv-earn">
						<button type="button" class="pf-button" onClick={() => onChange({ gep: earned + 3 })} aria-label="3 more GEP: a session deploying your Kagune">
							+3
						</button>
						<button type="button" class="pf-button" onClick={() => onChange({ gep: earned + 5 })} aria-label="5 more GEP: fully consuming a character">
							+5
						</button>
						<label class="dv-earn-input">
							<span class="sr-only">GEP earned</span>
							<input type="number" min={0} value={earned} onInput={(e) => onChange({ gep: Math.max(0, Number(e.currentTarget.value) || 0) })} />
						</label>
					</div>
				)}
			</div>
			{canEdit && <p class="pf-help">+3 GEP for a session deploying your Kagune, +5 for fully consuming a character. Staff check new ones.</p>}

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Rc Tank</h5>
					<span class="dv-now">{tank} Rc</span>
				</header>
				<ol class="dv-steps">
					{TANK_STEPS.map((step, i) => (
						<li key={i} class={i < level ? 'done' : i === level ? 'next' : ''}>
							<span>+{step.add}</span>
							<small>{step.cost} GEP</small>
						</li>
					))}
				</ol>
				<p class="pf-help">
					From {RC_START} to {RC_START + TANK_STEPS.reduce((n, s) => n + s.add, 0)} Rc. Anything you eat past your tank is lost.
				</p>
				{canEdit && (
					<div class="dv-buy">
						{next ? (
							<button type="button" class="pf-button primary" disabled={left < next.cost} onClick={() => onChange({ tankUpgrades: level + 1 })}>
								Buy +{next.add} Rc · {next.cost} GEP
							</button>
						) : (
							<span class="pf-help">Your Rc Tank is maxed.</span>
						)}
						{level > 0 && (
							<button type="button" class="pf-button subtle" onClick={() => onChange({ tankUpgrades: level - 1 })}>
								Undo
							</button>
						)}
					</div>
				)}
			</section>

			<section class="dv-ladder">
				<header class="dv-ladder-head">
					<h5 class="sp-pot-head">Mutated Rc</h5>
					<span class="dv-now">{mrc} M-Rc</span>
				</header>
				<p class="pf-help">Eat a Ghoul and you gain half their Rc; half of that becomes M-Rc. It opens Kakuja on the Kakuja tab.</p>
				{KAKUJA.map((k) => (
					<div class="jj-gauge" key={k.id}>
						<div class="jj-gauge-head">
							<span>{k.id}</span>
							<strong>
								{Math.min(mrc, k.mrc)} / {k.mrc}
							</strong>
						</div>
						<span class="sp-req-bar" role="img" aria-label={`${mrc} of ${k.mrc} M-Rc`}>
							<span style={{ width: `${Math.min(100, (mrc / k.mrc) * 100)}%` }} />
						</span>
					</div>
				))}
				{canEdit && (
					<label class="cy-field">
						<span>M-Rc you have</span>
						<input type="number" min={0} value={mrc} onInput={(e) => onChange({ mutatedRc: Math.max(0, Number(e.currentTarget.value) || 0) })} />
					</label>
				)}
			</section>
		</div>
	);
}
