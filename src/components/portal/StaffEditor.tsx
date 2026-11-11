// Values set with the old staff edit (Override Mode replaced it): exempt from the starting limits and
// locked for the player until an admin presses "Release".
import { useState } from 'preact/hooks';
import { staffEditCharacter, type AdminCharacter } from '../../lib/portal/api.ts';
import { normalizeSheet, type Sheet } from '../../lib/portal/sheet.ts';
import { systemById } from '../../lib/portal/systems.ts';

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

/** Values staff set with the old "Edit as staff" (before Override Mode): each can be released back to the player. */
export function StaffEditor({ c, onSaved }: { c: AdminCharacter; onSaved: () => void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const overrides = c.staff_overrides ?? {};
	const original = normalizeSheet(c.sheet);
	const set = Object.entries(overrides);

	async function release(path: string) {
		const { [path]: _gone, ...rest } = overrides;
		setBusy(true);
		setError('');
		try {
			await staffEditCharacter(c.id, original, rest);
			onSaved();
		} catch (e) {
			setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
		} finally {
			setBusy(false);
		}
	}

	if (!set.length) return null;
	return (
		<div class="se">
			<p class="pf-help">Set with the old staff edit. Released values count toward the starting limits again and the player can change them.</p>
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
						<button type="button" class="pf-button subtle" disabled={busy} onClick={() => release(path)}>
							Release
						</button>
					</li>
				))}
			</ul>
			{error && <p class="portal-error">{error}</p>}
		</div>
	);
}
