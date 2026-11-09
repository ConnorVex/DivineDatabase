// A character sheet laid out like a Fandom wiki article: a title, an infobox (picture, basics,
// S.T.S stats) and wiki sections for lore, traits, combat and each power system. Used on the
// review page; the submit form's Review step can use it too.
import type { ComponentChildren } from 'preact';
import type { ClaimRow, Combo } from '../../lib/portal/api.ts';
import type { FamilyCard } from '../../lib/families/api.ts';
import { PERK_ACCESS } from '../../lib/families/api.ts';
import { CUSTOM, customTreeNodes, treeCurrencyLabel } from '../../lib/portal/customTree.ts';
import type { LinkablePerk } from '../../lib/portal/families.ts';
import { heavenlyOf } from '../../lib/portal/heavenly.ts';
import { power, ptp, rankInfo, recoil, rules, traits, traitSlots, type StaffOverrides } from '../../lib/portal/rules.ts';
import { PROOF_LABEL, familyCardChanged, type Sheet } from '../../lib/portal/sheet.ts';
import { systemById, visibleFields } from '../../lib/portal/systems.ts';
import { SkillTreeView } from './SkillTreeView.tsx';
import { richText } from './TraitsSection.tsx';
import { PinBoxes } from './PinnedNotes.tsx';
import type { PinnedNote } from '../../lib/portal/pins.ts';

const traitByName = new Map(traits.map((t) => [t.name, t]));
const STATS = [
	['strength', 'STR'],
	['speed', 'SPD'],
	['defense', 'DEF'],
	['stamina', 'STA'],
] as const;

/** "Linked: Brando Clan · Iron Will", with a warning when the link no longer matches the family's perk. */
export function FamilyLinkNote(props: { familyId?: string; title: string; perk?: LinkablePerk; changed?: boolean; proof?: string; families: FamilyCard[] }) {
	const family = props.families.find((f) => f.id === props.familyId)?.name ?? 'a family';
	const needs = props.perk && PROOF_LABEL[props.perk.access];
	return (
		<p class={`rv-link${!props.perk || props.changed ? ' bad' : ''}`}>
			<strong>Linked:</strong> {family} · {props.perk?.title ?? props.title}
			{props.perk && ` · ${PERK_ACCESS.find((a) => a.id === props.perk!.access)?.label}`}
			{!props.perk && ' · no longer offered by the family'}
			{props.changed && ' · changed by the family since it was linked'}
			{needs &&
				(props.proof ? (
					<>
						{' · '}
						<a href={props.proof} target="_blank" rel="noreferrer noopener">
							{needs.toLowerCase().startsWith('roll') ? 'roll' : 'proof'}
						</a>
					</>
				) : (
					` · no ${needs.charAt(0).toLowerCase() + needs.slice(1)}`
				))}
		</p>
	);
}

/** One tile of the infobox's stats grid. */
const Fact = ({ label, wide, staff, children }: { label: string; wide?: boolean; staff?: boolean; children: ComponentChildren }) => (
	<div class={`wk-fact${wide ? ' wide' : ''}${staff ? ' staff' : ''}`} title={staff ? 'Set by staff' : undefined}>
		<span class="wk-fact-label">{label}</span>
		<div class="wk-fact-value">{children}</div>
	</div>
);

/** One label / value line of the infobox or a data table; empty values are left out. */
const Row = ({ label, value, staff }: { label: string; value: ComponentChildren; staff?: boolean }) =>
	value === '' || value === null || value === undefined ? null : (
		<tr>
			<th scope="row">{label}</th>
			<td>
				{value}
				{staff && (
					<span class="wk-staff" title="Set by staff">
						{' '}
						staff
					</span>
				)}
			</td>
		</tr>
	);

const Prose = ({ value }: { value: string }) => (value?.trim() ? <p class="wk-prose">{value}</p> : <p class="pf-empty">Not written yet.</p>);

/** A pin button for reviewers: 📌 next to a heading. */
const PinButton = ({ onPin, what }: { onPin?: () => void; what: string }) =>
	onPin ? (
		<button type="button" class="pin-add" title={`Pin a note to ${what}`} aria-label={`Pin a note to ${what}`} onClick={onPin}>
			📌
		</button>
	) : null;

const Section = ({ title, children, pin }: { title: string; children: ComponentChildren; pin?: ComponentChildren }) => (
	<section class="wk-section">
		<h3 class="wk-h">
			{title}
			{pin}
		</h3>
		{children}
	</section>
);

