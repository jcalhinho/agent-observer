import type { CSSProperties, KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Clock3, Flame, Folder, FolderOpen, GitBranch, Pencil, TriangleAlert } from "lucide-react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import type { Collision } from "./analysis";
import { t } from "./i18n";
import { cacheHitRate, compact, duration, percent, shortModel, usd } from "./insights";
import { ProviderMark } from "./ProviderBadges";
import { agentName, providerFor, providers } from "./providers";
import { Bars, Stack, type Segment } from "./Spark";
import { useConfiguredModels } from "./useConfiguredModels";
import { revealFolder, type GitState } from "./useGit";
import { resetText, windowsOf } from "./limitsView";
import type { LimitSnapshot } from "./useLimits";

/** Le vocabulaire unique des états d'agent. */
export function statusInfo(status: PulseStatus): { label: string; explanation: string } {
  switch (status) {
    case "looping": return { label: t("Tourne en rond", "Going in circles"), explanation: t("L’agent répète les mêmes actions sans avancer. Interviens : il consomme des tokens pour rien.", "The agent repeats the same actions without progress. Step in: it burns tokens for nothing.") };
    case "blocked": return { label: t("Bloqué", "Blocked"), explanation: t("Au moins deux outils ont échoué d’affilée.", "At least two tools failed in a row.") };
    case "stalled": return { label: t("Silencieux", "Silent"), explanation: t("Un tour est en cours mais rien ne se passe depuis plus de 2 minutes. Il attend souvent une validation.", "A turn is open but nothing happened for over 2 minutes. It often waits for your approval.") };
    case "waiting": return { label: t("T’attend", "Waiting for you"), explanation: t("Son dernier tour est terminé : il est prêt pour ton prochain message.", "Its last turn is done: it is ready for your next message.") };
    case "working": return { label: t("Au travail", "Working"), explanation: t("Il agit en ce moment.", "It is acting right now.") };
    case "idle": return { label: t("Au repos", "Idle"), explanation: t("Aucune activité récente.", "No recent activity.") };
    case "never": return { label: t("Pas encore vu", "Not seen yet"), explanation: t("Aucun événement reçu de cet agent.", "No event received from this agent.") };
  }
}

