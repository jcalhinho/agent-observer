# Design rules

Agent Observer is a glance tool: it should answer "who needs me?" in a second and then get out
of the way. The interface is dark, flat and dense. These rules keep it that way; follow them
when you add or change a screen.

## Principles

1. **One screen, one answer.** The overview must show the agent cards, the race and the start of
   the analytics on a laptop display without scrolling past the first fold.
2. **Say less, say it where it is needed.** A section title takes one line. Its explanation sits
   in the "i" next to the title (`SectionHeader` does this); a card never carries a paragraph.
3. **Status is a colour, not a banner.** An agent that needs you changes the 2 px left edge of its
   card and a faint tint. Alerts (loops, errors) are the only red banners.
4. **Never invent a value.** A number the agent does not report is shown as "—" or "not
   reported"; estimates say so ("≈", "estimated").
5. **Both languages, always.** Every string is written with `t("français", "English")` where it
   is used (see `src/ui/i18n.ts`).

## Layout rules

- **No scrolling navigation.** Tabs, filter chips and toolbars wrap onto another line; they never
  show a scrollbar.
- **Sticky headers inside scrolling areas.** Any area that scrolls on its own keeps its title row
  visible: tables (`thead th`), the event feed and timeline (`.event-head`), lists (`.list-head`),
  chart cards (`h3`), help sections.
- The page itself scrolls; sections are resizable (`Resizable`) and remember their height. When
  you change a default height, give the section a new `id` so the new default applies.
- Width: content is capped at 1500 px. Below 980 px the header wraps and grids become one column.

## Tokens

Defined at the top of `src/ui/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg`, `--surface`, `--surface-2`, `--surface-3` | dark greys | page, cards, controls, hover |
| `--border`, `--border-strong` | hairlines | 1 px borders; never thicker than 2 px |
| `--space-1…6` | 3, 6, 10, 14, 18, 22 px | all gaps and paddings |
| `--radius`, `--radius-sm` | 8, 6 px | cards, controls |
| base font | 13 px / 1.45 | headings 14 px, small text 11–12.5 px |
| agent colours | from `providers.ts` | validated for colour-blind separation; never reuse them for status |
| `--good`, `--warn`, `--bad`, `--loop`, `--accent` | status colours | always paired with a text label or an icon |

## Components

- **Agent card** (`AgentCard.tsx`): identity line, current action line, numbers line, activity
  strip. The whole card is clickable ("go to the agent"); explanations are `title` tooltips.
- **Section header** (`Explain.tsx`): title + truncated description + actions, all on one line.
- **Chips and segmented controls**: 12 px text, 1 px border, no fill unless selected.

## Checklist for a UI change

- [ ] Fits at 1440 px and wraps cleanly at 760 px; no horizontal scrollbar on the page.
- [ ] Any scrolling area has a sticky header.
- [ ] Strings in both languages; numbers formatted with `locale()`.
- [ ] Screenshot added or refreshed in `docs/media/`; `CHANGELOG.md` updated.