export interface ArticleProps {
	name: string;
	kind: 'oc' | 'canon';
	/** For canon tryouts: the series' name. */
	universeName?: string | null;
	sheet: Sheet;
	bonusPtp?: number;
	extraTraitSlots?: number;
	staffOverrides?: StaffOverrides;
	progressed?: boolean;
	combos?: Combo[];
	/** Canon claims the character asks for. */
	claims?: ClaimRow[];
	perks?: LinkablePerk[];
	families?: FamilyCard[];
	/** Pinned review notes, shown as red boxes where they belong. */
	pins?: PinnedNote[];
	/** Reviewers: pin a note to this spot (shows 📌 buttons). */
	onPin?: (step: string, target?: string) => void;
	onUnpin?: (id: string) => void;
	adminCharacter?: boolean;
	/** Viewers who aren't allowed past Error Tiers see ERROR instead of those stats. */
	hideErrors?: boolean;
}

/** Red boxes and 📌 buttons for pinned review notes. */
function pinHelpers(props: ArticleProps) {
	const pins = props.pins ?? [];
	/** Red boxes for a step's notes (optionally only those on one target, or only whole-step ones). */
	const boxes = (step: string, target?: string | null) => (
		<PinBoxes notes={pins.filter((n) => n.step === step && (target === undefined || (target === null ? !n.target : n.target === target)))} sheet={props.sheet} onRemove={props.onUnpin} />
	);
	const pinTo = (step: string, target?: string) => (props.onPin ? () => props.onPin!(step, target) : undefined);
	return { boxes, pinTo };
}

