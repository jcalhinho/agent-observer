# Screenshots

Images used by the READMEs. Keep file names stable: the READMEs link to them.

| File | What it shows | Used in |
| --- | --- | --- |
| `screen.png` | The whole window: alerts, totals, one bar per agent with a mix of states, the status bar. | README hero |
| `card.png` | One agent bar, close up: state, activity, figures, limits, git, tools. | What you see |
| `detail.png` | The detail panel of one agent: limits, git, session overview. | What you see |

Guidelines:

- Take them from the demo (`npm run dev` in `apps/desktop`, then `http://127.0.0.1:1420/?demo`), never from
  your own sessions: no real names, private paths, prompts or keys on screen.
- 1440 × 940, English interface; optimise with `oxipng` or `pngquant`.
- Regenerate every image when the design changes: they are part of the documentation.
