import { t } from "./i18n";

/*
 * Where a session was opened, in plain words. Each agent writes this in its own vocabulary (Claude's
 * `entrypoint`, Codex's `originator`, Hermes's and Qwen's `source`, Copilot's host): the raw value
 * stays available as a tooltip, and a value not listed here is shown as written.
 */
type LaunchKind = "terminal" | "app" | "editor" | "program" | "web" | "messaging" | "scheduled" | "cloud" | "other";

export type Launch = { kind: LaunchKind; label: string; raw: string };

const KINDS: Record<string, LaunchKind> = {
  // Claude Code
  cli: "terminal",
  "claude-vscode": "editor",
  "claude-desktop": "app",
  "sdk-cli": "program",
  "sdk-ts": "program",
  "sdk-py": "program",
  remote: "cloud",
  remote_cowork: "cloud",
  // Codex
  "codex desktop": "app",
  codex_work_desktop: "app",
  codex_vscode: "editor",
  codex_exec: "program",
  codex_cli_rs: "terminal",
  "codex-tui": "terminal",
  // Hermes
  tui: "terminal",
  desktop: "app",
  gui: "app",
  webui: "web",
  oneshot: "program",
  api_server: "program",
  cron: "scheduled",
  telegram: "messaging",
  discord: "messaging",
  slack: "messaging",
  whatsapp: "messaging",
  signal: "messaging",
  bot_room: "messaging",
  // Qwen Code
  standalone: "terminal",
  "web-shell": "web",
  web_shell: "web",
  channel: "messaging",
  scheduled_task: "scheduled",
  daemon: "program",
  // Copilot (host type)
  vscode: "editor",
  jetbrains: "editor",
};

/** The app's own name, for the agents whose desktop app says only "desktop". */
function appName(provider: string, raw: string): string {
  // The Codex app and the ChatGPT app both write "Codex Desktop": the log cannot say which one.
  if (provider === "claude_code") return t("app Claude", "Claude app");
  if (provider === "hermes") return t("app Hermes", "Hermes app");
  return t("app de bureau", "desktop app");
}

/** Goose's `session_type` (crates/goose/src/session/session_manager.rs). `user` is any ordinary
 * session, from the terminal or the app alike: it says nothing about where it was opened. */
const GOOSE: Record<string, LaunchKind | null> = { user: null, hidden: null, terminal: "terminal", scheduled: "scheduled", sub_agent: "program" };

export function launchOf(provider: string, raw: string | null | undefined): Launch | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const goose = provider === "goose" ? GOOSE[value.toLowerCase()] : undefined;
  if (goose === null) return null;
  const kind = goose ?? KINDS[value.toLowerCase()] ?? "other";
  const label = (() => {
    switch (kind) {
      case "terminal": return t("terminal", "terminal");
      case "app": return appName(provider, value);
      case "editor": return t("extension d’éditeur", "editor extension");
      case "program": return t("lancé par un programme", "run by a program");
      case "web": return t("interface web", "web interface");
      case "messaging": return t(`messagerie (${value})`, `messaging (${value})`);
      case "scheduled": return t("tâche planifiée", "scheduled task");
      case "cloud": return t("cloud", "cloud");
      default: return value;
    }
  })();
  return { kind, label, raw: value };
}
