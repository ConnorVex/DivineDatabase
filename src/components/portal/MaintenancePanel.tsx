// Admin panel → Maintenance: switch maintenance mode on or off, with an optional message.
import { useEffect, useState } from 'preact/hooks';
import { loadMaintenance, setMaintenance, type MaintenanceState } from '../../lib/maintenance.ts';
import { TextArea } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function MaintenancePanel() {
	const [state, setState] = useState<MaintenanceState | null | undefined>(undefined);
	const [message, setMessage] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const reload = () =>
		loadMaintenance().then(
			(s) => {
				setState(s);
				setMessage(s?.maintenance_message ?? '');
			},
			(e) => setError(messageOf(e)),
		);
	useEffect(() => void reload(), []);

	async function save(on: boolean) {
		setBusy(true);
		setError('');
		try {
			await setMaintenance(on, message);
			await reload();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	if (state === undefined) return <p class="portal-status">Loading…</p>;
	const on = Boolean(state?.maintenance);
	return (
		<section class="hud-panel mnt-panel">
			<h3 class="hud-panel-title">Maintenance mode</h3>
			<div class={`mnt-state ${on ? 'on' : 'off'}`} role="status">
				<span class="mnt-dot" aria-hidden="true" />
				<div>
					<strong>{on ? 'On: only admins can see the site' : 'Off: the site is open to everyone'}</strong>
					{state?.updated_at && <span class="pf-help">Last changed {when(state.updated_at)}</span>}
				</div>
			</div>
			<p class="pf-help">
				While it’s on, everyone who isn’t a logged-in admin sees a “we’re working on it, back soon” screen on every page. Admins see the site as usual, with a small
				banner.
			</p>
			<TextArea label="Message on the screen (optional)" rows={2} value={message} placeholder="e.g. New character form coming tonight!" onInput={setMessage} />
			<div class="mnt-actions">
				{on ? (
					<>
						<button type="button" class="pf-button primary" disabled={busy} onClick={() => save(false)}>
							Turn off and reopen the site
						</button>
						<button type="button" class="pf-button subtle" disabled={busy || message === (state?.maintenance_message ?? '')} onClick={() => save(true)}>
							Update message
						</button>
					</>
				) : (
					<button type="button" class="pf-button danger" disabled={busy} onClick={() => save(true)}>
						🛠️ Turn on maintenance mode
					</button>
				)}
			</div>
			{error && <p class="portal-error">{error}</p>}
		</section>
	);
}
