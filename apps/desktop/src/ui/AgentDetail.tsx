import { useEffect, type CSSProperties } from "react";
import { FolderOpen, X } from "lucide-react";
import type { AgentPulse } from "./agentPulse";
import type { Collision } from "./analysis";
import { statusInfo, since, placeOf, tokenSegments } from "./AgentBar";
import { locale, t } from "./i18n";
import { cacheCounts, cacheHitRate, compact, duration, percent, usd } from "./insights";
import { ProviderMark } from "./ProviderBadges";
import { agentName, providerFor, providers } from "./providers";
import { revealFolder, type GitState } from "./useGit";
import { resetText, windowsOf } from "./limitsView";
import type { LimitSnapshot } from "./useLimits";
import { Area, Stack } from "./Spark";
import { usePastSessions } from "./usePastSessions";

const fallback = providers.find((provider) => provider.eventKey === "custom")!;

const originLabel = (origin: string) => origin === "provider" ? t("rapporté", "reported") : origin === "estimated" ? t("estimé", "estimated") : origin === "derived" ? t("calculé", "derived") : t("observé", "observed");

/**
 * Le détail d'un agent : tout ce qu'on sait de sa session en cours, sans rien inventer.
 * Chaque chiffre dit d'où il vient (rapporté par l'agent, calculé, estimé).
 */
