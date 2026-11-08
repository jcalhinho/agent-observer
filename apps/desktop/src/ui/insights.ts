import { locale, t } from "./i18n";
import { estimateCost, type CostEstimate, type SessionSummary, type SummaryEvent, type TokenTotals } from "./sessionSummary";

/**
 * Les chiffres que montrent les cartes : taux de cache, coût estimé, économie due au cache.
 * Fonctions pures : une valeur que l'agent ne rapporte pas reste `null`, jamais inventée.
 */

/** 12 400 -> « 12,4k », 3 200 000 -> « 3,2M ». */
export function compact(value: number) {
  if (value < 1000) return String(Math.round(value));
  const digits = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (value < 1_000_000) return `${digits(value / 1000)}k`;
  if (value < 1_000_000_000) return `${digits(value / 1_000_000)}M`;
  return `${digits(value / 1_000_000_000)}G`;
}

/** 0 -> « 0 $ », 0.0042 -> « <0,01 $ », 1.5 -> « 1,50 $ », 42 -> « 42 $ ». */
export function usd(value: number) {
  const fr = locale().startsWith("fr");
  if (value <= 0) return fr ? "0 $" : "$0";
  const small = value < 0.01;
  const text = small ? (fr ? "0,01" : "0.01") : value < 10 ? value.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(value).toLocaleString(locale());
  return fr ? `${small ? "<" : ""}${text} $` : `${small ? "<" : ""}$${text}`;
}

export function percent(ratio: number) {
  const value = ratio * 100;
  return `${value >= 99.5 && value < 100 ? value.toFixed(1) : Math.round(value)}${locale().startsWith("fr") ? " %" : "%"}`;
}

/** 95 000 ms -> « 1 min », 4 380 000 -> « 1 h 13 ». */
export function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours >= 24 ? t(`${Math.floor(hours / 24)} j ${hours % 24} h`, `${Math.floor(hours / 24)} d ${hours % 24} h`) : `${hours} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

/** Tokens du prompt, cache compris. */
function promptTokens(tokens: TokenTotals): number {
  return (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
}

/**
 * Part du prompt servie par le cache, de 0 à 1. Null quand l'agent ne rapporte pas de lectures de
 * cache : on ne sait pas, ce n'est pas « 0 % ».
 */
export function cacheHitRate(tokens: TokenTotals | null): number | null {
  if (!tokens || tokens.cacheRead === null) return null;
  const prompt = promptTokens(tokens);
  return prompt > 0 ? Math.min(1, tokens.cacheRead / prompt) : null;
}

/**
 * Lectures de cache (hit) et tout le reste du prompt (miss : entrée nouvelle et écritures de cache),
 * en tokens exacts. Null quand l'agent ne rapporte pas ses lectures de cache.
 */
export function cacheCounts(tokens: TokenTotals | null): { hit: number; miss: number } | null {
  if (!tokens || tokens.cacheRead === null) return null;
  return { hit: tokens.cacheRead, miss: (tokens.input ?? 0) + (tokens.cacheWrite ?? 0) };
}

/**
 * Ce que les mêmes requêtes auraient coûté sans aucun cache : toutes les lectures et écritures de
 * cache comptées comme de l'entrée ordinaire.
 */
export function costWithoutCache(events: SummaryEvent[]): CostEstimate | null {
  if (!events.some((event) => (event.cache_read_tokens?.value ?? 0) > 0)) return null;
  const flat = events.map((event): SummaryEvent => {
    const read = event.cache_read_tokens?.value ?? 0;
    const write = event.cache_write_tokens?.value ?? 0;
    if (!read && !write) return event;
    return { ...event, input_tokens: { value: (event.input_tokens?.value ?? 0) + read + write, origin: "derived" }, cache_read_tokens: null, cache_write_tokens: null };
  });
  return estimateCost(flat);
}

export type CostInsight = {
  /** Coût estimé au tarif API des modèles vus. */
  value: number;
  /** Vrai quand une partie des requêtes n'a pas pu être chiffrée (modèle absent de la table…) : le vrai coût est plus haut. */
  partial: boolean;
  /** Économie due au cache, quand elle est connue et positive. */
  saved: number | null;
  /** Coût sans cache, pour mémoire. */
  withoutCache: number | null;
};

export function costInsight(events: SummaryEvent[], summary: SessionSummary): CostInsight | null {
  const cost = summary.cost;
  if (!cost) return null;
  const partial = cost.unpricedEvents > 0;
  const baseline = partial ? null : costWithoutCache(events);
  const saved = baseline && baseline.unpricedEvents === 0 && baseline.value - cost.value > 0.0001 ? baseline.value - cost.value : null;
  return { value: cost.value, partial, saved, withoutCache: baseline && baseline.unpricedEvents === 0 ? baseline.value : null };
}

/** Ce que les agents affichent ensemble : une ligne de tableau de bord. */
export type FleetTotals = {
  agents: number;
  tokens: number | null;
  output: number | null;
  cacheHit: number | null;
  cost: number | null;
  costPartial: boolean;
  saved: number | null;
  toolCalls: number;
  failures: number;
  filesChanged: number;
};

type FleetInput = {
  summary: { tokens: TokenTotals | null } | null;
  cost: CostInsight | null;
  session: { toolCalls: number; failures: number; filesChanged: number } | null;
};

export function fleetTotals(pulses: FleetInput[]): FleetTotals {
  let tokens: number | null = null;
  let output: number | null = null;
  let read = 0;
  let prompt = 0;
  let hasCache = false;
  let cost: number | null = null;
  let costPartial = false;
  let saved: number | null = null;
  let toolCalls = 0;
  let failures = 0;
  let filesChanged = 0;
  let agents = 0;
  for (const pulse of pulses) {
    if (!pulse.session) continue;
    agents += 1;
    toolCalls += pulse.session.toolCalls;
    failures += pulse.session.failures;
    filesChanged += pulse.session.filesChanged;
    const totals = pulse.summary?.tokens;
    if (totals) {
      tokens = (tokens ?? 0) + promptTokens(totals) + (totals.output ?? 0);
      if (totals.output !== null) output = (output ?? 0) + totals.output;
      if (totals.cacheRead !== null) {
        hasCache = true;
        read += totals.cacheRead;
        prompt += promptTokens(totals);
      }
    }
    if (pulse.cost) {
      cost = (cost ?? 0) + pulse.cost.value;
      costPartial ||= pulse.cost.partial;
      if (pulse.cost.saved !== null) saved = (saved ?? 0) + pulse.cost.saved;
    }
  }
  return { agents, tokens, output, cacheHit: hasCache && prompt > 0 ? Math.min(1, read / prompt) : null, cost, costPartial, saved, toolCalls, failures, filesChanged };
}

/** « Sonnet 5.5 » plutôt que « claude-sonnet-5-5 », sans jamais inventer : on ne coupe que ce qui est sûr. */
export function shortModel(model: string) {
  return model.replace(/^(?:anthropic|openai|google|deepseek)\//i, "").replace(/-\d{8}$/, "");
}

