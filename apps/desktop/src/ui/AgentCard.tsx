import type { CSSProperties, KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Clock3, FilePen, Flame, Folder, FolderOpen, GitBranch, MessagesSquare, Pencil, TriangleAlert, Wrench } from "lucide-react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import type { Collision } from "./analysis";
import { t } from "./i18n";
import { cacheHitRate, compact, duration, percent, shortModel, usd } from "./insights";
import { ProviderMark } from "./ProviderBadges";
import { agentName, providerFor, providers } from "./providers";
import { Area, Bars, Stack, type Segment } from "./Spark";
import { useConfiguredModels } from "./useConfiguredModels";
import { revealFolder, type GitState } from "./useGit";

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

export function modelTitle(pulse: AgentPulse, configured: string | null | undefined) {
  if (pulse.modelsSeen.length > 1) return t(`Modèle de la dernière réponse. Dans cette session : ${pulse.modelsSeen.join(", ")}.`, `Model of the latest response. In this session: ${pulse.modelsSeen.join(", ")}.`);
  if (pulse.model) return t("Modèle de la dernière réponse", "Model of the latest response");
  return configured ? t("Modèle choisi dans les réglages de l’agent ; aucune réponse encore observée", "Model selected in the agent’s settings; no response observed yet") : "";
}

/**
 * Une carte : qui, son état, ce qu'il fait, et tout ce qu'on sait de sa session — activité, tokens
 * et cache, coût estimé, contexte, outils. Un clic ouvre le détail.
 */