/** The Fandom-style side box: picture, basics, stats and power systems. The form shows it live. */
export function CharacterInfobox(props: ArticleProps) {
	const s = props.sheet;
	const oc = props.kind === 'oc';
	const staff = props.staffOverrides ?? {};
	const { boxes, pinTo } = pinHelpers(props);
	const budget = ptp(s, props.bonusPtp ?? 0, props.progressed ? undefined : staff);
	const r = recoil(s);
	const role = rules.roles.find((x) => x.id === s.role);
	const potential = rules.potentials.find((p) => p.id === s.potential.grade);
	const heavenly = heavenlyOf(s);
	const errored = new Set(s.errorStats ?? []);
	/** A value in an Error Tier: ERROR for viewers who can't see it, tagged for those who can. */
	const err = (key: string, value: ComponentChildren) =>
		!errored.has(key) ? value : props.hideErrors ? <span class="wk-error">ERROR</span> : <>{value} <span class="wk-error-tag">hidden</span></>;
	const image = /^https:\/\//.test(s.appearance.image) ? s.appearance.image : '';
	return (
		<aside class="wk-infobox" aria-label="Infobox">
			<p class="wk-infobox-name">
				{props.name || 'Unnamed'}
				<PinButton onPin={pinTo('basics')} what="Basics" />
			</p>
			{image ? <img class="wk-infobox-img" src={image} alt={`Picture of ${props.name}`} /> : <div class="wk-infobox-img empty">No picture</div>}
			<table class="wk-table">
				<tbody>
					{oc && <Row label="Role" value={role?.label ?? '—'} />}
					<Row label="Race" value={s.race} />
					<Row label="Age" value={s.age} />
					<Row label="Pronouns" value={s.pronouns} />
					{oc && <Row label="Potential" value={err('potential', potential ? `${potential.label}${s.potential.roll ? ` (rolled ${s.potential.roll})` : ''}` : 'Not rolled')} staff={Boolean(staff['potential.grade'])} />}
					{heavenly && <Row label="Heavenly" value={`⛩ ${heavenly}`} />}
				</tbody>
			</table>
			{boxes('basics')}
			{oc && (
				<>
					<p class="wk-infobox-head">
						S.T.S stats
						<PinButton onPin={pinTo('stats')} what="Stats" />
					</p>
					<div class="wk-stats">
						{STATS.map(([key, short]) => {
							const info = rankInfo(s.stats[key]);
							const erroring = errored.has(key);
							if (erroring && props.hideErrors)
								return (
									<div class="wk-stat error-tier" key={key} title="Error Tier">
										<span>{short}</span>
										<strong>ERROR</strong>
										<small>???</small>
									</div>
								);
							return (
								<div class={`wk-stat${staff[`stats.${key}`] ? ' staff' : ''}${erroring ? ' erroring' : ''}`} key={key} title={erroring ? 'Error Tier: shows as ERROR to non-admins' : staff[`stats.${key}`] ? 'Set by staff' : undefined}>
									<span>{short}</span>
									<strong>{info?.rank ?? '—'}</strong>
									<small>{erroring ? 'hidden' : info ? info.value : ''}</small>
								</div>
							);
						})}
					</div>
					<div class="wk-facts">
						<Fact label="Power" wide>
							<strong class="wk-big">{props.hideErrors && (errored.has('strength') || errored.has('speed')) ? <span class="wk-error">ERROR</span> : (power(s) ?? '—')}</strong>
						</Fact>
						<Fact label="Intelligence" staff={Boolean(staff['stats.intelligence'])}>
							{err('intelligence', s.stats.intelligence || '—')}
						</Fact>
						<Fact label="Physical meter" staff={Boolean(staff['stats.physicalMeter'])}>
							{s.stats.physicalMeter}
						</Fact>
						<Fact label="Phase" wide staff={Boolean(staff['stats.phase'])}>
							{err('phase', rules.stats.phases.find((p) => p.phase === s.stats.phase)?.label ?? '—')}
						</Fact>
						<Fact label="Recoil" wide>
							{props.hideErrors && ['strength', 'speed', 'defense'].some((k) => errored.has(k)) ? (
								<span class="wk-error">ERROR</span>
							) : r ? (
								<>
									<strong>Lv {r.level}</strong>
									<small>
										{r.high} is {r.gap} above {r.low}
									</small>
								</>
							) : (
								'None'
							)}
						</Fact>
						<Fact label="Starting PTP" wide>
							{props.adminCharacter ? (
								<small>No limits: admin character</small>
							) : props.progressed ? (
								<small>Not limited: already progressed</small>
							) : (
								<>
									<span class={`wk-ptp${budget.spent > budget.available ? ' over' : ''}`}>
										<strong>{budget.spent}</strong> / {budget.available}
										{budget.granted ? <small> (+{budget.granted} staff)</small> : null}
									</span>
									<span class="wk-bar" aria-hidden="true">
										<span style={{ width: `${Math.min(100, budget.available ? (budget.spent / budget.available) * 100 : budget.spent ? 100 : 0)}%` }} />
									</span>
								</>
							)}
						</Fact>
					</div>
					{boxes('stats')}
					{s.systems.length > 0 && (
						<>
							<p class="wk-infobox-head">Power systems</p>
							<ul class="wk-chips">
								{s.systems.map((e) => (
									<li key={e.key} class={s.systems.length > 1 && s.prioritySystem === e.key ? 'main' : undefined} title={s.systems.length > 1 && s.prioritySystem === e.key ? 'Priority system' : undefined}>
										{s.systems.length > 1 && s.prioritySystem === e.key ? '★ ' : ''}
										{systemById.get(e.system)?.label ?? e.system}
									</li>
								))}
							</ul>
						</>
					)}
				</>
			)}
		</aside>
	);
}

