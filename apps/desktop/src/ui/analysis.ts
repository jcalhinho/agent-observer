import { providerById } from "./providers";
import { estimateCost, isEdit, type SummaryEvent } from "./sessionSummary";
import { costWithoutCache } from "./insights";
import type { SessionEvent } from "./types";

/*
 * Ce que l'on calcule en croisant les agents ou en regardant dans la durée : collisions, rythme de
 * dépense, tendance du cache, totaux par jour. Fonctions pures, testées : une valeur qu'on ne peut
 * pas établir reste `null`.
 */

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
/** Windows ignore la casse des chemins ; les autres systèmes non. */
const keyOf = (path: string) => (/^[a-z]:\//i.test(path) ? path.toLowerCase() : path);

/* ------------------------------------------------------------------ collisions */

export type Collision = {
  kind: "file" | "repo";
  /** Chemin complet du fichier, ou du dossier de travail commun. */
  path: string;
  /** Les agents concernés (clés de fournisseur). */
  agents: string[];
  lastAt: number;
};

export const COLLISION_WINDOW_MS = 20 * 60_000;
const REPO_ACTIVE_MS = 10 * 60_000;

/** Un dossier trop général (`/`, `~`) ne dit rien d'un dépôt partagé. */
function isSpecific(path: string) {
  const parts = normalize(path).split("/").filter(Boolean);
  if (/^[a-z]:$/i.test(parts[0] ?? "")) return parts.length > 2;
  return parts.length > 2 || (parts.length === 2 && parts[0] !== "Users" && parts[0] !== "home");
}

const contains = (parent: string, child: string) => child === parent || child.startsWith(`${parent}/`);

/**
 * Deux agents qui touchent au même fichier dans les 20 dernières minutes : de vrais conflits en
 * puissance. Plus faible : deux agents actifs dans le même dossier de projet (même dépôt, donc même
 * branche et même arbre de travail), sans fichier commun pour l'instant.
 */
export function detectCollisions(events: SessionEvent[], now: number, windowMs = COLLISION_WINDOW_MS): Collision[] {
  const files = new Map<string, { path: string; agents: Set<string>; lastAt: number }>();
  const latestProject = new Map<string, { path: string; at: number }>();

  for (const event of events) {
    const at = Date.parse(event.occurred_at);
    if (!(now - at < windowMs) || at > now + 60_000) continue;
    if (event.file_path && isEdit(event)) {
      const path = normalize(event.file_path);
      const entry = files.get(keyOf(path)) ?? { path, agents: new Set<string>(), lastAt: 0 };
      entry.agents.add(event.provider);
      entry.lastAt = Math.max(entry.lastAt, at);
      files.set(keyOf(path), entry);
    }
    if (event.project_path && now - at < REPO_ACTIVE_MS) {
      const current = latestProject.get(event.provider);
      if (!current || at > current.at) latestProject.set(event.provider, { path: normalize(event.project_path), at });
    }
  }

  const found: Collision[] = [];
  for (const entry of files.values()) {
    if (entry.agents.size >= 2) found.push({ kind: "file", path: entry.path, agents: [...entry.agents].sort(), lastAt: entry.lastAt });
  }

  // Même dossier de projet (ou l'un dans l'autre), hors fichiers déjà signalés.
  const projects = [...latestProject.entries()].filter(([, project]) => isSpecific(project.path));
  const claimed = new Set<string>();
  for (const [agent, project] of projects) {
    if (claimed.has(agent)) continue;
    const group = projects.filter(([other, candidate]) => contains(keyOf(project.path), keyOf(candidate.path)) || contains(keyOf(candidate.path), keyOf(project.path)) || other === agent);
    if (group.length < 2) continue;
    const agents = group.map(([name]) => name).sort();
    agents.forEach((name) => claimed.add(name));
    // Le plus petit chemin du groupe : le dépôt, pas un sous-dossier.
    const path = group.map(([, candidate]) => candidate.path).sort((a, b) => a.length - b.length)[0];
    const alreadyByFile = found.some((collision) => collision.kind === "file" && agents.every((name) => collision.agents.includes(name)));
    if (!alreadyByFile) found.push({ kind: "repo", path, agents, lastAt: Math.max(...group.map(([, candidate]) => candidate.at)) });
  }
  return found.sort((a, b) => (a.kind === b.kind ? b.lastAt - a.lastAt : a.kind === "file" ? -1 : 1));
}

/** Clé stable d'une collision, pour ne notifier qu'une fois. */
export const collisionKey = (collision: Collision) => `${collision.kind}:${collision.path}:${collision.agents.join("+")}`;

/* ------------------------------------------------------------------ tendance du cache */

export type CacheTrend = {
  /** Taux de cache de chaque requête au modèle, de 0 à 1, la plus ancienne d'abord. */
  series: number[];
  last: number;
  /** Moyenne des requêtes précédentes. */
  before: number | null;
  /** Le taux vient de s'effondrer : le préfixe du prompt a sans doute changé et le cache est perdu. */
  dropped: boolean;
  /** Nombre d'effondrements dans la session. */
  drops: number;
};

const MAX_TREND_POINTS = 40;
const DROP_BY = 0.3;

type TrendEvent = Pick<SummaryEvent, "kind" | "occurred_at" | "input_tokens" | "cache_read_tokens" | "cache_write_tokens">;

/** Null tant que l'agent ne rapporte pas ses lectures de cache, ou avec moins de deux requêtes. */
export function cacheTrend(events: TrendEvent[]): CacheTrend | null {
  const rates: number[] = [];
  for (const event of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (event.kind !== "model_usage" || !event.cache_read_tokens) continue;
    const read = event.cache_read_tokens.value;
    const prompt = (event.input_tokens?.value ?? 0) + read + (event.cache_write_tokens?.value ?? 0);
    if (prompt > 0) rates.push(Math.min(1, read / prompt));
  }
  if (rates.length < 2) return null;

  let drops = 0;
  for (let index = 3; index < rates.length; index += 1) {
    const mean = (rates[index - 1] + rates[index - 2] + rates[index - 3]) / 3;
    if (mean >= 0.5 && rates[index] < mean - DROP_BY) drops += 1;
  }
  const last = rates[rates.length - 1];
  const earlier = rates.slice(Math.max(0, rates.length - 4), -1);
  const before = earlier.length ? earlier.reduce((sum, value) => sum + value, 0) / earlier.length : null;
  const dropped = rates.length >= 4 && before !== null && before >= 0.5 && last < before - DROP_BY;
  const step = Math.max(1, Math.ceil(rates.length / MAX_TREND_POINTS));
  return { series: rates.filter((_, index) => index % step === 0 || index === rates.length - 1), last, before, dropped, drops };
}

/* ------------------------------------------------------------------ rythme de dépense */

export type Burn = {
  tokensPerMin: number;
  /** Dollars par heure au rythme actuel ; null quand un modèle de la fenêtre n'a pas de prix connu. */
  usdPerHour: number | null;
};

export const BURN_WINDOW_MS = 15 * 60_000;

/**
 * Le rythme sur les 15 dernières minutes (ou depuis le début de la session si elle est plus jeune).
 * Null quand aucune requête au modèle n'a été vue sur la fenêtre.
 */
export function burnRate(events: SummaryEvent[], now: number, windowMs = BURN_WINDOW_MS): Burn | null {
  const inside = events.filter((event) => now - Date.parse(event.occurred_at) < windowMs && Date.parse(event.occurred_at) <= now);
  const usage = inside.filter((event) => event.input_tokens || event.output_tokens || event.cache_read_tokens || event.cache_write_tokens);
  if (!usage.length) return null;
  const sessionStart = Math.min(...events.map((event) => Date.parse(event.occurred_at)));
  const span = Math.max(60_000, Math.min(windowMs, now - sessionStart));
  const tokens = usage.reduce((sum, event) => sum + (event.input_tokens?.value ?? 0) + (event.output_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0), 0);
  const cost = estimateCost(usage);
  const usdPerHour = cost && cost.unpricedEvents === 0 ? (cost.value / span) * 3_600_000 : null;
  return { tokensPerMin: (tokens / span) * 60_000, usdPerHour };
}

export type Spend = { value: number; partial: boolean };

/** Ce que les requêtes depuis `since` ont coûté (tour en cours, boucle…). Null sans aucun prix connu. */
export function costSince(events: SummaryEvent[], since: number): Spend | null {
  const cost = estimateCost(events.filter((event) => Date.parse(event.occurred_at) >= since));
  return cost ? { value: cost.value, partial: cost.unpricedEvents > 0 } : null;
}

/* ------------------------------------------------------------------ budget */

export type BudgetState = "none" | "ok" | "near" | "over";
export const NEAR_BUDGET = 0.8;

export function budgetState(spent: number | null, limit: number | null): BudgetState {
  if (!limit || limit <= 0 || spent === null) return "none";
  if (spent >= limit) return "over";
  return spent >= limit * NEAR_BUDGET ? "near" : "ok";
}

/* ------------------------------------------------------------------ totaux par jour */

export type Share = { tokens: number; cost: number | null };

export type DayTotals = {
  /** Jour local, « 2026-11-07 ». */
  day: string;
  tokens: number;
  output: number;
  /** Part du prompt servie par le cache, quand au moins un agent rapporte ses lectures. */
  cacheHit: number | null;
  cost: number | null;
  costPartial: boolean;
  saved: number | null;
  sessions: number;
  failures: number;
  /** Réponses du modèle qui ont rapporté leur usage. */
  requests: number;
  /** Tokens de prompt envoyés (entrée nouvelle, lectures et écritures de cache). */
  prompt: number;
  /** Lectures de cache et reste du prompt, pour les seuls agents qui rapportent leur cache. */
  hit: number;
  miss: number;
  /** Requêtes dont le modèle n'a pas de prix connu : elles n'entrent pas dans le coût. */
  unpriced: number;
  byAgent: Record<string, Share>;
  byProject: Record<string, Share>;
  byModel: Record<string, Share>;
};

export const localDay = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const tokensOf = (event: SummaryEvent) => (event.input_tokens?.value ?? 0) + (event.output_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);
const hasUsage = (event: SummaryEvent) => Boolean(event.input_tokens || event.output_tokens || event.cache_read_tokens || event.cache_write_tokens);

/** A session seen at a given time, without the rest of the event (see `load_history`). */
export type SessionPresence = { provider: string; session_id: string; occurred_at: string };

/**
 * Un total par jour, le plus récent d'abord, limité aux `days` derniers jours. `presence` ajoute les
 * sessions que la base a vues sans renvoyer chacun de leurs événements : elles comptent dans
 * `sessions`, et nulle part ailleurs.
 */
export function dailyTotals(events: SessionEvent[], now: number, days: number, presence: SessionPresence[] = []): DayTotals[] {
  const oldest = localDay(now - (days - 1) * 86_400_000);
  const newest = localDay(now);
  const byDay = new Map<string, SessionEvent[]>();
  const sessionsByDay = new Map<string, Set<string>>();
  const see = (occurredAt: string, provider: string, session: string) => {
    const day = localDay(Date.parse(occurredAt));
    if (day < oldest || day > newest) return null;
    (sessionsByDay.get(day) ?? sessionsByDay.set(day, new Set()).get(day)!).add(`${provider}:${session}`);
    return byDay.get(day) ?? byDay.set(day, []).get(day)!;
  };
  for (const seen of presence) see(seen.occurred_at, seen.provider, seen.session_id);
  for (const event of events) see(event.occurred_at, event.provider, event.session_id)?.push(event);

  const result: DayTotals[] = [];
  for (const [day, list] of byDay) {
    const usage = list.filter(hasUsage);
    let tokens = 0;
    let output = 0;
    let read = 0;
    let prompt = 0;
    let reporting = false;
    let promptAll = 0;
    let miss = 0;
    for (const event of usage) {
      promptAll += (event.input_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);
      tokens += tokensOf(event);
      output += event.output_tokens?.value ?? 0;
      if (event.cache_read_tokens) {
        reporting = true;
        read += event.cache_read_tokens.value;
        prompt += (event.input_tokens?.value ?? 0) + event.cache_read_tokens.value + (event.cache_write_tokens?.value ?? 0);
        miss += (event.input_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);
      }
    }

    let cost: number | null = null;
    let partial = false;
    let saved: number | null = null;
    const share = (group: (event: SessionEvent) => string): Record<string, Share> => {
      const groups = new Map<string, SessionEvent[]>();
      for (const event of usage) (groups.get(group(event)) ?? groups.set(group(event), []).get(group(event))!).push(event);
      return Object.fromEntries([...groups].map(([name, part]) => {
        const priced = estimateCost(part);
        return [name, { tokens: part.reduce((sum, event) => sum + tokensOf(event), 0), cost: priced ? priced.value : null }];
      }));
    };
    const byAgent = share((event) => event.provider);
    const byProject = share((event) => event.project_path ? normalize(event.project_path) : "");
    const byModel = share((event) => event.model?.value ?? "");
    let unpriced = 0;

    for (const part of Object.keys(byAgent)) {
      const agentEvents = usage.filter((event) => event.provider === part);
      const priced = estimateCost(agentEvents);
      if (priced) {
        cost = (cost ?? 0) + priced.value;
        partial ||= priced.unpricedEvents > 0;
        unpriced += priced.unpricedEvents;
        const baseline = priced.unpricedEvents === 0 ? costWithoutCache(agentEvents) : null;
        if (baseline && baseline.unpricedEvents === 0 && baseline.value - priced.value > 0.0001) saved = (saved ?? 0) + baseline.value - priced.value;
      } else {
        partial = true;
        unpriced += agentEvents.length;
      }
    }

    result.push({
      day, tokens, output, cacheHit: reporting && prompt > 0 ? Math.min(1, read / prompt) : null,
      cost, costPartial: partial && cost !== null, saved,
      sessions: sessionsByDay.get(day)?.size ?? 0,
      failures: list.filter((event) => event.kind === "tool_failed").length,
      requests: usage.length, prompt: promptAll, hit: read, miss, unpriced,
      byAgent, byProject, byModel
    });
  }
  return result.sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Temps de travail d'une session : la somme des tours, de chaque message de l'utilisateur à la
 * dernière activité avant le suivant. Les attentes d'outil et d'approbation y sont comprises, pas
 * les pauses entre deux tours. Null quand le connecteur ne marque pas ses tours (Cursor).
 */
export function workTime(events: Array<{ provider: string; kind: string; outcome?: string | null; occurred_at: string }>): number | null {
  if (!events.length) return null;
  const ordered = [...events].sort((x, y) => x.occurred_at.localeCompare(y.occurred_at));
  const provider = ordered[0].provider;
  if (provider === providerById("cursor").eventKey) return null;
  const isCodex = provider === providerById("codex").eventKey;
  const seen = new Set<string>();
  // Indices (dans l'ordre chronologique) du premier événement de chaque tour.
  const starts: number[] = [];
  ordered.forEach((event, index) => {
    if (isCodex) {
      if (event.outcome?.startsWith("turn-started:") && !seen.has(event.outcome)) { seen.add(event.outcome); starts.push(index); }
    } else if (event.kind === "user_message") {
      starts.push(index);
    }
  });
  if (!starts.length) return null;
  const at = (index: number) => Date.parse(ordered[index].occurred_at);
  let total = 0;
  starts.forEach((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1] - 1 : ordered.length - 1;
    total += Math.max(0, at(end) - at(start));
  });
  return total;
}