export function AgentCard({ pulse, now, onOpen, git, collisions }: { pulse: AgentPulse; now: number; onOpen: (key: string) => void; git?: GitState; collisions: Collision[] }) {
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
  const topTools = (summary?.tools ?? []).slice(0, 4);
  const activeMinutes = pulse.spark.filter((value) => value > 0).length;

  const open = () => onOpen(pulse.key);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  };

  return <article
    className={`card status-${pulse.status}`}
    style={{ "--agent-color": provider.color } as CSSProperties}
    role="button"
    tabIndex={0}
    onClick={open}
    onKeyDown={onKey}
    aria-label={`${provider.name} : ${status.label}. ${t("Ouvrir le détail", "Open details")}`}
  >
    <header className="card-head">
      <ProviderMark provider={provider} />
      <div className="card-id">
        <b>{provider.name}</b>
        <span className="card-sub" title={place.full ?? undefined}><Folder size={11} />{place.label}{pulse.launchMode ? ` · ${pulse.launchMode}` : ""}</span>
      </div>
      {place.full && <button className="icon-button ghost" title={t("Ouvrir le dossier du projet", "Open the project folder")} aria-label={t("Ouvrir le dossier du projet", "Open the project folder")} onClick={(event) => { event.stopPropagation(); void revealFolder(place.full!); }} onKeyDown={(event) => event.stopPropagation()}><FolderOpen size={13} /></button>}
      <span className="badge" title={status.explanation}><i />{status.label}</span>
    </header>

    {pulse.goal && <p className="goal" title={t("Dernier message que tu lui as envoyé", "The last message you sent it")}>« {pulse.goal.text} »</p>}

    <div className={`card-doing ${trouble ? "trouble" : `tone-${pulse.current?.tone ?? "info"}`}`}>
      <p><span>{trouble ?? doing}</span><time>{since(pulse.lastEventAt, now)}</time></p>
      {detail && <small>{detail}</small>}
    </div>

    {collisions.length > 0 && <ul className="collisions">
      {collisions.map((collision) => <li key={`${collision.kind}:${collision.path}`} title={collision.path}>
        <TriangleAlert size={12} />
        {collision.kind === "file"
          ? t(`Même fichier que ${collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ")} : ${collision.path.split(/[\\/]/).filter(Boolean).at(-1)}`, `Same file as ${collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ")}: ${collision.path.split(/[\\/]/).filter(Boolean).at(-1)}`)
          : t(`Même projet que ${collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ")}`, `Same project as ${collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ")}`)}
      </li>)}
    </ul>}

    {git?.status === "ok" && <p className="git" title={git.snapshot.changed_files.slice(0, 12).map((file) => `${file.status} ${file.path}`).join("\n") || t("Arbre de travail propre", "Clean working tree")}>
      <GitBranch size={12} /><b>{git.snapshot.branch ?? t("tête détachée", "detached HEAD")}</b>
      {(git.snapshot.ahead ?? 0) > 0 && <span className="up"><ArrowUp size={11} />{git.snapshot.ahead}</span>}
      {(git.snapshot.behind ?? 0) > 0 && <span className="down"><ArrowDown size={11} />{git.snapshot.behind}</span>}
      <span className={git.snapshot.changed_total ? "dirty" : "clean"}><Pencil size={11} />{git.snapshot.changed_total ? t(`${git.snapshot.changed_total} modifié(s)`, `${git.snapshot.changed_total} changed`) : t("propre", "clean")}</span>
    </p>}

    {model && <div className="card-models">
      <span className={`chip model ${pulse.modelsSeen.length > 1 ? "mixed" : ""}`} title={modelTitle(pulse, configured)}>{shortModel(model)}{pulse.modelsSeen.length > 1 ? ` +${pulse.modelsSeen.length - 1}` : ""}</span>
      {pulse.turnStartedAt !== null && <span className="chip ghost"><Clock3 size={10} />{t("tour", "turn")} {duration(now - pulse.turnStartedAt)}</span>}
    </div>}

    {session && <dl className="stats">
      <div title={t("Tours de conversation dans la session", "Conversation turns in the session")}><dt><MessagesSquare size={12} />{t("Tours", "Turns")}</dt><dd>{session.turns}</dd></div>
      <div title={t("Appels d’outils dans la session", "Tool calls in the session")}><dt><Wrench size={12} />{t("Outils", "Tools")}</dt><dd>{session.toolCalls}{session.failures > 0 && <em title={t("échecs", "failures")}>{session.failures}✗</em>}</dd></div>
      <div title={t("Fichiers différents modifiés", "Distinct files edited")}><dt><FilePen size={12} />{t("Fichiers", "Files")}</dt><dd>{session.filesChanged}</dd></div>
      <div title={t("Depuis le premier événement de la session", "Since the first event of the session")}><dt><Clock3 size={12} />{t("Durée", "Time")}</dt><dd>{summary ? duration(summary.duration.value) : "—"}</dd></div>
    </dl>}

    <section className="usage" aria-label={t("Tokens et cache", "Tokens and cache")}>
      <div className="usage-top">
        <span className="usage-total">{total === null ? <small>{t("tokens non rapportés", "tokens not reported")}</small> : <>{compact(total)}<small> tokens</small></>}</span>
        {hit !== null
          ? <span className={`hit ${hit >= 0.8 ? "good" : hit >= 0.4 ? "mid" : "low"}`} title={t("Part du prompt servie par le cache du fournisseur : plus c’est haut, moins ça coûte.", "Share of the prompt served from the provider cache: higher means cheaper.")}>{t("cache", "cache")} <b>{percent(hit)}</b></span>
          : tokens && <span className="hit unknown" title={t("Cet agent ne rapporte pas ses lectures de cache.", "This agent does not report cache reads.")}>{t("cache non rapporté", "cache not reported")}</span>}
      </div>
      {pulse.cacheTrend?.dropped && <p className="cache-drop" title={t("Le taux de cache vient de chuter : le début du prompt a changé (ou le cache a expiré) et tout est relu au plein tarif.", "The cache hit rate just fell: the start of the prompt changed (or the cache expired) and everything is read at full price.")}><TriangleAlert size={12} />{t(`cache en chute : ${percent(pulse.cacheTrend.before ?? 0)} → ${percent(pulse.cacheTrend.last)}`, `cache falling: ${percent(pulse.cacheTrend.before ?? 0)} → ${percent(pulse.cacheTrend.last)}`)}</p>}
      <Stack segments={segments} label={t("Répartition des tokens", "Token breakdown")} />
      {tokens && <ul className="legend">
        {segments.filter((segment) => segment.value > 0).map((segment) => <li key={segment.key} className={segment.className}><i />{segment.short}<b>{compact(segment.value)}</b></li>)}
      </ul>}
      {pulse.burn && (pulse.status === "working" || pulse.status === "looping" || pulse.status === "blocked") && <p className="burn" title={t("Rythme sur les 15 dernières minutes", "Pace over the last 15 minutes")}><Flame size={12} />{compact(pulse.burn.tokensPerMin)} {t("tokens/min", "tokens/min")}{pulse.burn.usdPerHour !== null ? ` · ≈ ${usd(pulse.burn.usdPerHour)}${t("/h", "/h")}` : ""}{spend ? ` · ${t("ce tour", "this turn")} ${spend}` : ""}</p>}
      {pulse.cost && <p className="money">
        <span title={t("Estimation au tarif API des modèles vus. Un abonnement ne facture pas ainsi.", "Estimate at the API list price of the models seen. A subscription is not billed this way.")}>{t("coût", "cost")} ≈ <b>{pulse.cost.partial ? "≥ " : ""}{usd(pulse.cost.value)}</b></span>
        {pulse.cost.saved !== null && <span className="saved" title={t(`Sans cache, la même session aurait coûté ≈ ${usd(pulse.cost.withoutCache ?? 0)}.`, `Without caching, the same session would have cost ≈ ${usd(pulse.cost.withoutCache ?? 0)}.`)}>{t("cache : −", "cache: −")}<b>{usd(pulse.cost.saved)}</b></span>}
      </p>}
    </section>

    {context && context.percent !== null && <section className={`ctx state-${context.state}`} aria-label={t("Contexte", "Context")}>
      <div className="ctx-top">
        <span>{t("contexte", "context")} <b>{Math.round(context.percent)}%</b><small> · {compact(context.used)}{context.window ? ` / ${compact(context.window)}` : ""}</small></span>
        {context.compactions > 0 && <span className="chip ghost" title={t("L’agent a résumé sa conversation pour libérer du contexte.", "The agent summarised its conversation to free up context.")}>{t(`compacté ×${context.compactions}`, `compacted ×${context.compactions}`)}</span>}
      </div>
      <div className="ctx-bar" role="img" aria-label={t(`Contexte rempli à ${Math.round(context.percent)} %`, `Context ${Math.round(context.percent)}% full`)}><i style={{ width: `${Math.min(100, Math.max(2, context.percent))}%` }} /></div>
    </section>}

    <div className="activity" title={t("Événements par minute sur les 15 dernières minutes", "Events per minute over the last 15 minutes")}>
      <Bars values={pulse.spark} label={t("Activité des 15 dernières minutes", "Activity over the last 15 minutes")} />
      <small>{activeMinutes > 0 ? t(`actif ${activeMinutes} min sur 15`, `active ${activeMinutes} of the last 15 min`) : t("rien depuis 15 min", "nothing in 15 min")}</small>
    </div>

    {topTools.length > 0 && <ul className="tools" aria-label={t("Outils les plus utilisés", "Most used tools")}>
      {topTools.map((tool) => <li key={tool.name ?? "?"} className={tool.failed ? "has-fail" : ""} title={tool.failed ? t(`${tool.failed} échec(s)`, `${tool.failed} failure(s)`) : undefined}>{tool.name ?? "?"}<b>{tool.count}</b></li>)}
      {(summary?.tools.length ?? 0) > topTools.length && <li className="more">+{(summary?.tools.length ?? 0) - topTools.length}</li>}
    </ul>}

    {context && context.series.length > 1 && <div className="ctx-spark" style={{ color: "var(--agent-color)" }} title={t("Taille de chaque requête au fil de la session", "Size of each request over the session")}>
      <Area values={context.series} label={t("Taille du contexte au fil de la session", "Context size over the session")} />
    </div>}
  </article>;
}
