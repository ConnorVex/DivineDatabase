// The Cyberware tab: the body's slots as sockets. Tap an empty socket to install a piece from the
// list (with its grade and tier), tap an installed one to change or remove it. Locked until the
// character is approved; until then the slots and the list can still be browsed.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
	CATALOG,
	CYBER_GRADES,
	CYBER_REGIONS,
	CYBER_TIERS,
	GRADE_ABOUT,
	OTHER_CYBERWARE,
	SLOT_ICON,
	pieceName,
	slotTotal,
	type CyberPiece,
	type CyberSlot,
} from '../../lib/portal/cyberware.ts';

interface Props {
	pieces: CyberPiece[];
	slots: CyberSlot[];
	/** Why it's locked (browse only), or null. */
	locked: string | null;
	readOnly: boolean;
	onChange: (pieces: CyberPiece[], extraSlots: string[]) => void;
}

/** What the picker is doing: installing into a slot, or editing an installed piece. */
type Picking = { slot: string; index: number | null };

export function CyberwareBay({ pieces, slots, locked, readOnly, onChange }: Props) {
	const [picking, setPicking] = useState<Picking | null>(null);
	const [flash, setFlash] = useState<number | null>(null);
	const canEdit = !locked && !readOnly;
	const installed = pieces.length;
	const total = slots.reduce((n, s) => n + slotTotal(s), 0);
	const extraSlots = slots.flatMap((s) => Array<string>(s.extra).fill(s.id));
	const byId = new Map(slots.map((s) => [s.id, s]));

	const save = (next: CyberPiece[], extras = extraSlots) => onChange(next, extras);

	return (
		<div class="cy-bay pf-wide">
			<div class="cy-head">
				<div>
					<p class="cy-kicker">Chrome installed</p>
					<p class="cy-count">
						<strong>{installed}</strong> / {total} slots
					</p>
				</div>
				<div class="cy-meter" aria-hidden="true">
					{Array.from({ length: total }, (_, i) => (
						<span key={i} class={i < installed ? 'on' : ''} />
					))}
				</div>
			</div>
			{locked && (
				<p class="cy-locked">
					<span aria-hidden="true">🔒</span> {locked}
				</p>
			)}

			{CYBER_REGIONS.map((region) => (
				<section class="cy-region" key={region.label}>
					<h5 class="cy-region-label">{region.label}</h5>
					<div class="cy-slots">
						{region.slots.map((id) => {
							const slot = byId.get(id);
							if (!slot) return null;
							const here = pieces.map((p, i) => ({ p, i })).filter((x) => x.p.slot === id);
							const count = slotTotal(slot);
							const options = CATALOG[id]?.length ?? 0;
							return (
								<div class={`cy-slot${here.length >= count ? ' full' : ''}`} key={id}>
									<div class="cy-slot-head">
										<span class="cy-icon" aria-hidden="true">
											{SLOT_ICON[id]}
										</span>
										<span class="cy-slot-name">{id}</span>
										<span class="cy-slot-count">
											{here.length}/{count}
										</span>
									</div>
									<div class="cy-sockets">
										{here.map(({ p, i }) => (
											<button
												type="button"
												key={i}
												class={`cy-piece g-${p.grade.toLowerCase()}${flash === i ? ' fresh' : ''}`}
												onClick={() => setPicking({ slot: id, index: i })}
												disabled={!canEdit}
												aria-label={`${pieceName(p)}, ${p.grade}, Tier ${p.tier}${canEdit ? ': change or remove' : ''}`}
											>
												<span class="cy-piece-name">{pieceName(p)}</span>
												<span class="cy-piece-meta">
													<span class="cy-grade">{p.grade}</span>
													<span>Tier {p.tier}</span>
												</span>
											</button>
										))}
										{Array.from({ length: Math.max(0, count - here.length) }, (_, n) => (
											<button type="button" key={`e${n}`} class="cy-empty" onClick={() => setPicking({ slot: id, index: null })} disabled={readOnly}>
												{canEdit ? '+ Install' : options ? `Browse ${options}` : 'Browse'}
											</button>
										))}
									</div>
									{slot.upgradeable && (
										<div class="cy-upgrade">
											<span>{slot.extra ? `+${slot.extra} from the Skill Tree` : 'Upgradeable on the Skill Tree'}</span>
											{canEdit && (
												<span class="cy-upgrade-btns">
													{slot.extra > 0 && here.length < count && (
														<button type="button" class="cy-mini" onClick={() => save(pieces, removeOne(extraSlots, id))} aria-label={`Remove an extra ${id} slot`}>
															−
														</button>
													)}
													<button type="button" class="cy-mini" onClick={() => save(pieces, [...extraSlots, id])} aria-label={`Add an extra ${id} slot`}>
														+ slot
													</button>
												</span>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</section>
			))}

			{picking && (
				<Picker
					slot={picking.slot}
					current={picking.index === null ? null : pieces[picking.index]}
					browseOnly={!canEdit}
					onClose={() => setPicking(null)}
					onSave={(piece) => {
						const next = [...pieces];
						let at: number;
						if (picking.index === null) {
							next.push(piece);
							at = next.length - 1;
						} else {
							next[picking.index] = piece;
							at = picking.index;
						}
						save(next);
						setFlash(at);
						setPicking(null);
					}}
					onRemove={
						picking.index === null
							? undefined
							: () => {
									save(pieces.filter((_, i) => i !== picking.index));
									setPicking(null);
								}
					}
				/>
			)}
		</div>
	);
}

const removeOne = (list: string[], id: string) => {
	const at = list.lastIndexOf(id);
	return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
};

function Picker({
	slot,
	current,
	browseOnly,
	onClose,
	onSave,
	onRemove,
}: {
	slot: string;
	current: CyberPiece | null;
	browseOnly: boolean;
	onClose: () => void;
	onSave: (p: CyberPiece) => void;
	onRemove?: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [query, setQuery] = useState('');
	const [name, setName] = useState(current?.name ?? '');
	const [custom, setCustom] = useState(current?.custom ?? '');
	const [grade, setGrade] = useState(current?.grade ?? 'Civilian');
	const [tier, setTier] = useState(current?.tier ?? '1');
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	const list = CATALOG[slot] ?? [];
	const shown = useMemo(() => list.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())), [list, query]);
	const ready = Boolean(name) && (name !== OTHER_CYBERWARE || custom.trim() !== '');

	return (
		<dialog
			ref={dialog}
			class="cy-dialog"
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialog.current) dialog.current?.close();
			}}
		>
			<div class="cy-dialog-body">
				<header class="cy-dialog-head">
					<span class="cy-icon" aria-hidden="true">
						{SLOT_ICON[slot]}
					</span>
					<div>
						<p class="cy-kicker">{browseOnly ? 'Browsing' : current ? 'Change' : 'Install into'}</p>
						<h4>{slot}</h4>
					</div>
					<button type="button" class="cy-close" onClick={() => dialog.current?.close()} aria-label="Close">
						✕
					</button>
				</header>

				{list.length > 6 && <input class="cy-search" type="search" placeholder={`Search ${list.length} pieces…`} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />}
				<div class="cy-options" role="listbox" aria-label={`${slot} Cyberware`}>
					{shown.map((i) => (
						<button
							type="button"
							role="option"
							key={i.name}
							aria-selected={name === i.name}
							class={`cy-option${name === i.name ? ' picked' : ''}`}
							disabled={browseOnly}
							onClick={() => setName(i.name)}
						>
							{i.name}
						</button>
					))}
					{!browseOnly && (
						<button type="button" role="option" aria-selected={name === OTHER_CYBERWARE} class={`cy-option other${name === OTHER_CYBERWARE ? ' picked' : ''}`} onClick={() => setName(OTHER_CYBERWARE)}>
							Something else…
						</button>
					)}
					{shown.length === 0 && list.length > 0 && <p class="pf-help">Nothing matches “{query}”.</p>}
					{list.length === 0 && <p class="pf-help">Nothing on the list fits this slot yet. {browseOnly ? '' : 'Use “Something else” and staff check it.'}</p>}
				</div>
				{name === OTHER_CYBERWARE && (
					<label class="cy-field">
						<span>Its name (staff check pieces not on the list)</span>
						<input type="text" value={custom} onInput={(e) => setCustom(e.currentTarget.value)} />
					</label>
				)}

				{!browseOnly && (
					<>
						<div class="cy-choice">
							<span class="cy-choice-label">Grade</span>
							<div class="cy-seg">
								{CYBER_GRADES.map((g) => (
									<button type="button" key={g} class={`g-${g.toLowerCase()}${grade === g ? ' on' : ''}`} aria-pressed={grade === g} onClick={() => setGrade(g)}>
										{g}
									</button>
								))}
							</div>
							<p class="pf-help">{GRADE_ABOUT[grade]}</p>
						</div>
						<div class="cy-choice">
							<span class="cy-choice-label">Tier</span>
							<div class="cy-seg">
								{CYBER_TIERS.map((t) => (
									<button type="button" key={t.tier} class={tier === String(t.tier) ? 'on' : ''} aria-pressed={tier === String(t.tier)} onClick={() => setTier(String(t.tier))}>
										{t.tier}
									</button>
								))}
							</div>
							<p class="pf-help">Tier {tier} unlocks at Ripperdocs at level {CYBER_TIERS.find((t) => String(t.tier) === tier)?.level ?? 0}.</p>
						</div>
					</>
				)}

				<footer class="cy-dialog-foot">
					{onRemove && !browseOnly && (
						<button type="button" class="pf-button subtle cy-remove" onClick={onRemove}>
							Remove
						</button>
					)}
					{!browseOnly && (
						<button type="button" class="pf-button primary" disabled={!ready} onClick={() => onSave({ name, custom: name === OTHER_CYBERWARE ? custom.trim() : '', slot, grade, tier })}>
							{current ? 'Save' : 'Install'}
						</button>
					)}
				</footer>
			</div>
		</dialog>
	);
}
