// Staff edit on the review page: admins set any stat, the Potential or any power system field on a
// character that isn't approved yet (e.g. one coming in already progressed). What staff set is
// exempt from the starting limits and locked for the player; "Release" hands a value back.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { staffEditCharacter, type AdminCharacter } from '../../lib/portal/api.ts';
import { cardPath, ranks, rules, type StaffOverrides } from '../../lib/portal/rules.ts';
import { normalizeSheet, type Sheet } from '../../lib/portal/sheet.ts';
import { systemById, visibleFields, type FieldValue } from '../../lib/portal/systems.ts';
import { watchPlayer } from '../../lib/supabase.ts';
import { NumberField, SelectField } from './fields.tsx';
import { FieldInput } from './SystemsSection.tsx';

const STATS = [
	['strength', 'Strength'],
	['speed', 'Speed'],
	['defense', 'Defense'],
	['stamina', 'Stamina'],
] as const;
const rankOptions = ranks.map((r) => ({ value: r.rank, label: `${r.rank} · ${r.value}`, group: `Tier ${r.tier}` }));

/** Reads a path (stats.strength, potential.grade, card:<key>.<field>) from a sheet. */
export function readPath(sheet: Sheet, path: string): unknown {
	if (path.startsWith('card:')) {
		const [card, field] = path.slice(5).split('.');
		return sheet.systems.find((e) => e.key === card)?.fields[field];
	}
	return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), sheet);
}

/** What a path is called, for the list of values staff set. */
export function pathLabel(sheet: Sheet, path: string) {
	if (path.startsWith('card:')) {
		const [card, field] = path.slice(5).split('.');
		const entry = sheet.systems.find((e) => e.key === card);
		const def = entry && systemById.get(entry.system);
		return `${def?.label ?? 'Removed card'}: ${def?.fields.find((f) => f.key === field)?.label ?? field}`;
	}
	const [, key] = path.split('.');
	if (path === 'potential.grade') return 'Potential';
	if (path === 'stats.physicalMeter') return 'Physical meter';
	return key ? key[0].toUpperCase() + key.slice(1) : path;
}

const show = (v: unknown) => (v === undefined || v === '' ? 'empty' : Array.isArray(v) ? v.join(', ') || 'none' : String(v));

export function StaffEditor({ c, onSaved }: { c: AdminCharacter; onSaved: () => void }) {
	const [editing, setEditing] = useState(false);
	const [sheet, setSheet] = useState<Sheet>(() => normalizeSheet(c.sheet));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [me, setMe] = useState('an admin');
	useEffect(() => watchPlayer((p) => p && setMe(p.displayName)), []);
	useEffect(() => setSheet(normalizeSheet(c.sheet)), [c.id, c.updated_at]);

	const overrides = c.staff_overrides ?? {};
	const update = (fn: (s: Sheet) => void) =>
		setSheet((prev) => {
			const next = structuredClone(prev);
			fn(next);
			return next;
		});

	// Every path the editor covers, so changes can be found by comparing.
	const paths = useMemo(
		() => [
			...STATS.map(([k]) => `stats.${k}`),
			'stats.intelligence',
			'stats.phase',
			'stats.physicalMeter',
			'potential.grade',
			...sheet.systems.flatMap((e) => (systemById.get(e.system)?.fields ?? []).map((f) => cardPath(e.key, f.key))),
		],
		[sheet],
	);
	const original = normalizeSheet(c.sheet);
	const changed = paths.filter((p) => JSON.stringify(readPath(sheet, p)) !== JSON.stringify(readPath(original, p)));

	async function save(next: StaffOverrides, nextSheet: Sheet) {
		setBusy(true);
		setError('');
		try {
			await staffEditCharacter(c.id, nextSheet, next);
			setEditing(false);
			onSaved();
		} catch (e) {
			setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
		} finally {
			setBusy(false);
		}
	}
	const saveChanges = () => {
		const at = new Date().toISOString();
		const next: StaffOverrides = { ...overrides };
		for (const p of changed) next[p] = { from: overrides[p]?.from ?? readPath(original, p), to: readPath(sheet, p), by: me, at };
		return save(next, sheet);
	};
	const release = (path: string) => {
		const { [path]: _gone, ...rest } = overrides;
		return save(rest, original);
	};

	const set = Object.entries(overrides);
	return (
		<div class="se">
			{set.length > 0 && (
				<ul class="se-list">
					{set.map(([path, o]) => (
						<li key={path}>
							<span class="se-tag">Set by staff</span>
							<span class="se-what">
								<strong>{pathLabel(original, path)}</strong>: {show(o.from)} → {show(readPath(original, path))}{' '}
								<span class="pf-help">
									· {o.by ?? 'an admin'}
									{o.at ? `, ${new Date(o.at).toLocaleDateString()}` : ''}
								</span>
							</span>
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => release(path)} title="The player can change it again; it counts toward the starting limits again.">
								Release
							</button>
						</li>
					))}
				</ul>
			)}
			{!editing ? (
				<button type="button" class="pf-button" onClick={() => setEditing(true)}>
					✎ Edit as staff
				</button>
			) : (
				<div class="se-form">
					<p class="pf-help">Values you change here skip the starting limits (PTP, phase, Potential and starting stats) and are locked for the player.</p>
					<h4 class="pf-subhead">S.T.S stats</h4>
					<div class="pf-grid se-grid">
						{STATS.map(([key, label]) => (
							<SelectField key={key} label={label} value={sheet.stats[key]} options={rankOptions} onChange={(v) => update((s) => void (s.stats[key] = v))} />
						))}
						<SelectField
							label="Intelligence"
							value={sheet.stats.intelligence}
							options={rules.stats.intelligence.map((i) => ({ value: i.value }))}
							onChange={(v) => update((s) => void (s.stats.intelligence = v))}
						/>
						<SelectField
							label="Phase"
							value={String(sheet.stats.phase)}
							options={rules.stats.phases.map((p) => ({ value: String(p.phase), label: p.label }))}
							onChange={(v) => update((s) => void (s.stats.phase = Number(v) || 0))}
						/>
						<NumberField label="Physical meter" min={0} value={sheet.stats.physicalMeter} onInput={(v) => update((s) => void (s.stats.physicalMeter = v))} />
						<SelectField
							label="Potential"
							value={sheet.potential.grade}
							options={rules.potentials.map((p) => ({ value: p.id, label: p.label }))}
							onChange={(v) => update((s) => void (s.potential.grade = v))}
						/>
					</div>
					{sheet.systems.map((entry) => {
						const def = systemById.get(entry.system);
						if (!def) return null;
						return (
							<details class="se-card" key={entry.key}>
								<summary>{def.label}</summary>
								<div class="pf-grid se-grid">
									{visibleFields(def, entry.fields)
										.filter((f) => f.type !== 'list')
										.map((field) => (
											<FieldInput
												key={field.key}
												field={field}
												value={entry.fields[field.key]}
												disabled={false}
												onChange={(v: FieldValue) => update((s) => void (s.systems.find((e) => e.key === entry.key)!.fields[field.key] = v))}
											/>
										))}
								</div>
							</details>
						);
					})}
					{error && <p class="portal-error">{error}</p>}
					<div class="se-actions">
						<button type="button" class="pf-button primary" disabled={busy || !changed.length} onClick={saveChanges}>
							{changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'No changes'}
						</button>
						<button
							type="button"
							class="pf-button subtle"
							onClick={() => {
								setSheet(original);
								setEditing(false);
							}}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
