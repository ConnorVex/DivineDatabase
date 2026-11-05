# Divine Database: instructions for Gemini

You're working on the **Divine Database** (https://database.singularityeco.us). It's the character portal for the Singularity roleplay community: character submission, review, evolutions, equipment and families.

Two assistants share this repo:

| Who | Owns |
| --- | --- |
| **Gemini (you)** | **Aesthetics**: layout, CSS, spacing, typography, colors, icons, wording, markup structure, responsive behavior, empty and loading states. |
| **Claude** | **Functionality**: database and SQL, security, permissions, data loading and saving, rule checks, new features, the Discord bot. |

If a change needs both, do the visual part and leave the functional part as a request in `HANDOFF.md` (see below). Don't build it yourself.

---

## Hard rules

1. **Never commit or push.** The owner reviews everything and decides when to push. Leave changes uncommitted in the working tree.
2. **Don't touch these files.** They're functionality, and Claude's area:
   - `supabase/migrations/**`: SQL, security rules, triggers.
   - `src/lib/**`: data access (`api.ts`), rule checks (`rules.ts`, `checks.ts`), sheet logic, tests.
   - `src/lib/supabase.ts`: login.
   - Anything that changes what gets saved, who can see what, or what counts as an error.
3. **Inside components (`src/components/**/*.tsx`), change only presentation**: markup, class names, text, order, which wrapper elements are used. Don't change:
   - function calls to `api.ts`, `useEffect` data loading, or `if` checks around admin/owner/permissions;
   - what a button *does* (its `onClick` target);
   - props passed into data functions.
   If you think one of those should change, write it in `HANDOFF.md`.
4. **One panel at a time.** The owner names the panel. Finish it and let them review it at desktop **and** phone size before moving to the next.
5. **This repo is public.** Never add trait-combo data, private perk lists, keys or anything from `.env`. Never print `.env` values.
6. **Don't run the Discord bot** (`../SingularityBot`) or its deploy script. It's live on a server, and a second copy would answer every command twice.

---

## Stack

- **Astro 5 + Starlight** (docs theme) for pages, with **Preact** components (`client:only="preact"`) for everything interactive.
- **Supabase** backend. The browser uses the public anon key, and row-level security decides what each user sees.
- Deployed by **GitHub Pages** about a minute after a push to `main`. (Again: you never push.)

### Where things are

| Path | What |
| --- | --- |
| `src/pages/*.astro` | Routes. `submit.astro` is the character form, `characters.astro` is My Stuff, `character.astro` is a character's page, `evolve.astro`, `equipment.astro`, `admin/review.astro` is the **Admin panel**, and `families/*`. |
| `src/components/portal/*.tsx` | Portal UI. Big ones: `SubmitForm.tsx` (the form), `ReviewDashboard.tsx` (the admin panel and review), `OverridePanel.tsx` (Players & rolls), `CharacterArticle.tsx` (the wiki-style character page), `MyCharacters.tsx`, `StatsSection.tsx`, `SystemsSection.tsx`, `TraitsSection.tsx`. |
| `src/components/portal/fields.tsx` | Shared form fields: `TextField`, `TextArea`, `SelectField`, `NumberField`, `CheckboxGroup`, `Section`. Reuse these. |
| `src/components/portal/AdminRail.tsx`, `CharacterPicker.tsx`, `OwnerCard.tsx` | The newest admin pieces: the side rail, the custom character dropdown, and the owner card in review. |
| `src/components/families/*` | Families UI. |
| `src/styles/portal.css` | **Almost all portal styling** (about 4,800 lines; search for the class name). |
| `src/styles/families.css` | Families styling. |
| `src/styles/site.css` | Small global tweaks. |

### Design tokens (use these, never hard-code colors)

They're defined at the top of `portal.css` and follow the light/dark theme automatically:

- `--pf-accent`: the role or theme color.
- `--pf-ink`: text on the accent color.
- `--pf-bg`, `--pf-panel`, `--pf-field`: page, card and input backgrounds.
- `--pf-line`, `--pf-line-strong`: borders.
- `--pf-text`, `--pf-muted`, `--pf-faint`: text levels.
- `--pf-glow`.
- `--pf-radius`, `--pf-mono`.
- Rarity colors: `--pf-common`, `--pf-uncommon`, `--pf-rare`, `--pf-legendary`, `--pf-mythic`.

Starlight variables (`--sl-text-sm`, `--sl-color-*`) are also available.

### Starlight gotcha (important)

Starlight adds `margin-top` to every element after the first inside page content. Any new flex or grid container needs:

```css
.pf .my-container > * { margin-top: 0; }
```

Otherwise its children get uneven gaps. CSS can't nest `:has()` inside `:has()`, so don't try it.

---

## Running it and seeing your work

```bash
npm run dev            # http://localhost:4321 (or 4322 if 4321 is taken)
```

Most portal pages need a **Discord login**, and admin pages need an admin account, so you can't see them on localhost. To work on them, use a **mock preview page** with fake data:

- `src/pages/dev-admin.astro` plus `src/dev-preview/AdminPreview.tsx` already exist. Open http://localhost:4321/dev-admin/ to see the Admin panel on mock data.
  - It stubs network calls (`window.fetch`) so the real components render.
- For another panel, copy that pattern: `src/pages/dev-<panel>.astro` plus `src/dev-preview/<Panel>Preview.tsx`.
- Dev preview files are **ignored by git on this machine** (`.git/info/exclude`), so they never get committed. Keep them there.

**Check every change at desktop width (~1280px) and phone width (375px).** No sideways scrolling on phones.

### Before you hand back

Run all three. They must pass:

```bash
../SingularityBot/node_modules/.bin/tsc --noEmit -p .     # typecheck
node --test src/lib/portal/*.test.ts                      # rules tests
npx astro build                                           # production build
```

---

## HANDOFF.md: talking to Claude

`HANDOFF.md` in the repo root is a local file (git ignores it) that both assistants read. When you finish a session, add an entry at the top:

```md
## <date>: <panel>, Gemini
Changed: <files and what changed visually>
Checked: desktop / phone, tsc, tests, build
Needs Claude: <functional changes this design needs, e.g. "show the player's roll count here (needs a new field)">
Open questions for the owner: …
```

Read the newest entries first when you start. Claude writes there too, for example "the X component now has a new prop, style it."

---

## Current state (2026-11-05)

- **Live:**
  - Encrypted characters (lock screen with falling 1s and 0s).
  - Admin characters with Error Tiers and the Divine S.T.S.
  - The merged **Admin panel**: a side rail with Inbox (Characters, Families, Perks, Equipment) and Players & rolls, a custom character dropdown, an owner card in review, and staff edit inside Players & rolls.
  - Approved 🔑 requests show as "✅ Approved".
  - Only the prime owner can roll-ban admins.
  - **Maintenance mode** (Admin panel → Maintenance): non-admins get a "back soon" screen on every page.
    - The screen's look is in `src/styles/maintenance.css`, and its text is in `src/maintenance-gate.ts`. Restyle freely, but don't change the gate's checks.
    - Preview it in dev at `/?maintenance=preview`.
- **Panel rework:** the owner is going through the panels one at a time, approving each in dev. Done: **Admin Review + Rolls**. Next: whichever panel the owner names.
- **Functional backlog (Claude, not you):**
  - Admin characters: custom traits, no limits other than the trait slots, custom values for any non-S.T.S stat.
  - JJK: a glitched Ocular slot (granted per character, readable only by the owner and admins), Extension vs Maximum Techniques (Maximum locked until granted or evolved), and a Binding Vows list.
  - If a panel you're styling will gain one of these, leave room for it, but don't build it.
