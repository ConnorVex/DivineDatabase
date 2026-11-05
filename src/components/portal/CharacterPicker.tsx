// A styled dropdown for picking one of a player's characters (not a native <select>): a button
// that opens a list with a search box, status pills and keyboard support.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface PickerOption {
	id: string;
	name: string;
	/** Short status text, e.g. "approved". */
	note?: string;
	tone?: 'ok' | 'warn' | 'bad' | 'info';
}

export function CharacterPicker({ options, value, onChange, label = 'Character' }: { options: PickerOption[]; value: string | null; onChange: (id: string) => void; label?: string }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [hover, setHover] = useState(0);
	const root = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const current = options.find((o) => o.id === value) ?? null;
	const q = query.trim().toLowerCase();
	const shown = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;

	// Close on a click outside.
	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
		document.addEventListener('pointerdown', away);
		return () => document.removeEventListener('pointerdown', away);
	}, [open]);
	useEffect(() => {
		if (!open) return;
		setQuery('');
		setHover(Math.max(0, options.findIndex((o) => o.id === value)));
		requestAnimationFrame(() => search.current?.focus());
	}, [open]);

	const pick = (o: PickerOption) => {
		onChange(o.id);
		setOpen(false);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') setOpen(false);
		else if (e.key === 'ArrowDown') (e.preventDefault(), setHover((h) => Math.min(shown.length - 1, h + 1)));
		else if (e.key === 'ArrowUp') (e.preventDefault(), setHover((h) => Math.max(0, h - 1)));
		else if (e.key === 'Enter' && shown[hover]) (e.preventDefault(), pick(shown[hover]));
	};

	return (
		<div class={`cpk${open ? ' open' : ''}`} ref={root} onKeyDown={onKey}>
			<button type="button" class="cpk-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span class="cpk-label">{label}</span>
				<span class="cpk-current">
					{current ? current.name : 'Pick a character'}
					{current?.note && <span class={`cpk-pill ${current.tone ?? ''}`}>{current.note}</span>}
				</span>
				<span class="cpk-count">{options.length}</span>
				<span class="cpk-chevron" aria-hidden="true" />
			</button>
			{open && (
				<div class="cpk-menu">
					{options.length > 5 && (
						<input
							ref={search}
							type="search"
							class="cpk-search"
							placeholder={`Search ${options.length} characters…`}
							value={query}
							onInput={(e) => (setQuery(e.currentTarget.value), setHover(0))}
							aria-label="Search characters"
						/>
					)}
					<ul role="listbox" aria-label={label}>
						{shown.map((o, i) => (
							<li
								key={o.id}
								role="option"
								aria-selected={o.id === value}
								class={`${i === hover ? 'hover' : ''}${o.id === value ? ' selected' : ''}`}
								onPointerEnter={() => setHover(i)}
								onClick={() => pick(o)}
							>
								<span class="cpk-name">{o.name}</span>
								{o.note && <span class={`cpk-pill ${o.tone ?? ''}`}>{o.note}</span>}
							</li>
						))}
						{shown.length === 0 && <li class="cpk-none">No characters match “{query.trim()}”.</li>}
					</ul>
				</div>
			)}
		</div>
	);
}
