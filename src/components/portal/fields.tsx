// Small labelled inputs shared by the portal forms.
import type { ComponentChildren } from 'preact';
import { useId, useState, useRef, useEffect } from 'preact/hooks';

interface Base {
	label: string;
	help?: ComponentChildren;
	required?: boolean;
	disabled?: boolean;
}

function Label({ id, label, required }: { id: string; label: string; required?: boolean }) {
	return (
		<label for={id} class="pf-label">
			{label}
			{required && <span class="pf-required" aria-hidden="true"> *</span>}
		</label>
	);
}

export function TextField(props: Base & { value: string; onInput: (v: string) => void; placeholder?: string; list?: string; type?: 'text' | 'url' | 'date' | 'search' }) {
	const id = useId();
	return (
		<div class="pf-field">
			<Label id={id} label={props.label} required={props.required} />
			<input
				id={id}
				type={(props.type ?? 'text') as 'text'} // Preact's types only allow text-like types alongside `list`
				value={props.value}
				placeholder={props.placeholder}
				list={props.list}
				disabled={props.disabled}
				onInput={(e) => props.onInput(e.currentTarget.value)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function TextArea(props: Base & { value: string; onInput: (v: string) => void; rows?: number; placeholder?: string }) {
	const id = useId();
	return (
		<div class="pf-field pf-wide">
			<Label id={id} label={props.label} required={props.required} />
			<textarea
				id={id}
				rows={props.rows ?? 4}
				value={props.value}
				placeholder={props.placeholder}
				disabled={props.disabled}
				onInput={(e) => props.onInput(e.currentTarget.value)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function NumberField(props: Base & { value: number | undefined; onInput: (v: number) => void; min?: number }) {
	const id = useId();
	return (
		<div class="pf-field">
			<Label id={id} label={props.label} required={props.required} />
			<input
				id={id}
				type="number"
				inputMode="decimal"
				min={props.min}
				value={props.value ?? ''}
				disabled={props.disabled}
				onInput={(e) => props.onInput(Number(e.currentTarget.value) || 0)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export interface SelectOption {
	value: string;
	label?: string;
	disabled?: boolean;
	group?: string;
}

export function SelectField(props: Base & { value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; /** Show group headers even when there's one group. */ showGroups?: boolean }) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const groups = [...new Set(props.options.map((o) => o.group ?? ''))];

	// Close when clicking outside
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	}, [open]);

	// Scroll selected option into view when opened
	useEffect(() => {
		if (open && dropdownRef.current) {
			const selectedEl = dropdownRef.current.querySelector('.pf-select-item.selected') as HTMLElement | null;
			if (selectedEl) {
				selectedEl.scrollIntoView({ block: 'nearest' });
			}
		}
	}, [open]);

	// Close on Escape
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			setOpen(false);
		}
	};

	const currentOption = props.options.find((o) => o.value === props.value);
	const displayLabel = currentOption ? (currentOption.label ?? currentOption.value) : (props.placeholder ?? 'Choose…');

	return (
		<div class={`pf-field pf-select-field ${open ? 'open' : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
			<Label id={id} label={props.label} required={props.required} />
			<div class="pf-select-wrapper">
				<button
					id={id}
					type="button"
					class={`pf-select-trigger ${open ? 'open' : ''} ${!currentOption ? 'is-placeholder' : ''}`}
					disabled={props.disabled}
					aria-haspopup="listbox"
					aria-expanded={open}
					onClick={() => !props.disabled && setOpen(!open)}
				>
					<span class="pf-select-trigger-label">{displayLabel}</span>
					<span class="pf-select-chevron" aria-hidden="true">▾</span>
				</button>

				{/* Hidden standard select for tests and accessibility */}
				<select
					tabIndex={-1}
					aria-hidden="true"
					class="sr-only"
					style={{ display: 'none' }}
					value={props.value}
					disabled={props.disabled}
					onChange={(e) => props.onChange(e.currentTarget.value)}
				>
					<option value="">{props.placeholder ?? 'Choose…'}</option>
					{props.options.map((o) => (
						<option key={o.value} value={o.value} disabled={o.disabled}>
							{o.label ?? o.value}
						</option>
					))}
				</select>

				{open && !props.disabled && (
					<div class="pf-select-dropdown" ref={dropdownRef} role="listbox" aria-label={props.label}>
						{props.placeholder && (
							<div
								role="option"
								aria-selected={!props.value}
								class={`pf-select-item ${!props.value ? 'selected' : ''}`}
								onClick={() => {
									props.onChange('');
									setOpen(false);
								}}
							>
								<span class="pf-select-item-text">{props.placeholder}</span>
								{!props.value && <span class="pf-select-check">✓</span>}
							</div>
						)}
						{groups.length > 1 || (props.showGroups && groups.some(Boolean))
							? groups.map((g) => (
									<div key={g} class="pf-select-group">
										{g && <div class="pf-select-group-header">{g}</div>}
										{props.options
											.filter((o) => (o.group ?? '') === g)
											.map((o) => {
												const isSelected = o.value === props.value;
												return (
													<div
														key={o.value}
														role="option"
														aria-selected={isSelected}
														class={`pf-select-item ${isSelected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
														onClick={() => {
															if (o.disabled) return;
															props.onChange(o.value);
															setOpen(false);
														}}
													>
														<span class="pf-select-item-text">{o.label ?? o.value}</span>
														{isSelected && <span class="pf-select-check">✓</span>}
													</div>
												);
											})}
									</div>
								))
							: props.options.map((o) => {
									const isSelected = o.value === props.value;
									return (
										<div
											key={o.value}
											role="option"
											aria-selected={isSelected}
											class={`pf-select-item ${isSelected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
											onClick={() => {
												if (o.disabled) return;
												props.onChange(o.value);
												setOpen(false);
											}}
										>
											<span class="pf-select-item-text">{o.label ?? o.value}</span>
											{isSelected && <span class="pf-select-check">✓</span>}
										</div>
									);
								})}
					</div>
				)}
			</div>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function CheckboxGroup(props: Base & { values: string[]; onChange: (v: string[]) => void; options: SelectOption[] }) {
	return (
		<fieldset class="pf-field pf-bubbles-fieldset">
			<legend class="pf-label">
				{props.label}
				{props.required && <span class="pf-required" aria-hidden="true"> *</span>}
			</legend>
			<div class="pf-bubbles-container">
				{props.options.map((o) => {
					const isChecked = props.values.includes(o.value);
					return (
						<label
							key={o.value}
							class={`pf-bubble-chip ${isChecked ? 'selected' : ''} ${props.disabled || o.disabled ? 'disabled' : ''}`}
						>
							<input
								type="checkbox"
								class="sr-only"
								checked={isChecked}
								disabled={props.disabled || o.disabled}
								onChange={(e) =>
									props.onChange(
										e.currentTarget.checked
											? [...props.values, o.value]
											: props.values.filter((v) => v !== o.value),
									)
								}
							/>
							<span class="pf-bubble-icon">{isChecked ? '✓' : '○'}</span>
							<span class="pf-bubble-text">{o.label ?? o.value}</span>
						</label>
					);
				})}
			</div>
			{props.help && <p class="pf-help">{props.help}</p>}
		</fieldset>
	);
}

export function Section(props: { title: string; id: string; children: ComponentChildren; intro?: ComponentChildren; badge?: ComponentChildren }) {
	return (
		<section class="pf-section" id={props.id} aria-labelledby={`${props.id}-title`}>
			<header class="pf-section-head">
				<h2 id={`${props.id}-title`}>{props.title}</h2>
				{props.badge}
			</header>
			{props.intro && <p class="pf-intro">{props.intro}</p>}
			<div class="pf-grid">{props.children}</div>
		</section>
	);
}
