# Space Works Workspace design system — agent brief

> Read this before building or changing any Space Works Workspace UI. It describes how the brand is
> implemented in this app.
>
> **Source of truth for the brand:** the Space Works Design System
> ([SpaceWorks-Labs/SpaceWorks-Design-System](https://github.com/SpaceWorks-Labs/SpaceWorks-Design-System),
> **0.12.0**, site at [spaceworks-labs.github.io/SpaceWorks-Design-System](https://spaceworks-labs.github.io/SpaceWorks-Design-System/)),
> mounted as the `design-kit/` git submodule: `tokens/tokens.json` (colour, chart, loader and motion values),
> `motion/box-open/` (the loader and logo opening), `motion/theme-reveal/` (the light/dark switch),
> `docs/ui-brand-spec.md` (tokens, states, type, shape, logo, icons), `docs/motion.md`, `docs/theming.md`,
> `logo/` (master artwork), `fonts/` (Gilroy, Outfit, Unbounded and their licences). When this file and the
> kit disagree, the kit wins. After bumping the submodule run `npm run tokens:sync`: it regenerates
> `app/styles/palette.css`, `motion.css`, `box-open.css`, `theme-reveal.css`,
> `components/brand/boxOpenMarkup.ts`, `tests/fixtures/design-tokens.json` and `public/brand/fonts/`, which are
> committed so builds and CI never need the submodule (`git submodule update --init design-kit` only for the sync).
>
> The `--yy-*` variable prefix and the `yy-*` helper classes (`ease-yy`, `yy-prose`) match Space Works
> Events so utilities stay interchangeable between the two apps. Their **values** are Space Works.

---

## 1. What the design must do

Space Works Workspace is the private operating tool of a maker community: projects, chat, docs, the
kitty, meetings and an assistant. People open it many times a day, on laptops at the workbench and on
phones on the bus.

1. **Calm and useful.** It is an internal tool, not a marketing site. Quiet cream canvas, white panels,
   hairlines, one obvious primary action per view.
2. **Community flavour in words, not decoration.** Members, crew, projects, shifts, the kitty.
   Warm, specific copy; Patch for page states, no emoji in chrome.
3. **Dense where work happens.** Boards, tables and chat use the 4px grid tightly; forms and settings
   breathe.
4. **Safe by default.** Destructive actions look different and confirm before acting.
5. **Accessible.** WCAG AA contrast for every token pair, real form controls, 44px targets, keyboard
   reachable, works at 360px wide.

---

## 2. Design tokens

Every value lives in `app/styles/tokens.css` and is mapped to Tailwind utilities in `app/globals.css`
(§9.1). **Never hard-code a hex in a component.** Use a token or a raw brand utility (`bg-sw-citron`).

### 2.1 Brand colours

Seven colours, plus reds for danger (the brand has no red). No black, no other hues.

| Name | Hex | Utility | Role |
|---|---|---|---|
| Deep Ink | `#142C2A` | `sw-ink` | Text, inverse surfaces |
| Maker Teal | `#006E63` | `sw-teal` | Primary actions, links, focus (light) |
| Workshop Orange | `#FF7447` | `sw-orange` | Emphasis fill with an ink label. Never text. |
| Citron | `#DFFF8F` | `sw-citron` | Success, app sidebar, focus (dark), selection |
| Sky Blue | `#B5CDFF` | `sw-sky` | Info |
| Warm Yellow | `#FFD447` | `sw-yellow` | Warning |
| Warm Cream | `#FFF4E8` | `sw-cream` | Page ground, labels on teal |
| Danger reds | `#B91C1C`, `#991B1B`, `#FCA5A5` | `danger-*` | Destructive actions and errors |

Brand-tested pairs: cream on teal 5.68, ink on cream 13.60, ink on orange 5.51, ink on yellow 10.37,
ink on citron 13.23, ink on sky 9.23. Orange on cream is 2.47, which is why orange is never text.

### 2.2 Neutrals and surfaces

Light mode is the default: a Warm Cream page with white panels. Dark is an explicit choice (account menu or Appearance settings), remembered per browser. Dark mode is one solid-black neutral family (Design System 0.12.0): no green or teal tint, with teal, Citron and orange as accents.

| Token (`--yy-…`) | Utility | Light | Dark | Use |
|---|---|---|---|---|
| `bg-canvas` | `bg-canvas` | `#FFF4E8` | `#000000` | Page background |
| `bg-panel` | `bg-panel` | `#FFFFFF` | `#141414` | Cards, panels, inputs, dialogs, menus |
| `bg-surface` | `bg-surface` | `#F6ECE0` | `#0B0B0B` | Recessed areas, table headers, disabled fills |
| `bg-subtle` | `bg-subtle` | `#EFE6DB` | `#1C1C1C` | Hover on cards and rows |
| `bg-muted` | `bg-muted` | `#EFE6DB` | `#1C1C1C` | Hover on controls, neutral fills |
| `bg-emphasis` | `bg-emphasis` | `#D5D0C6` | `#2C2C2C` | Pressed controls, selected neutral fills |
| `bg-track` | `bg-track` | `#D5D0C6` | `#2C2C2C` | Progress-bar tracks |
| `border` | `border-line` | `#D5D0C6` | `#2C2C2C` | Hairlines on cards and dividers |
| `border-strong` | `border-line-strong` | `#828A83` | `#787878` | Form-control outline (≥3:1) |
| `text` | `text-ink` | `#142C2A` | `#FFF4E8` | Primary text |
| `text-secondary` | `text-ink-secondary` | `#142C2A` | `#FFF4E8` | Body copy under headings |
| `text-muted` | `text-ink-muted` | `#5B6863` | `#ACACAC` | Meta, captions, helper text, placeholders |
| `text-disabled` | `text-ink-disabled` | `#828A83` | `#787878` | Disabled labels only (WCAG-exempt) |

### 2.3 Actions, emphasis and chrome

| Token | Utility | Light | Dark | Use |
|---|---|---|---|---|
| `primary` / `-hover` / `-active` | `bg-primary` … | `#006E63` / `#02675D` / `#046158` | same | Space Works' own primary action |
| `on-primary` | `text-on-primary` | `#FFF4E8` | `#FFF4E8` | Label on teal (5.68) |
| `inverse-surface` | `bg-inverse` | `#142C2A` | `#142C2A` | Toasts, tooltips, code blocks, sticky bars |
| `on-inverse` | `text-on-inverse` | `#FFF4E8` | `#FFF4E8` | |
| `highlight` / `-hover` | `bg-highlight` | `#FF7447` / `#FF8157` | same | The one bold public moment (never an app button) |
| `on-highlight` | `text-on-highlight` | `#142C2A` | `#142C2A` | Ink on orange (5.51) |
| `highlight-soft` | `bg-highlight-soft` | `#FFEEE9` | `#221A17` | Warm tinted panels |
| `sidebar` | `bg-sidebar` | `#DFFF8F` | `#0B0B0B` | Workspace sidebar field |
| `sidebar-hover` | `bg-sidebar-hover` | `#F2FFD2` | `#1C1C1C` | Sidebar item hover |
| `sidebar-active` | `bg-sidebar-active` | `#006E63` | `#006E63` | Current sidebar item |
| `on-sidebar-active` | `text-on-sidebar-active` | `#FFF4E8` | `#FFF4E8` | |
| `focus` | (ring) | `#006E63` | `#DFFF8F` | Focus ring |

Legacy names keep working and now point at brand colours: `brand-marigold*` → Workshop Orange,
`brand-dot-base` → ink/cream, `brand-dot-off` → line, `highlight-peach` → Citron (light) / `#221A17`
(dark, used for selection and the `.yy-highlight` marker), `tint-peach` → `highlight-soft`.

### 2.4 Status

Status always pairs colour with a **word** (mandatory) and optionally an icon. Light mode uses the
brand's solid pastels with ink words; dark mode uses soft fills with the brand colour as the word.

| Status | `*-bg` (L / D) | `*-fg` (L / D) | `*-solid` (L / D) | Used for |
|---|---|---|---|---|
| Success (Citron) | `#DFFF8F` / `#20221B` | `#142C2A` / `#E9FCAA` | `#536D49` / `#E9FCAA` | Going, Published, Checked in |
| Warning (Warm Yellow) | `#FFD447` / `#222017` | `#142C2A` / `#FFDE77` | `#696834` / `#FFDE77` | Waitlist, Pending approval, Draft reminders |
| Info (Sky Blue) | `#B5CDFF` / `#1E1F22` | `#142C2A` / `#CBD9F8` | `#51697B` / `#CBD9F8` | Completed, waitlisted, neutral notices |
| Danger (reds) | `#FFFFFF` / `#141414` | `#B91C1C` / `#FCA5A5` | `#B91C1C` / `#FCA5A5` | Delete, errors, overdue |
| Danger border | `#FCA5A5` / `#7C6261` | | | Danger-zone card outline |
| Danger hover / on-danger | `#991B1B` / `#FDB9B6` · `#FFF4E8` / `#142C2A` | | | Solid danger button |

`*-solid` is for dots, bars and icons that must stand out on the page (≥3:1 on canvas). It is a dark
brand-mix in light mode and the brand fill in dark mode, so put text on a solid fill only with the
matching label: `text-on-success`, `text-on-warning`, `text-on-info`, `text-on-danger` (cream in light,
Deep Ink in dark). Never `text-white` on a status solid.
Internal attention counters use `bg-accent-soft text-accent-text`. Orange emphasis is reserved for public surfaces.

### 2.5 Chart series

Charts never reuse UI fills. Series colours come from the Design System `chart` tokens (`--sw-chart-*` in
`palette.css`, utilities `fill-/stroke-/bg-/text-chart-*`), in this order:

| Series | Utility | Light | Dark |
|---|---|---|---|
| Accent | `chart-accent` | `#006E63` | `#80B1A6` |
| Info | `chart-info` | `#51697B` | `#B5CDFF` |
| Success | `chart-success` | `#536D49` | `#DFFF8F` |
| Warn | `chart-warn` | `#696834` | `#FFD447` |
| Danger | `chart-danger` | `#B91C1C` | `#FCA5A5` |

Light uses the darker ink shades, dark the brighter fills (teal marks are too dim on the black panel). A
single-series chart uses `chart-accent`. A multi-series chart picks each colour with `chartSeries(label)`
(`components/ui/chart-series.ts`), which hashes the series identity so a series keeps its colour when sorted or
filtered. Colour is never the only cue: a legend or data table names every series, and a second line series is
dashed (`8 4`; then `2 4`, `10 3 2 3`). Every series is at least 3:1 on the page, panel and surface in both modes
(`design-fidelity.test.ts`).

### 2.6 Typography

| Role | Family | Weights | Files |
|---|---|---|---|
| Display headings | **Gilroy** | 800 | `public/brand/fonts/Gilroy-ExtraBold.woff2` |
| Light display text | **Gilroy** | 300 | `Gilroy-Light.woff2` |
| Body, labels, controls, headings, titles, numbers, IDs | **Outfit** | 400–700 (variable) | `Outfit-Variable.woff2` |
| One short expressive accent | **Unbounded** | 500 (600 allowed) | `Unbounded-Variable.woff2` |
| Code, secrets, JSON | Outfit | 500 | `.code-text`, tabular figures and slashed zero |

Fonts come from the Design System `fonts/` folder (`npm run tokens:sync` copies them and their licences into
`public/brand/fonts/`) and are self-hosted with `@font-face` in `app/styles/global-theme.css` (privacy
invariant: no font CDNs). Licences are in `public/brand/fonts/LICENSES/`. Only the two free Gilroy weights
are licensed; the paid weights must not be re-added. `font-synthesis: none` is set on `body`: there is no
faux bold or italic.

- `font-sans` is Outfit. `font-display` is Gilroy: use it only with weight 800 (or 300), never 400–700.
- `font-accent` is Unbounded 500 with −0.01em tracking, Outfit as fallback: **one short phrase per layout**
  (auth brand panel, an empty-state hero). Never in app chrome, or alongside Patch.
- IDs, codes and counts use Outfit 500 with `tabular-nums`, not a monospace face.

Type scale (mobile → desktop from 640px):

| Class | Weight | Size / line | Tracking | Use |
|---|---|---|---|---|
| `text-display-xl` | Gilroy 800 | 44/48 → 72/76 | −0.02em | Landing hero |
| `text-display-l` | Gilroy 800 | 34/40 → 48/52 | −0.02em | Auth and setup headings |
| `text-display-m` | Gilroy 800 | 34/40 → 48/52 | −0.015em | Large content titles |
| `text-h1` | 600 | 26/32 → 32/38 | −0.01em | One page title per screen |
| `text-h2` | 600 | 20/28 | −0.005em | Section headings |
| `text-h3` | 600 | 20/28 | −0.005em | Card and dialog titles |
| `text-h4` | 600 | 20/28 | −0.005em | Card and panel titles |
| `text-title` | 600 | 16/24 | 0 | Card and list-row titles |
| `text-body-l` | 400 | 16/24 | 0 | Lead paragraphs |
| `text-body` | 400 | 16/24 | 0 | Default copy, inputs |
| `text-body-ui` | 400 | 14/20 | 0 | Dense app copy (lists, tables, chat) |
| `text-label` | 500 | 14/20 | 0 | Form labels, nav, meta |
| `text-caption` | 500 | 12/16 | 0.01em | Helper text, timestamps |
| `text-overline` | 600 | 12/16 UPPERCASE | 0.08em | Eyebrows ("VENUE") |
| `font-accent` | Unbounded 500 | inherit | −0.01em | One accent phrase |

Button labels are Outfit 600. Body copy max width ~640px.

### 2.7 Spacing

4px grid: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Page gutter 16 (mobile) / 24 / 32. Card padding 20
(24 on settings). Every control is 44px tall. Rows: 56 for lists, 48 for tables.

### 2.8 Radius

| Utility | px | Use |
|---|---|---|
| `rounded-sm` | 6 | Checkboxes, tiny controls |
| `rounded` | 8 | Inline elements |
| `rounded-md` / `rounded-control` | 10 | **Buttons**, inputs, selects, nav items, date block |
| `rounded-lg` | 12 | Menus, popovers, callouts, segmented track |
| `rounded-xl` | 16 | **Cards, panels, tables, dialogs** |
| `rounded-2xl` | 20 | Feature panels |
| `rounded-3xl` | 24 | Hero panels |
| `rounded-full` | 9999 | Status pills, filter chips, avatars, switches |

Prefer `rounded-md` over `rounded-control` inside `cn()`: `tailwind-merge` does not know the custom
`control` key, so a later `rounded-*` override would not replace it.

### 2.9 Elevation

**No shadows on cards.** Cards and panels use a 1px `border-line`.

| Token | Value | Use |
|---|---|---|
| `shadow-raised` | `none` | Legacy name for cards; now flat |
| `shadow-segment` | `0 0 0 1px var(--yy-border-strong)` | Segmented-control thumb and switch thumb outline |
| `shadow-float` | `0 2px 6px rgb(20 44 42 / .06), 0 12px 32px rgb(20 44 42 / .10)` | **Overlays only:** menus, popovers, dialogs, toasts, tooltips |

### 2.10 Motion

- Tokens come from the Design System (`app/styles/motion.css`): durations `--sw-dur-fast` 120ms (press, hover,
  exit), `--sw-dur-base` 180ms (overlays, indicators), `--sw-dur-slow` 240ms (route settle); curves
  `--sw-ease-standard`, `--sw-ease-enter` (arrivals), `--sw-ease-exit` (departures); distances
  `--sw-enter-y`, `--sw-pop-scale`, `--sw-pop-offset`, `--sw-slide-x`. `ease-yy` is an alias of
  `--sw-ease-standard`; Tailwind has `ease-standard`, `ease-enter` and `ease-exit`; use `duration-[var(--sw-dur-base)]` for durations.
- `.sw-kiosk` and `.sw-tv` zero the distances (fade only).
- **No translate, scale or shadow on hover.** Buttons change colour only; the exceptions are the press
  (`:active`) scale to `--sw-pop-scale` and the Space Works mark opening (below).
- Content is visible by default; scroll reveals only enhance.
- `prefers-reduced-motion: reduce` zeroes durations and distances (the tokens do it); looping loaders
  (the box loader, `sw-progress-bar`) stop and show a static state (the still, open logo).
- Vocabulary (`app/styles/motion-utilities.css`; every value is a token, never a literal):

| Interaction | Class / mechanism | Timing |
| --- | --- | --- |
| Dialog open / close | `sw-overlay` fade + `sw-dialog` pop from centre (`pop-in` / `pop-out`) | base in, fast out |
| Drawer (task, `presentation="drawer"`) | `sw-drawer` slide from right (`--sw-slide-x`); overlay fades | slow in, base out |
| Menu, popover, tooltip, select | `sw-pop`: pops from the trigger side (`data-side`, `--sw-pop-offset`) | base in, fast out |
| Toast | `sw-toast`: rises in, fades out on dismiss | base in, fast out |
| Cards and list rows on mount | `sw-rise-in` / `sw-row-in`, `--sw-i` stagger (first 6, 30ms apart); no stagger on re-render | slow |
| Drag overlay | `sw-lift` (scale + shadow), settles with the drop animation | fast / base |
| Empty states, loaded drawer content, skeleton frames | `sw-fade-in` / `sw-rise-in` | base / slow |
| Tabs | underline scales in from the centre | base |
| Buttons, checkbox, switch, radio | colour transitions; press scale; tick fades in | fast |
| Page, panel, Suspense loading | `LogoLoader` (`components/brand/LogoLoader.tsx`): the box opens, holds, folds shut and repeats, 72px, centred, with a status label | 4400ms loop, still when reduced |
| Busy button, row, field | `BoxSpinner` (20px, polite status) or `BoxArt` (decorative, beside text that already says "Saving"); `mono` in filled buttons follows the text colour. `Button loading` does this and sets `aria-busy` | same loop |
| Skeleton layouts | `components/ui/skeletons.tsx`: static shapes (no shimmer) plus the box loader over the content block | same loop |
| Navigation | top `RouteProgress` bar after 150ms (segments without `loading.tsx`) | looping, static when reduced |
| Space Works mark | `LogoBoxOverlay`, built into `SpaceWorksLogo`: on pointer hover (never touch) or keyboard focus-visible of the mark or its link the box folds shut and opens back once; the master image hides the symbol column meanwhile, so nothing shifts. Tenant logos never animate; the app-icon tile stays still | 2200ms once (fold 600 + open 1600), never when reduced |

- Entrance animations use fill-mode `backwards` so they never pin a `transform` (drag-and-drop writes
  its own); exits use `forwards`. Radix keeps content mounted while the `data-[state=closed]` animation runs.
- Every route segment that awaits data has a `loading.tsx` built from the shared skeletons
  (`PageSkeleton`, `ListSkeleton`, `CardsSkeleton`, `BoardSkeleton`, `DetailSkeleton`, `ChatSkeleton`).
- Colour-mode switch (Design System `motion/theme-reveal`): `components/providers.tsx` commits the mode through
  `lib/themeTransition.ts`; the new mode grows from the toggle as a soft-edged circle over 720ms
  (`cubic-bezier(0.45, 0, 0.2, 1)`, View Transitions, CSS in the generated `app/styles/theme-reveal.css`); without
  View Transitions every colour cross-fades for 420ms; reduced motion switches instantly; if the animation API
  throws the mode still changes. The `theme-color` meta follows the chosen mode (Warm Cream / black). This is a
  page-level moment, deliberately longer than the 240ms interaction ceiling, and never blocks input.
- Loader artwork: `app/styles/box-open.css` (generated) colours it from the `loader` tokens (`--sw-loader-under`,
  `-spark`, `-seam`) and shows the full-colour (`.lt`) or reversed (`.dk`) drawing for the current mode, dark band
  or OS fallback; `.g-dark` / `.g-light` force a ground for a mark on a surface that never changes.
- Restart-safe sequences: React runs effects twice in development. An imperative `animate()` sequence
  must check it is still the current run after each `await` (see `AGENTS.md`).

### 2.11 Breakpoints

`sm 640` · `md 960` · `lg 1200`. Mobile-first. Two-column layouts stack below `md`.

---

## 3. Logo, icons and imagery

### 3.1 Logo

Use the master artwork from SpaceWorks-Design `logo/` **unaltered** (no recolouring, stretching,
rotation, effects or re-typed wordmarks). Brand components live in `components/brand/`.

| Ground | Artwork |
|---|---|
| Warm Cream | Full colour (`lockup-*.svg`, `symbol.svg`) |
| White | One-colour Deep Ink (`*-one-colour-ink.svg`) |
| Deep Ink or Maker Teal (dark mode, dark bands) | Reversed cream (`*-reversed.svg`) |

- Clear space: ¼ of the symbol height on every side.
- Hover and keyboard focus open the box once (§2.10); every placement goes through `SpaceWorksLogo`.
- Minimum sizes: symbol ≥ 48px; primary lockup ≥ 180px wide. Favicon and app icon are the only
  exceptions (they use `app-icon.svg`, rasterised).
- Placements: workspace sidebar stacked lockup at 180px; mobile top bar symbol at 48px with 12px clear space; auth brand panel stacked lockup 240–320px; social card cream
  1200×630 with the stacked lockup 600px wide.
- Copy: the product is **"Space Works Workspace"**, the community **"Space Works"**. "SpaceWorks"
  (no space) is for code identifiers, URLs and repo names only.

### 3.2 Icons

`lucide-react` (24px grid, 2px stroke, round caps), rendered at 16/20px. Decorative icons get
`aria-hidden`; icon-only buttons need `IconButton` with a required `label`. The approved icons are Search, Archive, Cpu, MapPin, Plus, ArrowLeft, ArrowUpRight, ChevronsUpDown, Info, TriangleAlert, CircleCheck, Ellipsis, Sun, Moon, LogOut, Inbox (the notifications link beside the workspace switcher), Bell (the top-bar notifications peek), and the task-type glyphs Bug, Sparkles, FileText, Wrench, Flag and Lightbulb (used only by `components/tasks/typeIcons.ts`; the Task type uses CircleCheck and Risk uses TriangleAlert). Formatting, close and visibility controls use short text labels. **The workspace sidebar is
text-only** apart from the Inbox icon. Use icons only where they help: search, add, back, external link, switchers, callouts,
overflow, theme toggle, sign out.

### 3.3 Imagery

- No emoji in UI.
- Project covers: 2:1, private files served through `/api/files/[id]`. With none, show
  a flat token fill. Never a broken image.
- Avatars: photo, else 1–2 initials (Outfit 600) on a tint. `AvatarImage` swaps to initials on error.
- Workspace mark: square; fallback is initials on teal.
- QR codes always sit on a white plate, in both modes.

---

## 4. Components (`components/ui/*`)

All primitives are Radix + Tailwind. Their props and exports are stable; prefer them over one-off markup.

### 4.1 Button

`rounded-md` (10px), Outfit 600, `min-h-11` for every size (`lg` is 48px). No hover lift, scale or
shadow; colour changes only. Focus uses the global 2px ring with a 2px offset.

| Variant | Rest | Hover | When |
|---|---|---|---|
| `primary` | `bg-primary text-on-primary` | `bg-primary-hover` | One per view: Save, Create, Sign in |
| `accent` | `bg-accent text-on-accent` | accent mixed 12 % toward Deep Ink | Same as primary (teal); kept for parity with Space Works Events |
| `secondary` / `neutral` | `bg-panel border-line text-ink` | `bg-muted` | Second action: Cancel, Share |
| `ghost` | `text-accent-text` | `bg-accent-soft` | Low-emphasis action in teal |
| `quiet` | `text-ink-secondary`, underline on hover | | Tertiary: Back, Undo |
| `highlight` | `bg-highlight text-on-highlight` | `bg-highlight-hover` | Reserved for external public surfaces. **Never in app chrome** |
| `danger` / `dangerOutline` | `bg-panel border-danger-fg text-danger-fg` | `bg-muted`, darker red | Opens a confirmation: Remove member… |
| `dangerSolid` | `bg-danger-solid text-on-danger` | `bg-danger-hover` | The final destructive confirm (used by `ConfirmDialog`) |
| `dangerQuiet` | `text-danger-fg` | underline | Revoke, Turn off station |
| `inverse` | `bg-on-inverse text-inverse` | `bg-subtle` | On dark bands |

**Disabled** is explicit, never opacity: `bg-surface text-ink-muted border-line`. Loading swaps in the
mono box loader beside the loading label and sets `aria-busy`. Destructive actions are never `primary`; triggers end with "…" and open
a dialog.

### 4.2 Text input / textarea / select

- Label above (`text-label`), never floating. Optional fields say "Optional" in muted text.
- Field (`controlClasses`): `bg-panel`, 1px `border-line-strong` (3:1), `rounded-md`, 44px tall, 16px text.
  Hover `border-ink`; focus `border-accent` + 2px focus ring; invalid (`aria-invalid`) `border-danger-fg`
  with a danger helper line and icon; disabled and read-only `bg-surface` + `border-line`.
- Placeholders use `text-ink-muted` (readable, not disabled grey).
- Prefix fields join a `bg-surface` segment to the input. Search has a leading icon and a clear button.
- Dropdowns never use the browser picker: `Dropdown` (`components/ui/select.tsx`) keeps a hidden native
  `<select>` for forms and renders a panel listbox with `shadow-float`.

### 4.3 Choice controls

- **Checkbox / radio:** 20px, `bg-panel`, outline border; checked = teal fill (checkbox) or teal dot.
- **Checkbox card / radio card:** `bg-panel`, 1px line; checked = 1.5px teal (or accent) border.
- **Switch:** outline-grey track, teal when on; white panel thumb with a 1px outline ring.
- **Segmented control:** `bg-surface` track with a hairline and 4px padding; selected segment
  `bg-panel` + outline ring, `rounded-md`.
- **Filter chip:** fully round; selected = teal fill with cream text; `aria-pressed`.

### 4.4 Tabs & navigation

- Underline tabs: rest `text-ink-muted`, hover `text-ink`, active `text-ink` + **2px underline** (teal). Rows scroll sideways with faded arrow hints.
- Workspace sidebar: Citron field (256px) (`bg-sidebar`), text-only items 44px tall in labelled groups, in order: Home (unlabelled; Home, My tasks, Calendar, Notepad, Search, Reports & analytics), Work, Chat, Knowledge, Community, People, Operations, Support & IT, Outreach, Finance, Settings, Preferences. Operations, Support & IT, Outreach, Finance, Settings and Preferences are collapsible (a button with `aria-expanded`, `▸` chevron that rotates), collapsed by default, auto-opened when the current page is inside, with the choice remembered per group in `localStorage` (applied after hydration). Notifications live in the Inbox icon link, not the list. Hover `bg-sidebar-hover`,
  current item `bg-sidebar-active text-on-sidebar-active font-semibold` with `aria-current="page"`.
  Dark mode uses the Deep Ink sidebar.
- Back link: `← Back to workspace`, quiet, 14px 600.

### 4.5 Status pills (`Chip`)

Fully round, 24px tall (`min-h-6`), 12–13px Outfit 600, padding 8–10. **The word is mandatory**; the
icon is optional. Tones: `success`, `warning`, `info` (solid pastel + ink in light, soft + brand word in
dark), `danger` (panel + `danger-border` + red word), `accent` (accent-soft + accent text), `highlight`
(orange + ink; for "2 left"-style attention), `neutral` (surface + hairline + ink), `ink` (inverse),
`outline`.

Common words: Active / Suspended (members), Pending / Accepted / Expired / Revoked (invitations),
To do / In progress / Review / Done (board columns), Urgent / High / Medium / Low (priority).

### 4.6 Date block

50–68px wide, `rounded-md`, 1px line, `bg-panel`. Top band: month, 11–12px 600, 0.08em tracking, on the
teal or `bg-emphasis` (draft). Bottom: day in Outfit 600 `tabular-nums`, 20–30px.

### 4.7 Cards

- **Base card** (`Card`): `bg-panel`, 1px `border-line`, `rounded-xl` (16px), padding 16–24, **no shadow**.
  Clickable cards are one `<a>` with hover `bg-subtle`.
- **Stat tile:** label (14px muted) over a Outfit 600 `tabular-nums` number (32px); optional progress
  bar; the "attention" variant colours the number and keeps the card flat.
- **Callout:** tinted status fill (`warning`, `info`, `success`, `danger`), icon, bold first sentence,
  one action. One per page. No translucent text.
- **Empty state:** panel card, centred, says what to do next ("No projects yet. Start one for the next
  build night."). One short line plus one action; Patch through `patch` on the main page empty state. Embedded panels stay quiet. Patch is still by default; its sneeze animation is reserved for collective success.
- **Danger zone:** `bg-panel` card with a 1px `border-danger-border`, title in `text-danger-fg`, a
  `danger` (outline) trigger that opens a `dangerSolid` confirmation.

### 4.8 Lists & tables

- `Table`: `rounded-lg` (12px) panel with a 1px line; header row on `bg-surface`, 14px Outfit 600 sentence case
  in `text-accent-text`; **rows 48px** with 1px `border-line` separators; hover `bg-subtle`; scrolls
  inside its own box on small screens.
- Person cell = avatar + name + email (never repeat the email).
- Timestamps: relative for < 7 days ("2 min ago"), else "13 Oct 2026".

### 4.13 App shell (workspace)

`components/chrome/AppShell.tsx`: Citron text-only sidebar (§4.4) driven by `lib/nav.ts`, the
workspace lockup with the notifications bell beside it, the workspace switcher, grouped navigation, and
the account menu at the bottom (Account settings, Instance admin for the operator, Light/Dark mode,
Sign out). Below `md` the sidebar becomes a sheet behind a top bar. Content max width 1200px. Page title pattern: optional kicker (muted) + `h1` +
one-line description. Settings pages: label column / field column rows separated by hairlines.
Instance admin pages (`SimpleShell` + underline tabs) stay restrained: panel cards, metric rows, small charts, capped tables, no accents.

### 4.15 Dialogs, toasts, menus

- Dialog: `bg-panel`, `rounded-xl`, 1px line, `shadow-float`, max 480px; title (`text-h3`) + body +
  actions right-aligned (secondary, then primary/`dangerSolid`). Overlay Deep Ink at 48 %.
- Toast: `bg-inverse text-on-inverse`, `shadow-float`, 4s, optional Undo.
- Menu / popover: `bg-panel`, `rounded-lg`, 1px line, `shadow-float`; items 40px, highlighted `bg-muted`,
  danger items last in `text-danger-fg`. Tooltip: `bg-inverse`, 13px.

### 4.16 Collapsible groups

One primitive, `components/ui/collapsible-section.tsx` (`CollapseToggle`, `CollapsibleSection`, `useOpenState`, `usePersistentOpen`; pure parts in `lib/collapse.ts`). The toggle is a button with `aria-expanded` and `aria-controls` and a text "▸" chevron that rotates 90deg using `--sw-dur-fast` / `--sw-ease-standard` (instant with reduced motion); no icons.

- Used by: sidebar groups, List view groups, My Tasks due buckets and Board columns.
- Defaults: sidebar Work, Chat, Knowledge, Community and People open; Operations, Support & IT, Outreach, Finance, Settings and Preferences closed (`collapsedByDefault` in `lib/nav.ts`); the unlabelled Home group never collapses and the group holding the current page is always open. My Tasks: "No due date" closed, other buckets open. List groups and Board columns open.
- Persistence: per key in `localStorage` (`sw:nav-open`, `sw:collapse:my-tasks`, `sw:collapse:list` by project, group-by and group, `sw:collapse:board` by column id). The server and first client render use the default, so there is no hydration mismatch; blocked storage keeps the choice for the page view.
- A collapsed List group shows its count and its rows cannot be selected (collapsing deselects them). A collapsed Board column is a narrow strip with the name and count that stays a drop target (a dropped card goes to the end).

## 5. Page patterns

- **Workspace home:** greeting (`Hello, Meera.`) with the tagline, a 4-up stat row (my open tasks,
  members, upcoming meetings and shifts, the kitty when visible), then two columns of panels: My tasks,
  Announcements, Upcoming, Recent activity. Each panel tolerates empty data with a one-line empty state.
- **List → board → detail (projects):** list of cards, kanban board with columns from the project's
  `BoardColumn`s, task detail in a side panel or page with comments and activity.
- **Chat:** channel list left, messages centre, thread on the right on wide screens; composer pinned
  to the bottom; realtime through `useRealtime`.
- **Settings:** `PageHeader` + underline tabs (General, Members, Invitations, Labels, API tokens,
  Integrations, Audit log); settings rows (label column / field column) in one card; tables in bordered
  cards.
- **Account:** `SimpleShell`, one card of settings rows: Profile, Password, Two-step verification,
  Appearance, Sessions, Your data, Workspaces.
- **Auth pages:** `AuthFrame` split layout: form left, calm brand panel right with Patch as the single bold moment.

---

## 6. Content & voice

- Clear, warm, specific. Second person. Sentence case everywhere (buttons, headings, tabs).
- Name the action: "Send invitation", "Save changes", "Start a project" — not "Submit" or "OK".
- Empty states name the next step. Errors say what happened and how to fix it, without blame:
  "Couldn't save. Try again." **Banned:** "Oops", "Something went wrong".
- Community words: members, the crew, projects, shifts, the kitty (shared funds). Keep it
  calm: this is a tool people use daily.
- Never show raw internals: no cron strings without a plain-language reading, no secret URLs, no
  seconds, no `10/14/2026`.
- en-GB spelling.
- Dates and times go through one formatter in the workspace time zone (`Wed 14 Oct`, `9:30 AM – 5:30 PM IST`,
  `Today / Tomorrow / In 9 days`). Show the timezone once per section. No countdown timers in lists.

---

## 7. Accessibility checklist

- Every text/background token pair is ≥ 4.5:1 (checked for light and dark when tokens change).
  `text-ink-muted` is the lightest readable text. Form-control outlines and focus rings are ≥ 3:1.
- No translucent text (`text-*/75` is banned); use a solid token.
- Status never by colour alone (word required, icon optional).
- Every input has a `<label>`; errors linked with `aria-describedby`.
- Real `<button>` / `<a href>`; tabs `role="tab"` + `aria-selected`; toggles `aria-pressed`; nav
  `aria-current`.
- Visible focus ring everywhere: 2px, offset 2px, teal (light) / Citron (dark).
- Touch targets ≥ 44px.
- Works at 360px with no horizontal page scroll.
- `prefers-reduced-motion` respected; `prefers-color-scheme` sets the default theme, with a Light/Dark
  toggle stored in the `sww.color-mode` cookie and `sww:color-mode` local storage.

---

## 8. Dark mode

- One solid-black neutral family (Design System 0.12.0, decision 316): `#000` page, layers stepping up to
  `#0B0B0B`, `#141414`, `#1C1C1C`, cream text, no green or teal tint in any surface. Teal, Citron and orange are
  accents only; teal text and marks use the lifted `accent-ink` (`#80B1A6`). Browser chrome is black.
- Primary stays Maker Teal with cream labels. Focus becomes Citron.
- Status pills switch from solid pastels to soft fills with the brand colour as the word.
- Overlays use the black scrim and shadow; rely on hairlines and panel steps for structure.
- Charts switch to the brighter dark series (§2.5); the box loader shows the reversed artwork.
- QR codes (MFA setup) stay on a light plate.
- The mode is `data-color-mode` on `<html>` (set from the cookie on the server, so there is no flash),
  or follows the system when unset. `.yy-dark-band` forces dark tokens on one band.

---

## 9. Implementing in this codebase

Stack: Next.js 16 App Router, React 19, TypeScript, **Tailwind 4**, **Radix UI**, **lucide-react**. Fonts are self-hosted (§2.6). Keep Server Components by default and never weaken the
security invariants (CSP nonce, tenant isolation). Don't add external scripts, fonts or image hosts.

### 9.1 One source of truth for tokens

1. `app/styles/palette.css` is generated by `npm run tokens:sync` from the Design System submodule (never edit it by hand) and pins every canonical sRGB triplet (including `scrim`, which feeds `--yy-overlay`) (with a `--sw-color-*` prefix to avoid Tailwind collisions). `app/styles/tokens.css` adapts them to the stable `--yy-*` names. It declares every token as `--yy-*` (plus raw `--sw-*` brand colours). Light
   values go under `:root`. Dark values go under `:root[data-color-mode="dark"], .yy-dark-band` **and**
   the `@media (prefers-color-scheme: dark) { :root:not([data-color-mode]) }` mirror. Keep all three in
   sync.
2. `app/globals.css` maps them in `@theme inline` (`--color-canvas: var(--yy-bg-canvas)`, …), defines
   fonts, radii, the type scale (`text-display-*`, `text-h*`, `text-body*`, `text-label`, `text-caption`,
   `text-overline`) and `.font-accent`.
3. Utility names other code relies on: `canvas panel surface subtle muted emphasis track line
   line-strong ink ink-secondary ink-muted ink-disabled primary primary-hover primary-active on-primary
   inverse on-inverse highlight highlight-hover on-highlight highlight-soft sidebar sidebar-hover
   sidebar-active on-sidebar-active success-bg/fg/solid warning-bg/fg/solid info-bg/fg/solid
   danger-bg/fg/solid/border danger-hover on-danger on-success on-warning on-info accent accent-soft
   on-accent accent-text
   sw-ink sw-teal sw-orange sw-citron sw-sky sw-yellow sw-cream`, shadows `shadow-raised shadow-float
   shadow-segment`, radius `rounded-control`, fonts `font-sans font-display font-accent
   code-text`.
4. UI primitives live in `components/ui/*`; brand components in `components/brand/*`.

### 9.3 Do / Don't

**Do:** use tokens; one primary action per view; label fields above; test light + dark + 360px.

**Don't:** shadows on cards; hover lifts; `opacity-50` for disabled buttons; orange text; translucent
text; `text-white` on a status fill; black; gradient text or buttons; Unbounded in app chrome or
more than once per layout; icons in the sidebar; recoloured or re-typed logos; cards in cards in cards;
emoji in chrome; the orange button in the app; colour-only status.

---

*Version 1.1 · 13 Nov 2026 · Space Works Workspace. Brand values from SpaceWorks-Labs/SpaceWorks-Design-System 0.12.0.*


## 10. Fidelity checks and source priority

The refreshed `tokens/tokens.css` and `tokens.json` values win over the older A.1 table in the UI brand spec. The pinned values live in `tests/fixtures/design-tokens.json`; `tests/unit/design-fidelity.test.ts` checks both modes, the OS fallback, contrast, master logo sizing, the approved icon set and source restrictions across every area. No component has literal paint colours.

Dark selected teal fills retain the canonical colour and add a readable boundary where needed. Status chart solids use `*-ink` values in light mode; their matching labels are cream. This is distinct from the pastel status pills, which carry Deep Ink words.

Shared page geometry is in `components/ui/layouts.tsx`: dashboard (260px activity rail), list, detail (280px aside), settings and form (300px preview). AuthFrame also provides the centred task card. These components accept already-authorised content; loaders and tenant checks remain in pages.

Patch is the main page state's one bold moment. Keep nested empty panels plain. Use the original adaptive assets, a quarter-height clear space, and the reduced-motion still. Closed polls with quorum use `pose="sneeze"`; other idle states stay still.

See [design-audit.md](design-audit.md) for rule and area coverage, verification results and open owner items. Browser verification is intentionally excluded from this pass.
