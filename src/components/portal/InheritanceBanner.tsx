// The character form's note for a character made in a family's Inheritance: what it inherits,
// any rolls still with the owner, and the way back to the Inheritance.
import type { InheritanceFamily } from '../../lib/families/inheritanceApi.ts';
import type { InheritanceRoll, ReadablePerk } from '../../lib/portal/inheritance.ts';

const familyPage = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}families/view/`;

export function InheritanceBanner(props: { family: InheritanceFamily; got: ReadablePerk[]; rolls: InheritanceRoll[]; characterId: string | null; editable: boolean }) {
	const waiting = props.rolls.filter((r) => r.status === 'pending').length;
	const href = `${familyPage}?f=${encodeURIComponent(props.family.slug)}${props.characterId ? `&inherit=${encodeURIComponent(props.characterId)}` : ''}`;
	return (
		<div class="pf-status ih-banner" role="note" style={{ '--fam': props.family.colour }}>
			<div class="ih-banner-text">
				<strong>🧬 {props.family.name} Inheritance</strong>
				<span>
					{props.got.length} perk{props.got.length === 1 ? '' : 's'} inherited
					{waiting > 0 && ` · ${waiting} roll${waiting === 1 ? '' : 's'} waiting for the owner`}
				</span>
				{props.got.length > 0 && (
					<span class="ih-banner-perks">
						{props.got.map((p) => (
							<span class="fm-chip" key={p.id}>
								{p.title}
							</span>
						))}
					</span>
				)}
			</div>
			{props.editable && (
				<a class="pf-button subtle" href={href}>
					Change the Inheritance
				</a>
			)}
		</div>
	);
}
