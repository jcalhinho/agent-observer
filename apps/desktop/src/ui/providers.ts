
export type ConnectorKind = "claude" | "codex" | "opencode" | "qwen" | "reasonix" | "cursor" | "antigravity" | "copilot" | "continue" | "hermes";

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
  { id: "gemini", eventKey: "gemini_cli", name: "Gemini CLI", initials: "✳", color: "#5aa0f0", surface: "#1c2c45" },
  { id: "antigravity", eventKey: "antigravity", name: "Antigravity", initials: "✦", color: "#3987e5", surface: "#1c2c45", connector: { kind: "antigravity", scope: "Fichiers locaux" } },
  { id: "qwen", eventKey: "qwen_code", name: "Qwen Code", initials: "Q", color: "#9085e9", surface: "#28264a", connector: { kind: "qwen", scope: "Journaux locaux" } },
  { id: "reasonix", eventKey: "reasonix", name: "Reasonix", initials: "R", color: "#00a0a0", surface: "#123333", connector: { kind: "reasonix", scope: "Journaux locaux" } },
  { id: "cline", eventKey: "cline", name: "Cline", initials: "C", color: "#efb477", surface: "#3c3023" },
  { id: "roo", eventKey: "roo_code", name: "Roo Code", initials: "R", color: "#80c99c", surface: "#24382c" },
  { id: "continue", eventKey: "continue", name: "Continue", initials: "↳", color: "#9741b8", surface: "#2f1d3a", connector: { kind: "continue", scope: "Journaux locaux" } },
  { id: "hermes", eventKey: "hermes", name: "Hermes", initials: "☿", color: "#e600e6", surface: "#3a1a3a", connector: { kind: "hermes", scope: "SQLite local" } },
  { id: "aider", eventKey: "aider", name: "Aider", initials: "A", color: "#f18e8e", surface: "#402727" },
  // Placeholder for the backend key; each custom connector becomes its own provider at runtime.
  { id: "custom", eventKey: "custom", name: "Custom connector", initials: "+", color: "#7d8aa3", surface: "#262b35" }
];

export function providerById(id: string): Provider {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown provider id: ${id}`);
  return provider;
}

/**
 * Agents shown by the app for now, in chart series order. This exact order passes every check of
 * the categorical palette validator on #171b22 (dataviz `validate_palette.js --mode dark`): worst
 * adjacent CVD ΔE 9.8, worst adjacent normal-vision ΔE 19.3, contrast ≥ 3:1; Continue's colour is
 * also ≥ 15.9 from every other one, Hermes's ≥ 16.3 (it sits between Copilot and Reasonix, where it
 * leaves those worst pairs unchanged). Re-run it before reordering or adding one. Other providers
 * stay in the table (backend keys) but are hidden.
 */
export const activeProviders: Provider[] = ["claude_code", "antigravity", "codex", "qwen", "opencode", "copilot", "hermes", "reasonix", "cursor", "continue"].map(providerById);

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