export function AgentDetail({ pulse, now, onClose, git, collisions, limits }: { pulse: AgentPulse; now: number; onClose: () => void; git?: GitState; collisions: Collision[]; limits?: LimitSnapshot }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const provider = providerFor(pulse.key) ?? fallback;
  const status = statusInfo(pulse.status);
  const summary = pulse.summary;
  const tokens = summary?.tokens ?? null;
  const hit = cacheHitRate(tokens);
  const counts = cacheCounts(tokens);
  const promptAll = tokens ? (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0) : 0;
  const place = placeOf(pulse.project);
  const segments = tokenSegments(pulse);
  const context = pulse.context;
  const cost = summary?.cost ?? null;
  const past = usePastSessions(pulse.key, pulse.session?.id ?? null);

  return <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="sheet detail" style={{ "--agent-color": provider.color } as CSSProperties} role="dialog" aria-modal="true" aria-label={provider.name}>
      <div className="sheet-head">
        <span className="detail-title">
          <ProviderMark provider={provider} />
          <span><b>{provider.name}</b><small>{place.full ?? place.label}</small></span>
        </span>
        <span className="detail-actions">
          {place.full && <button className="button small" onClick={() => void revealFolder(place.full!)}><FolderOpen size={12} />{t("Ouvrir le dossier", "Open folder")}</button>}
          <span className={`badge status-${pulse.status}`}><i />{status.label}</span>
          <button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")}><X size={15} /></button>
        </span>
      </div>

      {pulse.goal && <section><h3>{t("Dernière demande", "Latest request")}</h3><p className="goal big">« {pulse.goal.text} »</p></section>}
      {!pulse.goal && summary && <p className="hint">{t("Pour voir ici ce que tu as demandé à l’agent, active « Le texte de mes messages » dans les Réglages.", "To see what you asked the agent here, turn on “The text of my messages” in Settings.")}</p>}

      {collisions.length > 0 && <section>
        <h3>{t("Collisions", "Collisions")}</h3>
        <ul className="collisions big">{collisions.map((collision) => <li key={`${collision.kind}:${collision.path}`}><code>{collision.path}</code><span>{collision.kind === "file" ? t("modifié aussi par", "also edited by") : t("projet partagé avec", "project shared with")} {collision.agents.filter((agent) => agent !== pulse.key).map(agentName).join(", ")}</span></li>)}</ul>
      </section>}

      {git?.status === "ok" && <section>
        <h3>{t("Dépôt git", "Git repository")}</h3>
        <dl className="kv">
          <div><dt>{t("Branche", "Branch")}</dt><dd>{git.snapshot.branch ?? t("tête détachée", "detached HEAD")}</dd></div>
          <div><dt>{t("Avance / retard", "Ahead / behind")}</dt><dd>{git.snapshot.ahead === null ? t("pas d’amont", "no upstream") : `↑${git.snapshot.ahead} ↓${git.snapshot.behind ?? 0}`}</dd></div>
          <div><dt>{t("Fichiers modifiés", "Changed files")}</dt><dd>{git.snapshot.changed_total}</dd></div>
          <div><dt>{t("Dépôt", "Repository")}</dt><dd><small>{git.snapshot.root}</small></dd></div>
        </dl>
        {git.snapshot.changed_files.length > 0 && <ul className="files">{git.snapshot.changed_files.slice(0, 10).map((file) => <li key={file.path} className={file.status === "??" ? "" : "changed"}><span title={file.path}>{file.path}</span><em>{file.status === "??" ? t("nouveau", "new") : file.status}</em><b /></li>)}</ul>}
        {git.snapshot.changed_total > 10 && <p className="hint">{t(`+ ${git.snapshot.changed_total - 10} autres`, `+ ${git.snapshot.changed_total - 10} more`)}</p>}
        {git.snapshot.recent_commits.length > 0 && <ol className="timeline">{git.snapshot.recent_commits.map((commit) => <li key={commit.short_id}><time>{commit.relative_time}</time><span>{commit.subject}<small>{commit.short_id}</small></span></li>)}</ol>}
      </section>}

      {(limits || pulse.key === "codex" || pulse.key === "claude_code") && <section>
        <h3>{t("Limites de l’abonnement", "Subscription limits")}{limits?.plan ? <small> {limits.plan}</small> : null}</h3>
        {limits ? <>
          <ul className="limits">{windowsOf(limits, now).map((view) => <li key={view.label} className={view.level}>
            <span>{t(`Fenêtre de ${view.label}`, `${view.label} window`)}</span>
            <b>{view.percent === null ? "—" : percent(view.percent / 100)}</b>
            <i><em style={{ width: `${Math.min(100, view.percent ?? 0)}%` }} /></i>
            <small>{view.percent === null ? t("Remise à zéro depuis ce relevé : nouveau pourcentage à la prochaine requête.", "Reset since this reading: new percentage at the next request.") : resetText(view.resetsAt, now)}</small>
          </li>)}</ul>
          <p className="hint">{t(`Rapporté par ${agentName(pulse.key)} ${since(Date.parse(limits.observed_at), now)}. Ce sont ses chiffres, pas une estimation.`, `Reported by ${agentName(pulse.key)} ${since(Date.parse(limits.observed_at), now)}. These are its own figures, not an estimate.`)}</p>
        </> : <p className="hint">{pulse.key === "codex"
          ? t("Codex écrit ses limites avec chaque requête : elles apparaîtront à la prochaine (abonnement ChatGPT seulement, pas avec une clé d’API).", "Codex writes its limits with each request: they will show up at the next one (ChatGPT plan only, not with an API key).")
          : t("Claude Code ne donne ses limites qu’à sa barre d’état (abonnés Pro et Max). Pour les voir ici, ajoute la barre d’état facultative : Réglages → Claude Code.", "Claude Code only hands its limits to its status line (Pro and Max subscribers). To see them here, add the optional status line: Settings → Claude Code.")}</p>}
      </section>}

      {!summary && <p className="hint">{t("Aucune session observée pour cet agent.", "No session observed for this agent.")}</p>}

      {summary && <>
        <section>
          <h3>{t("Vue d’ensemble de la session", "Session overview")}</h3>
          <p className="hint">{t("Calculé sur les événements de cette session que l’app a observés.", "Computed from the events of this session that the app observed.")}</p>
          <div className="overview">
            <div>
              <span className="k">{t("Requêtes", "Requests")}</span>
              <strong className="v">{tokens ? tokens.usageEvents : "—"}</strong>
              <p>{t("Réponses du modèle qui ont rapporté leur usage.", "Model responses that reported usage.")}</p>
            </div>
            <div>
              <span className="k">Tokens</span>
              <strong className="v">{tokens ? compact(promptAll + (tokens.output ?? 0)) : "—"}</strong>
              <p>{tokens ? t(`Entrée ${compact(promptAll)} · sortie ${tokens.output === null ? "—" : compact(tokens.output)}`, `In ${compact(promptAll)} · out ${tokens.output === null ? "—" : compact(tokens.output)}`) : t("non rapporté", "not reported")}</p>
            </div>
            <div title={counts ? `Hit ${counts.hit.toLocaleString()} · Miss ${counts.miss.toLocaleString()}` : undefined}>
              <span className="k">{t("Taux de cache", "Cache hit")}</span>
              <strong className={`v ${hit === null ? "" : hit >= 0.8 ? "good" : hit >= 0.4 ? "mid" : "low"}`}>{hit === null ? "—" : percent(hit)}</strong>
              <p>{counts ? t(`lus ÷ (lus + manqués) · ${counts.hit.toLocaleString()} lus, ${counts.miss.toLocaleString()} manqués`, `hit ÷ (hit + miss) · ${counts.hit.toLocaleString()} hit, ${counts.miss.toLocaleString()} missed`) : t("Cet agent ne rapporte pas son cache.", "This agent does not report its cache.")}</p>
            </div>
            <div>
              <span className="k">{t("Temps de travail", "Work time")}</span>
              <strong className="v">{pulse.workMs === null ? "—" : duration(pulse.workMs)}</strong>
              <p>{pulse.workMs === null ? t("Cet agent ne marque pas ses tours.", "This agent does not mark its turns.") : t("Somme des tours, attentes d’outil et d’approbation comprises ; pas les pauses entre deux tours.", "Sum of the turns, tool and approval waits included; not the pauses between turns.")}</p>
            </div>
            <div>
              <span className="k">{t("Coût estimé", "Estimated cost")}</span>
              <strong className="v">{pulse.cost ? `${pulse.cost.partial ? "≥ " : "≈ "}${usd(pulse.cost.value)}` : "—"}</strong>
              <p>{t("Au tarif API public des modèles vus.", "At the public API price of the models seen.")}</p>
            </div>
            {context && context.window ? <div>
              <span className="k">{t("Fenêtre de contexte", "Context window")}</span>
              <strong className={`v ctx-${context.state}`}>{context.percent !== null ? percent(context.percent / 100) : "—"}</strong>
              <p>{t(`${compact(context.used)} utilisés sur ${compact(context.window)} : ce que la prochaine requête emporterait, une lecture, pas un cumul.`, `${compact(context.used)} used of ${compact(context.window)}: what the next request would carry, a reading, not a running total.`)}</p>
            </div> : <div><span className="k">{t("Fenêtre de contexte", "Context window")}</span><strong className="v">—</strong><p>{t("Non rapportée par cet agent.", "Not reported by this agent.")}</p></div>}
          </div>
        </section>

        <section>
          <h3>{t("Session", "Session")}</h3>
          <dl className="kv">
            <div><dt>{t("Dernière activité", "Last activity")}</dt><dd>{since(pulse.lastEventAt, now)}</dd></div>
            <div><dt>{t("Durée", "Duration")}</dt><dd>{duration(summary.duration.value)} <small>({originLabel(summary.duration.origin)})</small></dd></div>
            <div><dt>{t("Tours", "Turns")}</dt><dd>{summary.turns.count}</dd></div>
            <div><dt>{t("Événements", "Events")}</dt><dd>{summary.eventCount}</dd></div>
            <div><dt>{t("Fichiers modifiés", "Files edited")}</dt><dd>{pulse.session?.filesChanged ?? 0}</dd></div>
            <div><dt>{t("Échecs d’outils", "Tool failures")}</dt><dd className={summary.failures.count ? "bad" : ""}>{summary.failures.count}{summary.failures.tools.length ? <small> ({summary.failures.tools.join(", ")})</small> : null}</dd></div>
          </dl>
        </section>

        {past && past.length > 0 && <section>
          <h3>{t("Sessions précédentes", "Earlier sessions")} <small>{past.length}</small></h3>
          <table className="past-sessions"><thead><tr>
            <th>{t("Début", "Started")}</th>
            <th className="num" title={t("Du premier au dernier événement observé", "From the first to the last observed event")}>{t("Durée", "Span")}</th>
            <th>{t("Projet", "Project")}</th>
            <th className="num">{t("Outils", "Tools")}</th>
            <th className="num">Tokens</th>
            <th className="num">{t("Coût", "Cost")}</th>
          </tr></thead>
            <tbody>{past.map((session) => <tr key={session.id}>
              <td>{new Date(session.startedAt).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="num">{duration(session.observedMs)}</td>
              <td title={session.project ?? undefined}>{session.project ? placeOf({ project_path: session.project, file_path: null }).label : "—"}</td>
              <td className={`num ${session.failures ? "bad" : ""}`} title={session.failures ? t(`${session.failures} échec(s)`, `${session.failures} failed`) : undefined}>{session.toolCalls}{session.failures ? <small> · {session.failures}✕</small> : null}</td>
              <td className="num">{session.tokens === null ? "—" : compact(session.tokens)}</td>
              <td className="num">{session.cost ? `${session.cost.partial ? "≥ " : "≈ "}${usd(session.cost.value)}` : "—"}</td>
            </tr>)}</tbody></table>
          <p className="hint">{t("Lues dans la base locale : les 20 plus récentes, dans la limite de la durée de conservation choisie.", "Read from the local database: the 20 most recent, within the retention period you chose.")}</p>
        </section>}

        <section>
          <h3>{t("Tokens, cache et coût", "Tokens, cache and cost")}</h3>
          {!tokens && <p className="hint">{t("Cet agent ne rapporte pas ses tokens.", "This agent does not report its tokens.")}</p>}
          {tokens && <>
            <Stack segments={segments} label={t("Répartition des tokens", "Token breakdown")} />
            <dl className="kv">
              <div className="tok-cache"><dt><i />{t("Lus depuis le cache", "Read from cache")}</dt><dd>{tokens.cacheRead === null ? t("non rapporté", "not reported") : compact(tokens.cacheRead)}</dd></div>
              <div className="tok-write"><dt><i />{t("Écrits dans le cache", "Written to cache")}</dt><dd>{tokens.cacheWrite === null ? t("non rapporté", "not reported") : compact(tokens.cacheWrite)}</dd></div>
              <div className="tok-new"><dt><i />{t("Entrée nouvelle", "New input")}</dt><dd>{tokens.input === null ? "—" : compact(tokens.input)}</dd></div>
              <div className="tok-out"><dt><i />{t("Sortie", "Output")}</dt><dd>{tokens.output === null ? "—" : compact(tokens.output)}</dd></div>
            </dl>
          </>}
          {pulse.cost && <dl className="kv money-kv">
            <div><dt>{t("Coût estimé", "Estimated cost")}</dt><dd><b>{pulse.cost.partial ? "≥ " : "≈ "}{usd(pulse.cost.value)}</b></dd></div>
            {pulse.cost.withoutCache !== null && <div><dt>{t("Sans cache", "Without cache")}</dt><dd>≈ {usd(pulse.cost.withoutCache)}</dd></div>}
            {pulse.cost.saved !== null && <div><dt>{t("Économisé par le cache", "Saved by the cache")}</dt><dd className="good"><b>≈ {usd(pulse.cost.saved)}</b></dd></div>}
          </dl>}
          {cost && <p className="hint">{t("Estimation au tarif API public de chaque modèle vu — pas ce qu’un abonnement te facture. Prix :", "Estimate at each model’s public API price — not what a subscription bills you. Prices:")} {cost.prices.map((price) => `${price.label} ${price.inputPerMTok}/${price.outputPerMTok} $/M`).join(" · ")}.{cost.unpricedEvents > 0 ? ` ${t(`${cost.unpricedEvents} requête(s) non chiffrée(s) : ${cost.unpricedModels.join(", ")}.`, `${cost.unpricedEvents} request(s) not priced: ${cost.unpricedModels.join(", ")}.`)}` : ""}</p>}
          {summary && !cost && tokens && <p className="hint">{t("Pas d’estimation : le modèle de cet agent n’est pas dans la table des prix.", "No estimate: this agent’s model is not in the price table.")}</p>}
        </section>

        {pulse.cacheTrend && <section>
          <h3>{t("Tendance du cache", "Cache trend")}</h3>
          <dl className="kv">
            <div><dt>{t("Dernière requête", "Latest request")}</dt><dd>{percent(pulse.cacheTrend.last)}</dd></div>
            <div><dt>{t("Effondrements", "Collapses")}</dt><dd className={pulse.cacheTrend.drops ? "bad" : ""}>{pulse.cacheTrend.drops}</dd></div>
          </dl>
          <div className="ctx-spark tall" style={{ color: "var(--tok-cache)" }}><Area values={pulse.cacheTrend.series} ceiling={1} label={t("Taux de cache à chaque requête", "Cache hit rate at each request")} /></div>
          <p className="hint">{pulse.cacheTrend.dropped ? t("Le taux vient de chuter : le début du prompt a changé ou le cache a expiré, et tout est relu au plein tarif.", "The rate just fell: the start of the prompt changed or the cache expired, and everything is read at full price.") : t("Un effondrement veut dire que le début du prompt a changé (ou que le cache a expiré) : tout est alors relu au plein tarif.", "A collapse means the start of the prompt changed (or the cache expired): everything is then read at full price.")}</p>
        </section>}

        {pulse.burn && <section>
          <h3>{t("Rythme", "Pace")}</h3>
          <dl className="kv">
            <div><dt>{t("Tokens par minute", "Tokens per minute")}</dt><dd>{compact(pulse.burn.tokensPerMin)}</dd></div>
            <div><dt>{t("Dollars par heure", "Dollars per hour")}</dt><dd>{pulse.burn.usdPerHour === null ? "—" : `≈ ${usd(pulse.burn.usdPerHour)}`}</dd></div>
            {pulse.turnSpend && <div><dt>{t("Tour en cours", "Open turn")}</dt><dd>{pulse.turnSpend.partial ? "≥ " : "≈ "}{usd(pulse.turnSpend.value)}</dd></div>}
          </dl>
          <p className="hint">{t("Sur les 15 dernières minutes (ou depuis le début de la session si elle est plus jeune).", "Over the last 15 minutes (or since the session began if it is younger).")}</p>
        </section>}

        {context && <section>
          <h3>{t("Contexte", "Context")}</h3>
          <dl className="kv">
            <div><dt>{t("Dernière requête", "Latest request")}</dt><dd>{compact(context.used)}{context.window ? ` / ${compact(context.window)}` : ""}{context.percent !== null ? <b> · {percent(context.percent / 100)}</b> : null}</dd></div>
            {context.windowSource && <div><dt>{t("Taille de la fenêtre", "Window size")}</dt><dd><small>{context.windowSource === "reported" ? t("rapportée par l’agent", "reported by the agent") : context.windowSource === "table" ? t("d’après la table des modèles connus", "from the table of known models") : t("déduite de la taille observée", "inferred from the observed size")}</small></dd></div>}
            <div><dt>{t("Compactions", "Compactions")}</dt><dd>{context.compactions}</dd></div>
            {context.cachedShare !== null && <div><dt>{t("Servi par le cache", "Served from cache")}</dt><dd>{percent(context.cachedShare)}</dd></div>}
          </dl>
          {context.series.length > 1 && <div className="ctx-spark tall" style={{ color: "var(--agent-color)" }}><Area values={context.series} label={t("Taille du contexte au fil de la session", "Context size over the session")} /></div>}
        </section>}

        {summary.models.length > 0 && <section>
          <h3>{t("Modèles", "Models")}</h3>
          <table><thead><tr><th>{t("Modèle", "Model")}</th><th className="num">{t("Réponses", "Responses")}</th><th>{t("Source", "Source")}</th></tr></thead>
            <tbody>{summary.models.map((model) => <tr key={model.name}><td><code>{model.name}</code></td><td className="num">{model.events}</td><td>{model.origins.map(originLabel).join(", ")}</td></tr>)}</tbody></table>
        </section>}

        {summary.tools.length > 0 && <section>
          <h3>{t("Outils", "Tools")}</h3>
          <table><thead><tr><th>{t("Outil", "Tool")}</th><th className="num">{t("Appels", "Calls")}</th><th className="num">{t("Échecs", "Failed")}</th><th /></tr></thead>
            <tbody>{summary.tools.slice(0, 12).map((tool) => <tr key={tool.name ?? "?"}><td>{tool.name ?? "?"}</td><td className="num">{tool.count}</td><td className={`num ${tool.failed ? "bad" : ""}`}>{tool.failed || "·"}</td><td className="bar-cell"><i style={{ width: `${Math.max(4, (tool.count / summary.tools[0].count) * 100)}%` }} /></td></tr>)}</tbody></table>
        </section>}

        {summary.files.length > 0 && <section>
          <h3>{t("Fichiers touchés", "Files touched")} <small>{summary.files.length}</small></h3>
          <ul className="files">
            {summary.files.slice(0, 14).map((file) => <li key={file.path} className={file.changed ? "changed" : ""}><span title={file.path}>{file.path}</span><em>{file.changed ? t("modifié", "edited") : t("lu", "read")}</em><b>{file.events}</b></li>)}
          </ul>
          {summary.files.length > 14 && <p className="hint">{t(`+ ${summary.files.length - 14} autres fichiers`, `+ ${summary.files.length - 14} more files`)}</p>}
        </section>}

        {pulse.timeline.length > 0 && <section>
          <h3>{t("Chronologie", "Timeline")}</h3>
          <ol className="timeline">
            {pulse.timeline.map((action) => <li key={action.id} className={`tone-${action.tone}`}><time>{since(action.at, now)}</time><span>{action.text}{action.detail ? <small>{action.detail}</small> : null}</span></li>)}
          </ol>
        </section>}
      </>}
    </aside>
  </div>;
}