export function CharacterArticle(props: ArticleProps) {
	const s = props.sheet;
	const oc = props.kind === 'oc';
	const staff = props.staffOverrides ?? {};
	const perkById = new Map((props.perks ?? []).map((p) => [p.id, p]));
	const families = props.families ?? [];
	const { boxes, pinTo } = pinHelpers(props);
	const slots = traitSlots(s, props.extraTraitSlots ?? 0);
	const role = rules.roles.find((x) => x.id === s.role);
	const gallery = s.appearance.extraImages
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => /^https?:\/\//.test(l));

	return (
		<article class="wk">
			<header class="wk-title">
				<h2>{props.name || 'Unnamed character'}</h2>
				<p class="wk-tagline">
					{oc ? `Original character${role ? ` · ${role.label}` : ''}` : `Canon tryout · ${props.universeName ?? 'unknown series'}`}
					{props.progressed && <span class="wk-staff"> already progressed</span>}
					{props.adminCharacter && <span class="wk-admin"> admin character</span>}
				</p>
			</header>

			<CharacterInfobox {...props} />

			<div class="wk-body">
				<Section title="Appearance" pin={<PinButton onPin={pinTo('appearance')} what="Appearance" />}>
					{boxes('appearance')}
					{oc && <Prose value={s.appearance.description} />}
					{gallery.length > 0 && (
						<div class="wk-gallery">
							{gallery.map((l) => (
								<a key={l} href={l} target="_blank" rel="noreferrer noopener">
									<img src={l} alt="" loading="lazy" />
								</a>
							))}
						</div>
					)}
				</Section>

				{oc ? (
					<>
						<Section title="Personality" pin={<PinButton onPin={pinTo('lore')} what="Lore" />}>
							{boxes('lore')}
							<Prose value={s.lore.personality} />
						</Section>
						<Section title="Backstory">
							<Prose value={s.lore.backstory} />
						</Section>
						{(s.lore.likes.trim() || s.lore.dislikes.trim() || s.lore.relations.trim()) && (
							<Section title="Likes, dislikes & relations">
								<table class="wk-table wide">
									<tbody>
										<Row label="Likes" value={s.lore.likes} />
										<Row label="Dislikes" value={s.lore.dislikes} />
										<Row label="Relations" value={s.lore.relations} />
									</tbody>
								</table>
							</Section>
						)}
					</>
				) : (
					<>
						<Section title="Portrayal" pin={<PinButton onPin={pinTo('lore')} what="Tryout" />}>
							{boxes('lore')}
							<Prose value={s.canon.portrayal} />
						</Section>
						<Section title="Roleplay sample">
							<Prose value={s.canon.sample} />
						</Section>
					</>
				)}

				{oc && (
					<>
						<Section title={`Traits · ${slots.used}/${slots.total} slots`} pin={<PinButton onPin={pinTo('traits')} what="Traits" />}>
							{boxes('traits')}
							{s.traits.length === 0 && <p class="pf-empty">No traits.</p>}
							<ul class="rv-traits">
								{s.traits.map((t) => {
									const info = traitByName.get(t.name);
									return (
										<li key={t.name}>
											<span class={`trait-chip small rarity-${info?.rarity ?? 'unknown'}`}>
												{info?.sticky && '📌 '}
												{t.name}
											</span>
											<span class="trait-meta">
												{info ? `${info.rarity} · ${info.category} · ${info.effect}` : 'custom'}
												{t.family ? ' · family' : ''}
											</span>
											{t.family && t.perkId ? <FamilyLinkNote familyId={t.familyId} title={t.name} perk={perkById.get(t.perkId)} proof={t.rollProof} families={families} /> : null}
										</li>
									);
								})}
							</ul>
							{(props.combos ?? []).map((k) => (
								<details key={k.name} class="rv-combo">
									<summary>✨ {k.name}</summary>
									<div dangerouslySetInnerHTML={richText(k.perks)} />
								</details>
							))}
						</Section>

						<Section title="Combat" pin={<PinButton onPin={pinTo('combat')} what="Combat" />}>
							{boxes('combat')}
							<Prose value={s.combat.info} />
							{s.combat.styles.length > 0 && (
								<table class="wk-table wide">
									<tbody>
										{s.combat.styles.map((st, i) => (
											<Row key={i} label="Fighting style" value={st.name} />
										))}
									</tbody>
								</table>
							)}
						</Section>

						{s.systems.length > 0 && (
							<Section title="Abilities" pin={<PinButton onPin={pinTo('systems')} what="Systems" />}>
								{boxes('systems', null)}
								{s.systems.map((e) => {
									const def = systemById.get(e.system);
									const ability = e.familyLink && perkById.get(e.familyLink.perkId)?.details.ability;
									return (
										<div class="wk-ability" key={e.key}>
											<h4 class="wk-h4">
												{def?.label ?? e.system}
												{s.systems.length > 1 && s.prioritySystem === e.key && <span class="wk-badge">priority</span>}
												<PinButton onPin={pinTo('systems', `card:${e.key}`)} what={`the ${def?.label ?? 'system'} card`} />
											</h4>
											{boxes('systems', `card:${e.key}`)}
											{e.familyLink && (
												<FamilyLinkNote
													familyId={e.familyLink.familyId}
													title={e.familyLink.title}
													perk={perkById.get(e.familyLink.perkId)}
													changed={Boolean(ability && familyCardChanged(e, ability))}
													proof={e.familyLink.proof}
													families={families}
												/>
											)}
											{e.description && <Prose value={e.description} />}
											<table class="wk-table wide">
												<tbody>
													{def &&
														visibleFields(def, e.fields)
															.filter((f) => f.type !== 'list' && f.type !== 'textarea')
															.map((f) => {
																const v = e.fields[f.key];
																const text = Array.isArray(v) ? (v as string[]).join(', ') : v;
																return <Row key={f.key} label={f.label} value={text === undefined ? '' : String(text)} staff={Boolean(staff[`card:${e.key}.${f.key}`])} />;
															})}
													{e.fields.ceLevel && <Row label="CE level" value={String(e.fields.ceLevel)} />}
													{(props.claims ?? [])
														.filter((b) => b.universe === def?.universe)
														.map((b) => (
															<Row key={b.id} label="Canon claim" value={`${b.name} (${b.category || 'canon'} · ${b.max_users === null ? 'no limit' : `${b.used_slots}/${b.max_users}`})`} />
														))}
												</tbody>
											</table>
											{def?.fields
												.filter((f) => f.type === 'textarea' && String(e.fields[f.key] ?? '').trim())
												.map((f) => (
													<div key={f.key} class="wk-sub">
														<p class="wk-sub-label">{f.label}</p>
														<Prose value={String(e.fields[f.key])} />
													</div>
												))}
											{def?.fields
												.filter((f) => f.type === 'list')
												.map((f) =>
													((e.fields[f.key] as Record<string, string>[]) ?? []).map((row, i) => (
														<p key={`${f.key}${i}`} class="wk-prose">
															<strong>
																{f.label} #{i + 1}:
															</strong>{' '}
															{(f.columns ?? []).map((col) => `${col.label}: ${row[col.key] || '—'}`).join(' · ')}
														</p>
													)),
												)}
											{(def?.defaultMoves?.(e.fields).length ?? 0) > 0 && (
												<ul class="wk-skills">
													{def!.defaultMoves!(e.fields).map((m) => (
														<li key={m.name} class={m.type}>
															<strong>{m.name}</strong> <span class="trait-meta">{m.type} · default</span>
															{m.cost && <span class="trait-meta"> · {m.cost}</span>}
															<p>{m.effect}</p>
														</li>
													))}
												</ul>
											)}
											{e.skills.length > 0 && (
												<ul class="wk-skills">
													{e.skills.map((sk, i) => (
														<li key={i} class={sk.type}>
															<strong>{sk.name || 'Unnamed'}</strong> <span class="trait-meta">{sk.type}</span>
															{sk.mastery && <span class="trait-meta"> · {sk.mastery}</span>}
															{sk.locked && <span class="trait-meta"> · locked (on the skill tree)</span>}
															{sk.effect && <p>{sk.effect}</p>}
														</li>
													))}
												</ul>
											)}
											{e.customTree && (
												<details class="pts-tree rv-custom-tree">
													<summary>
														Custom tree: {e.customTree.name || 'Unnamed'}
														<span class="pts-tree-count">
															{e.customTree.nodes.length} skills · costs {treeCurrencyLabel(e.customTree)}
														</span>
													</summary>
													{e.customTree.currency === CUSTOM && (
														<p class="pf-help rv-custom-rates">
															{e.customTree.custom.name} ({e.customTree.custom.code}): +{e.customTree.custom.gain} per session
															{e.customTree.custom.convertFrom &&
																` · ${e.customTree.custom.convertFromAmount} ${e.customTree.custom.convertFrom} → ${e.customTree.custom.convertToAmount} ${e.customTree.custom.code}`}
														</p>
													)}
													<SkillTreeView
														tree={{ id: 'custom', system: e.system, label: e.customTree.name, show_if: null, sort: 0 }}
														nodes={customTreeNodes(e.customTree)}
														currencyName={() => treeCurrencyLabel(e.customTree!)}
														unlocks={[]}
														balance={() => 0}
														tracked={() => true}
														admin={false}
														busy={false}
														preview
														onUnlock={async () => false}
														onRemove={async () => false}
													/>
												</details>
											)}
										</div>
									);
								})}
							</Section>
						)}

						{s.storage.trim() && (
							<Section title="Storage" pin={<PinButton onPin={pinTo('storage')} what="Storage" />}>
								{boxes('storage')}
								<Prose value={s.storage} />
							</Section>
						)}
						{s.evolutions.length > 0 && (
							<Section title="Evolution log">
								<ul class="wk-log">
									{s.evolutions.map((ev, i) => (
										<li key={i}>
											<strong>{ev.date || 'Undated'}</strong> {ev.summary} {ev.earned && <span class="trait-meta">({ev.earned})</span>}{' '}
											{ev.link && (
												<a href={ev.link} target="_blank" rel="noreferrer noopener">
													RP link
												</a>
											)}
										</li>
									))}
								</ul>
							</Section>
						)}
					</>
				)}
			</div>
		</article>
	);
}
