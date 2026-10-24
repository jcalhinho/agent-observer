# Design rules

Agent Observer is an instrument panel: it should answer "who needs me?" in a second and then stay
out of the way. The look is called **flight deck**: near-black panels, hairline rules, square
corners, small-caps labels, tabular mono numbers. The race stays the hero. These rules keep the
interface coherent; follow them when you add or change a screen.

## Structure

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ top bar:  AGENTS · REPOSITORIES │ STORY · ASK │ CONNECTORS · SETTINGS · HELP       │
├───────────────────────────────────────────────────────────────────────────────────┤
│ stage: bar (brand · working / need you · workspace · filter · 3D/2D · mini)        │
│        the race                                                  (at most 50 %)    │
│        dock: one chip per agent                                                    │
├─────────────────────────────── splitter ──────────────────────────────────────────┤
│ workbench: period bar (15 min · 1 h · 24 h · All │ ◀ date ▶)                       │
│            charts                         │ history (sessions of the period)       │
└───────────────────────────────────────────────────────────────────────────────────┘
   drawers slide over all of it: left (Agents, Repositories), right (Story, Ask), top (Connectors…)
```

- **One bar of tabs** (`Deck.tsx`), grouped by edge. A tab opens a **drawer** that slides in from the edge
  its small icon shows. Drawers float; **pin** one and the page makes room. `Esc` closes loose drawers; the
  inner edge resizes (arrow keys too). State lives in `shell.ts` and is remembered.
- **The stage** (`Stage.tsx`) is the race, with a bar and a dock. It never takes more than half of the
  window (`STAGE_MAX`); a splitter lets the user shrink it.
- **The workbench** (`Workbench.tsx`) is the other half: charts and history, side by side, for the period
  in the `PeriodBar`. Below 900 px of width a switch shows one at a time.
- A drawer's content is a **panel** (`.panel`): one column, a sticky bar or section title on top.
- Where a thing lives: *who and what now* → stage and dock; *what happened over a period* → workbench;
  *detail of one agent or repository, narrative, questions* → drawers; *setup* → top drawers.

## The race

The race is the hero and follows the same language: **no cube, no sharp edge**. Build with
capsules, spheres, arcs, rounded rectangles and tori; shade with `meshLambertMaterial` (no
shadow maps; round blob shadows under characters). Keep it cheap: instance anything repeated,
share geometry, avoid mipmaps on label textures, and leave the pixel budget and frame cap to the
`Governor` in `SprintTrack3D.tsx` (quality levels *light*, *auto*, *smooth*).

What the scene shows beyond movement (trail, hurdles, flags, cap colour, spotlight, celebrations, board,
sky) is computed in `raceInsights.ts` (pure, tested) and only drawn by `SprintTrack3D.tsx`. Repeated
pieces that change in number (hurdles, flags) are instanced with `useCounted`; per-frame code never
allocates. Probe WebGL once (`supportsWebGL` caches): each probe opens a context and the browser drops
the oldest past a handful.

## Principles

1. **One screen, one answer.** The stage and the dock answer "who needs me" without opening
   anything. Drawers are for going deeper, never for the essentials.
2. **Say less, say it where it is needed.** A section title is one line; its explanation sits in
   the "i" next to it (`SectionHeader`). A card never carries a paragraph; explanations are tooltips.
3. **Status is a colour and a word, never colour alone.** An agent that needs you tints its dock
   chip and card edge and says *Reply*, *Going in circles*… Alerts are the only red banners.
4. **Never invent a value.** A number the agent does not report is "—" or "not reported";
   estimates say so ("≈", "estimated"). The story is written from facts only.
5. **A period is chosen once.** The period bar drives the charts, the history and Ask, so they always
   describe the same thing; a day can be stepped through, and a past day is read from the database, not
   from live events.
6. **Both languages, always.** Every string is `t("français", "English")` where it is used
   (`src/ui/i18n.ts`). The prompt sent for the story is English, and asks for the UI language.
7. **Nothing leaves the machine unasked.** The story and Ask are the only features that can; they are
   opt-in per agent, show exactly what is sent, and never act on an agent for the user.

## Layout rules

- **No scrolling navigation.** The top bar, tab strips, bars and selects wrap or truncate; they never show
  a scrollbar.
- **Sticky headers inside scrolling areas.** A drawer scrolls under its tab strip and each workbench
  column scrolls under the period bar; inside them a
  panel keeps its bar (`.panel-bar`) or title (`.panel > .section-header:first-child`) in view,
  tables keep `thead`, feeds keep `.event-head`, chart cards keep their `h3`.
- **Container queries over media queries** for anything inside the stage or a drawer: they are
  squeezed by pinned drawers, not by the window (`@container stage`, `@container drawer`).
- Below 700 px the app switches to the mini layout.

## Tokens

At the top of `src/ui/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--void`, `--bg`, `--surface`, `--surface-2`, `--surface-3` | `#05070a` → `#18212e` | outside, stage, drawers, raised, hover |
| `--border`, `--border-strong` | `#19212d`, `#2a3647` | 1 px rules; never thicker than 2 px (status edges) |
| `--text`, `--text-2`, `--muted`, `--faint` | `#eaf0f7` → `#4f5c70` | primary, secondary, labels, hints |
| `--signal` | `#f6f9fd` | the only chrome accent: active tab, primary button, selected segment |
| `--good`, `--warn`, `--bad`, `--loop`, `--accent` | status colours | always with a word or an icon |
| agent colours | from `providers.ts` | validated for colour-blind separation; never reused for status |
| `--radius`, `--radius-sm` | 4, 3 px | everything is nearly square |
| `--space-1…6` | 3, 6, 10, 14, 18, 24 px | all gaps and paddings |
| type | 13 px / 1.45 body; labels 10.5 px, bold, uppercase, +.14em; numbers tabular mono | |

## Components

- **Top tab** (`.topbar-tab`): icon + small-caps label + optional badge (a count; amber = needs you,
  red = needs a look) + the edge its drawer comes from. Active: white label and a 2 px underline.
- **Drawer** (`.drawer`): tab strip (with pin and close) above a scrolling body. Slides 28 px and
  fades; honours `prefers-reduced-motion`.
- **Dock chip** (`.dock-chip`): agent colour on the left edge, name and state, one line of what it
  is doing, repository and age. The whole chip goes to the agent.
- **Agent card** (`AgentCard.tsx`): identity line, current action, numbers, activity strip.

## Checklist for a UI change

- [ ] Works with 0, 1 and 3 drawers open (pinned), and wraps cleanly at 800 px.
- [ ] Anything that scrolls on its own has a sticky header; no navigation scrolls.
- [ ] Strings in both languages; numbers with `locale()`; no hard-coded colours outside tokens.
- [ ] Screenshots in `docs/media/` refreshed; `CHANGELOG.md` updated.
