
export type ConnectorKind = "claude" | "codex" | "opencode" | "qwen" | "reasonix" | "cursor" | "antigravity" | "copilot" | "continue" | "hermes"
  | "gemini" | "pi" | "omp" | "kimi" | "goose" | "crush" | "zed" | "aider" | "process";

export type Provider = {
  /** Stable UI identifier (React keys, 3D lane ids). */
  id: string;
  /** Provider key serialized by the backend in `SessionEvent.provider` (`Provider::key()` in crates/session-events). */
  eventKey: string;
  name: string;
  initials: string;
  color: string;
  surface: string;
  /** Present when a local connector exists; `scope` is the short source label shown on its card. */
  connector?: { kind: ConnectorKind; scope?: string };
};

/**
 * Agent colours with a local connector come from the validated categorical palette (dark steps,
 * checked for colour-blind separation in `activeProviders` order). Keep them in sync when adding one.
 * Single source of truth for providers: always read `eventKey` to match events, never `id`.
 */
export const providers: Provider[] = [
  { id: "claude_code", eventKey: "claude_code", name: "Claude Code", initials: "C", color: "#d95926", surface: "#3a2219", connector: { kind: "claude" } },
  { id: "codex", eventKey: "codex", name: "Codex", initials: "⌘", color: "#199e70", surface: "#173229", connector: { kind: "codex", scope: "Journaux locaux" } },
  { id: "cursor", eventKey: "cursor", name: "Cursor", initials: "◈", color: "#e66767", surface: "#402727", connector: { kind: "cursor", scope: "Hooks Cursor" } },
  { id: "opencode", eventKey: "opencode", name: "OpenCode", initials: "O", color: "#d55181", surface: "#3a1f2b", connector: { kind: "opencode", scope: "SQLite local" } },
  { id: "copilot", eventKey: "github_copilot", name: "GitHub Copilot", initials: "⌘", color: "#c98500", surface: "#352a14", connector: { kind: "copilot", scope: "Journaux locaux" } },
  { id: "gemini", eventKey: "gemini_cli", name: "Gemini CLI", initials: "✳", color: "#5aa0f0", surface: "#1c2c45", connector: { kind: "gemini", scope: "Journaux locaux" } },
  { id: "antigravity", eventKey: "antigravity", name: "Antigravity", initials: "✦", color: "#3987e5", surface: "#1c2c45", connector: { kind: "antigravity", scope: "Fichiers locaux" } },
  { id: "qwen", eventKey: "qwen_code", name: "Qwen Code", initials: "Q", color: "#9085e9", surface: "#28264a", connector: { kind: "qwen", scope: "Journaux locaux" } },
  { id: "reasonix", eventKey: "reasonix", name: "Reasonix", initials: "R", color: "#00a0a0", surface: "#123333", connector: { kind: "reasonix", scope: "Journaux locaux" } },
  { id: "cline", eventKey: "cline", name: "Cline", initials: "C", color: "#efb477", surface: "#3c3023" },
  { id: "roo", eventKey: "roo_code", name: "Roo Code", initials: "R", color: "#80c99c", surface: "#24382c" },
  { id: "continue", eventKey: "continue", name: "Continue", initials: "↳", color: "#9741b8", surface: "#2f1d3a", connector: { kind: "continue", scope: "Journaux locaux" } },
  { id: "hermes", eventKey: "hermes", name: "Hermes", initials: "☿", color: "#e600e6", surface: "#3a1a3a", connector: { kind: "hermes", scope: "SQLite local" } },
  { id: "aider", eventKey: "aider", name: "Aider", initials: "A", color: "#f18e8e", surface: "#402727", connector: { kind: "aider", scope: "Processus + historique" } },
  { id: "pi", eventKey: "pi", name: "pi", initials: "π", color: "#4fb39a", surface: "#233c3c", connector: { kind: "pi", scope: "Journaux locaux" } },
  { id: "omp", eventKey: "omp", name: "omp", initials: "ω", color: "#2f8f7a", surface: "#1c3535", connector: { kind: "omp", scope: "Journaux locaux" } },
  { id: "kimi", eventKey: "kimi_code", name: "Kimi Code", initials: "K", color: "#7c8cf8", surface: "#2d3451", connector: { kind: "kimi", scope: "Journaux locaux" } },
  { id: "goose", eventKey: "goose", name: "Goose", initials: "G", color: "#b8a03c", surface: "#3a3828", connector: { kind: "goose", scope: "SQLite local" } },
  { id: "crush", eventKey: "crush", name: "Crush", initials: "◆", color: "#c56fd6", surface: "#3d2d4a", connector: { kind: "crush", scope: "SQLite par projet" } },
  { id: "zed", eventKey: "zed", name: "Zed", initials: "Z", color: "#5b8def", surface: "#26344f", connector: { kind: "zed", scope: "SQLite local" } },
  { id: "amp", eventKey: "amp", name: "Amp", initials: "A", color: "#e07a3f", surface: "#433028", connector: { kind: "process", scope: "Processus" } },
  { id: "kiro", eventKey: "kiro", name: "Kiro CLI", initials: "K", color: "#8e6cf0", surface: "#312d4f", connector: { kind: "process", scope: "Processus" } },
  { id: "trae", eventKey: "trae", name: "Trae CLI", initials: "T", color: "#3fa76f", surface: "#203a33", connector: { kind: "process", scope: "Processus" } },
  { id: "qoder", eventKey: "qoder", name: "Qoder CLI", initials: "Q", color: "#d4626f", surface: "#412b33", connector: { kind: "process", scope: "Processus" } },
  { id: "codebuddy", eventKey: "codebuddy", name: "CodeBuddy", initials: "CB", color: "#3a9bd9", surface: "#1f374a", connector: { kind: "process", scope: "Processus" } },
  { id: "minimax", eventKey: "minimax_code", name: "MiniMax Code", initials: "M", color: "#e2557b", surface: "#442836", connector: { kind: "process", scope: "Processus" } },
  { id: "jcode", eventKey: "jcode", name: "jcode", initials: "j", color: "#a08a5a", surface: "#35332e", connector: { kind: "process", scope: "Processus" } },
  { id: "dsh", eventKey: "dsh", name: "dsh", initials: "d", color: "#4f9fb0", surface: "#233841", connector: { kind: "process", scope: "Processus" } },
  { id: "iflow", eventKey: "iflow", name: "iFlow CLI", initials: "i", color: "#6f7cd9", surface: "#2a304a", connector: { kind: "process", scope: "Processus" } },
  // Placeholder for the backend key; each custom connector becomes its own provider at runtime.
  { id: "custom", eventKey: "custom", name: "Custom connector", initials: "+", color: "#7d8aa3", surface: "#262b35" }
];

