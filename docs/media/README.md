# Screenshots

Images used by the READMEs. Keep file names stable: the READMEs link to them.

| File | What it shows | Used in |
| --- | --- | --- |
| `demo.gif` | The demo in eight steps: the screen, *Need you*, *By project*, an agent's detail and earlier sessions, the history, the diagnostic. 960 px wide. | README hero |
| `screen.png` | The whole window: alerts, totals, one bar per agent with a mix of states, the status bar. | What you see |
| `card.png` | One agent bar, close up: state, activity, figures, limits, git, tools. | What you see |
| `detail.png` | The detail panel of one agent: limits, git, session overview. | What you see |

Guidelines:

- Take them from the demo (`npm run dev` in `apps/desktop`, then `http://127.0.0.1:1420/?demo`), never from
  your own sessions: no real names, private paths, prompts or keys on screen.
- Still images: 1440 × 940, English interface; optimise with `oxipng` or `pngquant`.
- `demo.gif`: one 1280 × 800 screenshot per step, then `ffmpeg` (concat with a duration per frame,
  `palettegen` and `paletteuse` at 960 px). Keep it under 1 MB.
- Regenerate every image when the design changes: they are part of the documentation.
