import type { SessionEvent } from "./types";

/**
 * Des événements de démonstration, pour voir l'écran sans agent branché : ouvre l'app avec `?demo`
 * dans l'adresse. Rien n'est écrit sur le disque, rien ne vient d'un vrai agent.
 */
export const isDemo = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

type Extra = Partial<SessionEvent>;
const sourced = <T,>(value: T) => ({ value, origin: "provider" });

export function demoEvents(now = Date.now(), idPrefix = "demo"): SessionEvent[] {
  const events: SessionEvent[] = [];
  let counter = 0;
  const push = (provider: string, session: string, project: string, kind: string, secondsAgo: number, extra: Extra = {}) => {
    counter += 1;
    events.push({ event_id: `${idPrefix}-${provider}-${counter}`, session_id: session, occurred_at: new Date(now - secondsAgo * 1000).toISOString(), provider, kind, project_path: project, tool_name: null, file_path: null, ...extra });
  };

  type Spec = {
    provider: string; session: string; project: string; models: string[]; startedMinutesAgo: number; turns: number;
    /** [cache read share of the prompt, write share] ; null = this agent reports no cache. */
    cache: [number, number] | null; window?: number; baseContext: number; growth: number;
    tailCache?: number; tools: Array<[string, string | null, string | null]>; end: "working" | "waiting" | "blocked" | "looping" | "idle"; idleSeconds?: number; compactAt?: number;
  };

  function run(spec: Spec) {
    const { provider, session, project } = spec;
    const total = spec.startedMinutesAgo * 60;
    const endGap = spec.end === "idle" ? spec.idleSeconds ?? 3 * 3600 : spec.end === "waiting" ? 190 : spec.end === "working" ? 6 : 14;
    const span = total - endGap;
    let step = 0;
    push(provider, session, project, "session_started", total, { launch_mode: provider === "github_copilot" ? "vscode" : "cli" });
    for (let turn = 0; turn < spec.turns; turn += 1) {
      const turnStart = total - 20 - (span * turn) / spec.turns;
      const last = turn === spec.turns - 1;
      if (provider === "codex") push(provider, session, project, "checkpoint", turnStart + 1, { outcome: `turn-started:t${turn}` });
      push(provider, session, project, "user_message", turnStart, { content: ["Ajoute les métriques de cache", "Corrige le build Rust", "Refais l’interface", "Écris les tests", "Branche le lecteur de sessions", "Nettoie les imports"][turn % 6] });
      const calls = 3 + ((turn * 5) % 4);
      for (let call = 0; call < calls; call += 1) {
        const at = turnStart - 8 - call * ((span / spec.turns - 20) / (calls + 1));
        step += 1;
        const compacted = spec.compactAt !== undefined && step > spec.compactAt;
        const context = Math.round(spec.baseContext + spec.growth * (compacted ? step - spec.compactAt! : step));
        const model = spec.models[last && spec.models.length > 1 ? 1 : 0];
        const usage: Extra = {
          model: sourced(model),
          output_tokens: sourced(220 + ((step * 137) % 900)),
          duration_ms: sourced(1800 + ((step * 311) % 5000)),
          ...(spec.window ? { context_window: sourced(spec.window) } : {})
        };
        if (spec.cache) {
          const read = Math.round(context * spec.cache[0]);
          const write = step % 6 === 0 ? Math.round(context * spec.cache[1]) : 0;
          usage.cache_read_tokens = sourced(read);
          if (write) usage.cache_write_tokens = sourced(write);
          usage.input_tokens = sourced(Math.max(80, context - read - write));
        } else {
          usage.input_tokens = sourced(context);
        }
        push(provider, session, project, "model_usage", at, usage);
        const [tool, file, command] = spec.tools[(step + turn) % spec.tools.length];
        push(provider, session, project, "tool_started", at - 1, { tool_name: tool, file_path: file, command });
        push(provider, session, project, "tool_finished", at - 3, { tool_name: tool, file_path: file, command });
      }
      if (!last || spec.end === "waiting" || spec.end === "idle") push(provider, session, project, "checkpoint", turnStart - span / spec.turns + 22, { outcome: "turn-completed" });
    }
    // Une fin nette : l'état que la carte doit montrer.
    if (spec.end === "working") {
      const size = spec.baseContext + spec.growth * step;
      const read = spec.cache ? Math.round(size * (spec.tailCache ?? spec.cache[0])) : 0;
      push(provider, session, project, "model_usage", 14, { model: sourced(spec.models[spec.models.length - 1]), input_tokens: sourced(Math.max(80, size - read)), output_tokens: sourced(380), ...(spec.cache ? { cache_read_tokens: sourced(read) } : {}) });
      push(provider, session, project, "tool_started", 7, { tool_name: "Edit", file_path: `${project}/src/ui/App.tsx` });
      push(provider, session, project, "tool_finished", 3, { tool_name: "Edit", file_path: `${project}/src/ui/App.tsx` });
    }
    return step;
  }

  const AO = "/Users/demo/Projects/agent-observer";
  const files = ["src/ui/AgentBar.tsx", "src/ui/App.tsx", "src/ui/styles.css", "src-tauri/src/main.rs", "src/ui/insights.ts", "crates/session-events/src/lib.rs"];
  const edit = (index: number): [string, string, null] => ["Edit", `${AO}/apps/desktop/${files[index % files.length]}`, null];
  const read = (index: number): [string, string, null] => ["Read", `${AO}/apps/desktop/${files[index % files.length]}`, null];
  const bash = (command: string): [string, null, string] => ["Bash", null, command];

  run({ provider: "claude_code", session: "c1", project: AO, models: ["claude-sonnet-5-5"], startedMinutesAgo: 47, turns: 5, cache: [0.93, 0.04], baseContext: 24_000, growth: 3_800, tools: [read(0), edit(0), read(1), bash("npm run typecheck"), edit(2), ["Grep", null, null], edit(3), bash("cargo test")], end: "working" });
  run({ provider: "reasonix", session: "r1", project: "/Users/demo/Projects/billing", models: ["deepseek-v4-flash", "deepseek-v4-pro"], startedMinutesAgo: 62, turns: 6, cache: [0.995, 0], window: 128_000, baseContext: 14_000, growth: 1_900, tailCache: 0.12, tools: [read(2), edit(4), bash("cargo build"), edit(5), read(3)], end: "working" });
  run({ provider: "codex", session: "x1", project: "/Users/demo/Projects/api-server", models: ["gpt-5.6-terra"], startedMinutesAgo: 33, turns: 4, cache: [0.71, 0.0], window: 400_000, baseContext: 120_000, growth: 9_000, tools: [bash("cargo check"), edit(1), read(4), bash("rg parse")], end: "waiting" });
  run({ provider: "qwen_code", session: "q1", project: "/Users/demo/Projects/video-tool", models: ["qwen3.7-plus"], startedMinutesAgo: 18, turns: 2, cache: null, baseContext: 9_000, growth: 1_200, tools: [bash("npm test"), edit(0), bash("npm test"), edit(0)], end: "looping" });
  run({ provider: "github_copilot", session: "g1", project: "/Users/demo/Projects/docs-site", models: ["gpt-5.4"], startedMinutesAgo: 25, turns: 3, cache: null, baseContext: 11_000, growth: 800, tools: [read(2), edit(3), read(5)], end: "blocked" });
  run({ provider: "opencode", session: "o1", project: "/Users/demo/Projects/scratch", models: ["deepseek-v4-flash"], startedMinutesAgo: 240, turns: 3, cache: [0.9, 0], baseContext: 10_000, growth: 600, tools: [read(1), edit(2)], end: "idle", idleSeconds: 3 * 3600 });

  // Codex touche au même fichier que Claude Code : une collision.
  push("codex", "x1", "/Users/demo/Projects/api-server", "tool_started", 150, { tool_name: "apply_patch", file_path: `${AO}/apps/desktop/src/ui/App.tsx` });

  // Qwen enchaîne les mêmes commandes qui échouent : la boucle se voit dans le tour ouvert.
  for (let index = 0; index < 8; index += 1) {
    push("qwen_code", "q1", "/Users/demo/Projects/video-tool", "tool_started", 110 - index * 11, { tool_name: "run_shell_command", command: "npm test" });
    push("qwen_code", "q1", "/Users/demo/Projects/video-tool", "tool_failed", 108 - index * 11, { tool_name: "run_shell_command", command: "npm test", outcome: "failed" });
  }
  // Copilot échoue deux fois d'affilée.
  for (let index = 0; index < 3; index += 1) push("github_copilot", "g1", "/Users/demo/Projects/docs-site", "tool_failed", 40 - index * 10, { tool_name: "edit_file", file_path: "/Users/demo/Projects/docs-site/src/main.rs", outcome: "failed" });

  return events.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/** Les jours d'avant, pour l'historique : les mêmes sessions, décalées de 1 à 9 jours. */
export function demoHistory(now = Date.now()): SessionEvent[] {
  const days = [1, 2, 3, 5, 6, 8];
  return days.flatMap((day) => demoEvents(now - day * 86_400_000 - (day % 3) * 3_600_000, `h${day}`).filter((_, index) => (index + day) % 3 !== 0));
}

/** Des limites d'abonnement inventées pour la démo : Codex presque au bout de sa fenêtre de 5 h. */
export function demoLimits(now: number) {
  const at = (minutes: number) => Math.round(now / 1000) + minutes * 60;
  return [
    { provider: "codex", observed_at: new Date(now - 60_000).toISOString(), plan: "plus",
      primary: { used_percent: 86, window_minutes: 300, resets_at: at(74) },
      secondary: { used_percent: 41, window_minutes: 10080, resets_at: at(3 * 1440 + 200) } },
    { provider: "claude_code", observed_at: new Date(now - 30_000).toISOString(), plan: null,
      primary: { used_percent: 23.5, window_minutes: 300, resets_at: at(190) },
      secondary: { used_percent: 58, window_minutes: 10080, resets_at: at(2 * 1440 + 30) } }
  ];
}
