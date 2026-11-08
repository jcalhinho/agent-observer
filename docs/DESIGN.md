# Design rules

Agent Observer is an instrument panel: it should answer "who needs me?" in a second and then stay
out of the way. Dark by default, a light grey theme on demand, hairline rules, small-caps labels,
tabular mono numbers. These rules keep the interface coherent; follow them when you add or change
something.

## Structure

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ top bar: logo · collector │ working · need you · today's spend │ ☀ ⟲ ⚙ ⤡          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ alerts: subscription limit · daily budget · collisions                          │
│ totals strip: tokens · cache · cost · saved by cache · tool calls                │
│ filter: All / Active / Need you                                                  │
│ ┌─ bar ─────────────────────────────────────────────────────────────────────┐   │
│ │ who · state · what it does        tokens cache cost context tools  ▂▃▅    │   │
│ │ limits · model · turn · git · pace · collisions · top tools               │   │
│ └───────────────────────────────────────────────────────────────────────────┘   │
│   … one bar per agent, the most urgent first                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ status bar: cache · fullest context · tokens/min · nearest limit │ sessions · today│
└──────────────────────────────────────────────────────────────────────────────────┘
   sheets slide in from the right: agent detail, history, settings
```

- **One screen** (`App.tsx`). Everything that answers "who needs me now" is on it without a click.
- **Bars** (`AgentBar.tsx`), one per agent, stacked in a column and sorted by urgency. The first line
  is identity, state and current action, then the same figures for every agent so they line up. The
  second line is context: limits, model, git, pace, collisions, tools.
- **Sheets** slide in from the right and close with `Esc`: the agent detail (`AgentDetail.tsx`),
  the history (`History.tsx`), the settings (`SettingsPanel.tsx`).
- **Shrink to a column** (`miniWindow.ts`): the same bars in a narrow window in the corner of the
  screen, optionally on top. Bars adapt to their own width with container queries, not to the window.

## Principles

1. **One screen, one answer.** The bars answer "who needs me" without opening anything. Sheets are
   for going deeper, never for the essentials.
2. **Say less, say it where it is needed.** A bar never carries a paragraph; explanations are
   tooltips. In the detail, every figure of the overview has its definition right under it.
3. **Status is a colour and a word, never colour alone.** An agent that needs you tints its bar edge
   and says *Waiting for you*, *Going in circles*… Alerts are the only banners.
4. **Never invent a value.** A number the agent does not report is "—" or "not reported";
   estimates say so ("≈", "≥", "estimated"). Subscription limits are the agent's own figures, and a
   window that reset since the last reading shows as reset.
5. **Both languages, always.** Every string is `t("français", "English")` where it is used
   (`src/ui/i18n.ts`); numbers go through `locale()`.
6. **Nothing leaves the machine.** No telemetry, no network request of the app's own.

## Layout rules

- **No scrolling navigation.** The top bar, filters and chips wrap or truncate; they never show a
  scrollbar.
- **Container queries over media queries** inside a bar (`container-type: inline-size` on
  `.card-bar`): wide (one row of figures), medium (figures on a second row), narrow (everything
  stacked, for the column mode).
- **The bar edge** is a 2 px gradient border drawn with two backgrounds (`padding-box` fill,
  `border-box` gradient) in the agent colour, orange (`--loop`) when it goes in circles, red
  (`--bad`) when it is blocked.

## Tokens

At the top of `src/ui/styles.css`; the light theme redefines them under `:root[data-theme="light"]`.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--void`, `--bg`, `--surface`, `--surface-2`, `--surface-3` | `#05070a` → `#18212e` | `#c9cfd7` → `#cbd1d9` | outside, page, panels, raised, hover. **No white background in the light theme.** |
| `--border`, `--border-strong` | `#19212d`, `#2a3647` | `#c0c7d0`, `#a6afbb` | 1 px rules |
| `--text`, `--text-2`, `--muted`, `--faint` | `#eaf0f7` → `#4f5c70` | `#18212d` → `#7d8999` | primary, secondary, labels, hints |
| `--signal`, `--on-signal` | `#f6f9fd` on `#0a0e14` | `#1b2431` on `#e6e9ee` | primary button, selected segment |
| `--good`, `--warn`, `--bad`, `--loop`, `--accent` | status colours | darker variants | always with a word or an icon |
| `--ov` | `255 255 255` | `24 33 45` | translucent overlays: `rgb(var(--ov) / .06)` lightens in dark and darkens in light |
| agent colours | from `providers.ts` | same | validated for colour-blind separation; never reused for status |

Never hard-code a colour outside these tokens: a hard-coded white or black breaks one of the themes.

## Checklist for a UI change

- [ ] Works in both themes, at full width, at the minimum window width (1120 px) and in the column mode.
- [ ] Strings in both languages; numbers with `locale()`; no hard-coded colours outside tokens.
- [ ] Values the agent does not report stay "—"; estimates are marked.
- [ ] Screenshots in `docs/media/` refreshed (`?demo`); `CHANGELOG.md` updated.
