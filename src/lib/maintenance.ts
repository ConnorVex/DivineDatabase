// Maintenance mode: one switch in the database (site_settings). The gate on every page reads it.
import { supabase } from './supabase.ts';

export interface MaintenanceState {
	maintenance: boolean;
	maintenance_message: string;
	updated_at: string;
}

export async function loadMaintenance(): Promise<MaintenanceState | null> {
	if (!supabase) return null;
	const { data, error } = await supabase.from('site_settings').select('maintenance, maintenance_message, updated_at').maybeSingle();
	if (error) throw error;
	return data;
}

/** Admins only (the database checks). */
export async function setMaintenance(on: boolean, message: string) {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	const { error } = await supabase.rpc('set_maintenance', { p_on: on, p_message: message });
	if (error) throw error;
	try {
		localStorage.setItem(MAINTENANCE_KEY, on ? '1' : '0');
	} catch {}
}

/** Remembered in the browser so a returning visitor doesn't glimpse the site before the check. */
export const MAINTENANCE_KEY = 'dd-maintenance';