/** Âge d'un événement, en clair. */
export function since(at: number | null, now: number) {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return t("à l’instant", "just now");
  if (seconds < 60) return t(`il y a ${seconds} s`, `${seconds}s ago`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(`il y a ${minutes} min`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t(`il y a ${hours} h`, `${hours} h ago`) : t(`il y a ${Math.floor(hours / 24)} j`, `${Math.floor(hours / 24)} d ago`);
}

const fallback = providers.find((provider) => provider.eventKey === "custom")!;

/**
 * Où travaille l'agent, en un mot lisible.
 *
 * Trois cas à gérer : certains agents (Reasonix) ne transmettent pas leur
 * répertoire de travail, mais bien le chemin des fichiers qu'ils touchent ;
 * un chemin qui est le dossier personnel afficherait sinon le nom de
 * l'utilisateur, ce qui n'apprend rien ; et la racine n'a pas de dernier
 * segment. Le chemin complet reste au survol.
 */
export function placeOf(project: { project_path: string | null; file_path: string | null } | null): { label: string; full: string | null } {
  const raw = project?.project_path ?? null;
  // Faute de répertoire de travail, le dossier parent du dernier fichier touché.
  const derived = raw ?? (project?.file_path ? project.file_path.replaceAll("\\", "/").split("/").slice(0, -1).join("/") : null);
  if (!derived) return { label: t("dossier inconnu", "unknown folder"), full: null };

  const parts = derived.replaceAll("\\", "/").split("/").filter(Boolean);
  // `/Users/<nom>` ou `/home/<nom>` : c'est le dossier personnel.
  const isHome = parts.length === 2 && (parts[0] === "Users" || parts[0] === "home");
  const label = isHome ? "~" : parts.at(-1) ?? "/";
  return { label: raw ? label : t(`${label} (déduit)`, `${label} (inferred)`), full: derived };
}

/** La répartition des tokens d'une session, d'après ce que l'agent rapporte. */
export function tokenSegments(pulse: AgentPulse): Segment[] {
  const tokens = pulse.summary?.tokens;
  if (!tokens) return [];
  return [
    { key: "cache", short: t("cache lu", "cache read"), label: t("Lus depuis le cache", "Read from cache"), value: tokens.cacheRead ?? 0, className: "tok-cache" },
    { key: "write", short: t("cache écrit", "cache write"), label: t("Écrits dans le cache", "Written to cache"), value: tokens.cacheWrite ?? 0, className: "tok-write" },
    { key: "new", short: t("entrée", "input"), label: t("Entrée nouvelle (hors cache)", "New input (uncached)"), value: tokens.input ?? 0, className: "tok-new" },
    { key: "out", short: t("sortie", "output"), label: t("Sortie", "Output"), value: tokens.output ?? 0, className: "tok-out" }
  ];
}

function modelTitle(pulse: AgentPulse, configured: string | null | undefined) {
  if (pulse.modelsSeen.length > 1) return t(`Modèle de la dernière réponse. Dans cette session : ${pulse.modelsSeen.join(", ")}.`, `Model of the latest response. In this session: ${pulse.modelsSeen.join(", ")}.`);
  if (pulse.model) return t("Modèle de la dernière réponse", "Model of the latest response");
  return configured ? t("Modèle choisi dans les réglages de l’agent ; aucune réponse encore observée", "Model selected in the agent’s settings; no response observed yet") : "";
}

/**
 * Une barre par agent, empilées en colonne : qui, son état, ce qu'il fait, puis ses chiffres alignés
 * (tokens, cache, coût, contexte, outils, activité). Une seconde ligne porte les alertes et le
 * contexte (collisions, git, modèle, rythme). Un clic ouvre le détail.
 */
export function AgentBar({ pulse, now, onOpen, git, collisions, limits }: { pulse: AgentPulse; now: number; onOpen: (key: string) => void; git?: GitState; collisions: Collision[]; limits?: LimitSnapshot }) {
  const provider = providerFor(pulse.key) ?? fallback;
  const status = statusInfo(pulse.status);
  const session = pulse.session;
  const summary = pulse.summary;
  const configured = useConfiguredModels()[provider.eventKey];
  const model = pulse.model ?? configured ?? null;

  const trouble = pulse.status === "looping" && pulse.loop
    ? t(`Boucle : ${pulse.loop.evidence}`, `Loop: ${pulse.loop.evidence}`)
    : pulse.status === "blocked"
      ? t(`${pulse.failureStreak} échecs d’affilée`, `${pulse.failureStreak} failures in a row`)
      : null;
  const spend = pulse.turnSpend && pulse.turnSpend.value >= 0.005 ? `${pulse.turnSpend.partial ? "≥ " : "≈ "}${usd(pulse.turnSpend.value)}` : null;
  const doing = pulse.current?.text ?? status.explanation;
  const detail = trouble ? null : pulse.current?.detail ?? null;
  const place = placeOf(pulse.project);

  const tokens = summary?.tokens ?? null;
  const total = tokens ? (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0) + (tokens.output ?? 0) : null;
  const hit = cacheHitRate(tokens);
  const segments = tokenSegments(pulse);
  const context = pulse.context;
  const topTools = (summary?.tools ?? []).slice(0, 3);
  const activeMinutes = pulse.spark.filter((value) => value > 0).length;
  const running = pulse.status === "working" || pulse.status === "looping" || pulse.status === "blocked";
  const others = (collision: Collision) => collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ");
  const windows = windowsOf(limits, now);
  const hasFoot = Boolean(windows.length || model || git?.status === "ok" || collisions.length || pulse.cacheTrend?.dropped || (pulse.burn && running) || topTools.length);

  const open = () => onOpen(pulse.key);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  };

  return <article
    className={`card-bar status-${pulse.status}`}
    style={{ "--agent-color": provider.color } as CSSProperties}
    role="button"
    tabIndex={0}
    onClick={open}
    onKeyDown={onKey}
    aria-label={`${provider.name} : ${status.label}. ${t("Ouvrir le détail", "Open details")}`}
  >
    <div className="bar-main">
      <div className="bar-id">
        <ProviderMark provider={provider} />
        <div className="card-id">
          <b>{provider.name}</b>
          <span className="card-sub" title={place.full ?? undefined}><Folder size={11} />{place.label}{pulse.launchMode ? ` · ${pulse.launchMode}` : ""}</span>
        </div>
        {place.full && <button className="icon-button ghost" title={t("Ouvrir le dossier du projet", "Open the project folder")} aria-label={t("Ouvrir le dossier du projet", "Open the project folder")} onClick={(event) => { event.stopPropagation(); void revealFolder(place.full!); }} onKeyDown={(event) => event.stopPropagation()}><FolderOpen size={13} /></button>}
      </div>

      <span className="badge" title={status.explanation}><i />{status.label}</span>

      <div className={`bar-doing ${trouble ? "trouble" : `tone-${pulse.current?.tone ?? "info"}`}`}>
        {pulse.goal && <p className="goal" title={t("Dernier message que tu lui as envoyé", "The last message you sent it")}>« {pulse.goal.text} »</p>}
        <p className="doing-line"><span title={trouble ?? doing}>{trouble ?? doing}</span><time>{since(pulse.lastEventAt, now)}</time></p>
        {detail && <small title={detail}>{detail}</small>}
      </div>

      <dl className="bar-metrics">
        <div title={t("Tokens lus (cache compris) et écrits dans la session", "Tokens read (cache included) and written in the session")}>
          <dt>Tokens</dt><dd>{total === null ? <small>—</small> : compact(total)}</dd>
          <small>{tokens?.output != null ? t(`${compact(tokens.output)} écrits`, `${compact(tokens.output)} written`) : t("non rapporté", "not reported")}</small>
        </div>
        <div title={hit !== null ? t("Part du prompt servie par le cache du fournisseur : plus c’est haut, moins ça coûte.", "Share of the prompt served from the provider cache: higher means cheaper.") : t("Cet agent ne rapporte pas ses lectures de cache.", "This agent does not report cache reads.")}>
          <dt>Cache</dt><dd className={hit === null ? "" : hit >= 0.8 ? "good" : hit >= 0.4 ? "mid" : "low"}>{hit === null ? <small>—</small> : percent(hit)}</dd>
          <small>{hit === null ? t("non rapporté", "not reported") : pulse.cost?.saved != null ? t(`−${usd(pulse.cost.saved)}`, `−${usd(pulse.cost.saved)}`) : "\u00a0"}</small>
        </div>
        <div title={t("Estimation au tarif API des modèles vus. Un abonnement ne facture pas ainsi.", "Estimate at the API list price of the models seen. A subscription is not billed this way.")}>
          <dt>{t("Coût", "Cost")}</dt><dd>{pulse.cost ? <>{pulse.cost.partial ? "≥ " : "≈ "}{usd(pulse.cost.value)}</> : <small>—</small>}</dd>
          <small>{running && pulse.burn?.usdPerHour != null ? `≈ ${usd(pulse.burn.usdPerHour)}${t("/h", "/h")}` : "\u00a0"}</small>
        </div>
        <div title={context?.window ? `${compact(context.used)} / ${compact(context.window)}` : undefined}>
          <dt>{t("Contexte", "Context")}</dt><dd className={context ? `ctx-${context.state}` : ""}>{context && context.percent !== null ? percent(context.percent / 100) : <small>—</small>}</dd>
          <small className="ctx-mini">{context && context.percent !== null ? <i style={{ width: `${Math.min(100, Math.max(4, context.percent))}%` }} /> : "\u00a0"}</small>
        </div>
        <div title={t("Appels d’outils dans la session (et échecs)", "Tool calls in the session (and failures)")}>
          <dt>{t("Outils", "Tools")}</dt><dd>{session ? session.toolCalls : <small>—</small>}{session && session.failures > 0 && <em>{session.failures}✗</em>}</dd>
          <small>{session ? `${session.turns} ${session.turns > 1 ? t("tours", "turns") : t("tour", "turn")} · ${summary ? duration(summary.duration.value) : "—"}` : "\u00a0"}</small>
        </div>
      </dl>

      <div className="bar-activity" title={t("Événements par minute sur les 15 dernières minutes", "Events per minute over the last 15 minutes")}>
        <Bars values={pulse.spark} label={t("Activité des 15 dernières minutes", "Activity over the last 15 minutes")} />
        <small>{activeMinutes > 0 ? t(`${activeMinutes} min sur 15`, `${activeMinutes} of 15 min`) : t("calme", "quiet")}</small>
      </div>
    </div>

    {hasFoot && <div className="bar-foot">
      {windows.map((view) => <span key={view.label} className={`limit ${view.level}`} title={`${t("Limite d’abonnement", "Subscription limit")} ${view.label} · ${resetText(view.resetsAt, now)}`}>
        <b>{view.label}</b>
        <i><em style={{ width: `${Math.min(100, view.percent ?? 0)}%` }} /></i>
        {view.percent === null ? t("remise à zéro", "reset") : percent(view.percent / 100)}
      </span>)}
      {model && <span className={`chip model ${pulse.modelsSeen.length > 1 ? "mixed" : ""}`} title={modelTitle(pulse, configured)}>{shortModel(model)}{pulse.modelsSeen.length > 1 ? ` +${pulse.modelsSeen.length - 1}` : ""}</span>}
      {pulse.turnStartedAt !== null && <span className="chip ghost"><Clock3 size={10} />{t("tour", "turn")} {duration(now - pulse.turnStartedAt)}</span>}
      {git?.status === "ok" && <span className="git" title={git.snapshot.changed_files.slice(0, 12).map((file) => `${file.status} ${file.path}`).join("\n") || t("Arbre de travail propre", "Clean working tree")}>
        <GitBranch size={12} /><b>{git.snapshot.branch ?? t("tête détachée", "detached HEAD")}</b>
        {(git.snapshot.ahead ?? 0) > 0 && <span className="up"><ArrowUp size={11} />{git.snapshot.ahead}</span>}
        {(git.snapshot.behind ?? 0) > 0 && <span className="down"><ArrowDown size={11} />{git.snapshot.behind}</span>}
        <span className={git.snapshot.changed_total ? "dirty" : "clean"}><Pencil size={11} />{git.snapshot.changed_total ? t(`${git.snapshot.changed_total} modifié(s)`, `${git.snapshot.changed_total} changed`) : t("propre", "clean")}</span>
      </span>}
      {pulse.burn && running && <span className="burn" title={t("Rythme sur les 15 dernières minutes", "Pace over the last 15 minutes")}><Flame size={12} />{compact(pulse.burn.tokensPerMin)} {t("tokens/min", "tokens/min")}{spend ? ` · ${t("ce tour", "this turn")} ${spend}` : ""}</span>}
      {pulse.cacheTrend?.dropped && <span className="cache-drop" title={t("Le taux de cache vient de chuter : le début du prompt a changé (ou le cache a expiré) et tout est relu au plein tarif.", "The cache hit rate just fell: the start of the prompt changed (or the cache expired) and everything is read at full price.")}><TriangleAlert size={12} />{t(`cache en chute : ${percent(pulse.cacheTrend.before ?? 0)} → ${percent(pulse.cacheTrend.last)}`, `cache falling: ${percent(pulse.cacheTrend.before ?? 0)} → ${percent(pulse.cacheTrend.last)}`)}</span>}
      {collisions.map((collision) => <span key={`${collision.kind}:${collision.path}`} className="collision" title={collision.path}>
        <TriangleAlert size={12} />
        {collision.kind === "file"
          ? t(`Même fichier que ${others(collision)} : ${collision.path.split(/[\\/]/).filter(Boolean).at(-1)}`, `Same file as ${others(collision)}: ${collision.path.split(/[\\/]/).filter(Boolean).at(-1)}`)
          : t(`Même projet que ${others(collision)}`, `Same project as ${others(collision)}`)}
      </span>)}
      {topTools.map((tool) => <span key={tool.name ?? "?"} className={`tool-chip ${tool.failed ? "has-fail" : ""}`} title={tool.failed ? t(`${tool.failed} échec(s)`, `${tool.failed} failure(s)`) : undefined}>{tool.name ?? "?"}<b>{tool.count}</b></span>)}
    </div>}

    {segments.some((segment) => segment.value > 0) && <Stack segments={segments} label={t("Répartition des tokens", "Token breakdown")} />}
  </article>;
}