export function providerById(id: string): Provider {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown provider id: ${id}`);
  return provider;
}

/**
 * Agents shown by the app, in chart series order. The first ten passed every check of the
 * categorical palette validator on #171b22 (dataviz `validate_palette.js --mode dark`): worst
 * adjacent CVD ΔE 9.8, worst adjacent normal-vision ΔE 19.3, contrast ≥ 3:1. The agents added in
 * 0.18 only colour their own bar and badge, always next to their name: their colours stay in the
 * same contrast range (4.8–7.4:1 on the dark surface) without a claim of pairwise separation.
 * Other providers stay in the table (backend keys) but are hidden.
 */
export const activeProviders: Provider[] = [
  "claude_code", "antigravity", "codex", "qwen", "opencode", "copilot", "hermes", "reasonix", "cursor", "continue",
  "gemini", "pi", "omp", "kimi", "goose", "crush", "zed", "aider",
  "amp", "kiro", "trae", "qoder", "codebuddy", "minimax", "jcode", "dsh", "iflow"
].map(providerById);

/** Les agents que l'app affiche, dans l'ordre. */
export function activeAgents(): Provider[] {
  return activeProviders;
}

/** Gardé comme point d'accroche : la liste des agents est fixe aujourd'hui. */
export function useAgents(): Provider[] {
  return activeProviders;
}

export function providerFor(eventKey: string): Provider | undefined {
  return providers.find((provider) => provider.eventKey === eventKey);
}

export function agentName(eventKey: string) {
  return providerFor(eventKey)?.name ?? eventKey;
}

/** Les événements qui méritent d'être affichés. */
export function isActiveProvider(eventKey: string) {
  return activeProviders.some((provider) => provider.eventKey === eventKey);
}
