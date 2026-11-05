// What people who aren't allowed see in place of an encrypted character: falling 1s and 0s
// behind a lock. It's decoration only; the database never sends them the sheet.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/** Columns of binary falling down a canvas (one still frame with reduced motion). */
function BinaryRain() {
	const canvas = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const el = canvas.current;
		const ctx = el?.getContext('2d');
		if (!el || !ctx) return;
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const accent = getComputedStyle(el).getPropertyValue('--pf-accent').trim() || '#3369ff';
		const size = 15;
		let drops: number[] = [];
		const resize = () => {
			const box = el.getBoundingClientRect();
			el.width = Math.max(1, Math.floor(box.width * devicePixelRatio));
			el.height = Math.max(1, Math.floor(box.height * devicePixelRatio));
			ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
			drops = Array.from({ length: Math.ceil(box.width / size) }, () => Math.random() * -(box.height / size));
		};
		const frame = (fade: number) => {
			const { width, height } = el.getBoundingClientRect();
			ctx.fillStyle = `rgba(10, 12, 18, ${fade})`;
			ctx.fillRect(0, 0, width, height);
			ctx.font = `${size - 2}px ui-monospace, monospace`;
			drops.forEach((y, i) => {
				const head = Math.random() < 0.08;
				ctx.fillStyle = head ? '#e8ecff' : accent;
				ctx.globalAlpha = head ? 0.95 : 0.35 + Math.random() * 0.45;
				ctx.fillText(Math.random() < 0.5 ? '0' : '1', i * size, y * size);
				ctx.globalAlpha = 1;
				drops[i] = y * size > height && Math.random() > 0.975 ? 0 : y + 1;
			});
		};
		resize();
		if (still) {
			// One full screen of digits, no movement.
			const rows = Math.ceil(el.getBoundingClientRect().height / size);
			for (let r = 0; r < rows; r++) frame(0.06);
			return;
		}
		const timer = setInterval(() => frame(0.09), 55);
		addEventListener('resize', resize);
		return () => {
			clearInterval(timer);
			removeEventListener('resize', resize);
		};
	}, []);
	return <canvas ref={canvas} class="enc-rain" aria-hidden="true" />;
}

export function EncryptedScreen({ name, owner, children }: { name: string; owner?: string | null; children?: ComponentChildren }) {
	return (
		<div class="enc-screen" role="region" aria-label="Encrypted character">
			<BinaryRain />
			<div class="enc-card">
				<span class="enc-lock" aria-hidden="true">
					🔒
				</span>
				<p class="enc-kicker">Encrypted</p>
				<h2 class="enc-name">{name}</h2>
				{owner && <p class="enc-owner">Owned by {owner}</p>}
				<p class="enc-message">You are not authorized to view this character.</p>
				{children}
			</div>
		</div>
	);
}
