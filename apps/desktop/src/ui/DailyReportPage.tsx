import { RefreshCw } from "lucide-react";
import { formatCompact } from "./analytics";
import { buildDailyReport, reportMetricTokens } from "./dailyReport";
import { SectionHeader } from "./Explain";
import { locale, t } from "./i18n";
import { providerFor } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

/** What the last 24 hours looked like: a few facts in plain words, then the numbers behind them. */
export function DailyReportPage({ events, hasMore }: { events: SessionEvent[]; hasMore: boolean }) {
  const now = useNow(30_000);
  const report = buildDailyReport(events, now);
  const maxHour = Math.max(1, ...report.hourly.map((bucket) => bucket.count));
  return <div className="page daily-report">
    <section className="page-section">
      <SectionHeader
        title={t("Rapport 24 h", "24 h report")}
        description={t("Les faits de la journée, tirés des événements collectés ici. Rien n’est inventé par un modèle.", "The day’s facts, from the events collected here. Nothing is made up by a model.")}
        details={t("Un résumé en mots simples, puis les chiffres : agents, modèles, outils, fichiers et cadence par heure. Un rappel te prévient une fois par jour si les notifications sont activées.", "A summary in plain words, then the numbers: agents, models, tools, files and activity per hour. A reminder tells you once a day if notifications are on.")}
        actions={<><span className="report-period">{new Date(report.from).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} → {t("maintenant", "now")}</span><button className="icon-button" onClick={() => window.location.reload()} aria-label={t("Rafraîchir le rapport", "Refresh the report")} title={t("Rafraîchir le rapport", "Refresh the report")}><RefreshCw size={13} /></button></>}
      />
      {hasMore && <p className="notice warn">{t("La fenêtre locale contient plus d’événements que ceux chargés : le rapport est exact sur les événements présents. Charge l’historique depuis Sessions pour le compléter.", "The local window holds more events than are loaded: the report is exact on the events present. Load older history from Sessions to complete it.")}</p>}
      <dl className="report-kpis">
        <Kpi label={t("Événements", "Events")} value={formatCompact(report.events.length)} />
        <Kpi label="Sessions" value={formatCompact(report.sessions)} />
        <Kpi label={t("Tours", "Turns")} value={formatCompact(report.turns)} />
        <Kpi label="Tokens" value={reportMetricTokens(report)} />
        <Kpi label={t("Échecs", "Failures")} value={formatCompact(report.failures)} tone={report.failures ? "bad" : undefined} />
      </dl>
    </section>

    <section className="report-editorial">
      <p className="report-lead">{report.editorial.summary}</p>
      {report.editorial.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <div className="report-highlights">{report.editorial.highlights.map((highlight) => <span key={highlight} className="report-highlight">{highlight}</span>)}</div>
    </section>

    <section className="page-section">
      <SectionHeader title={t("Chiffres", "Numbers")} description={t("Par heure, par agent, par modèle, par outil et par fichier.", "Per hour, agent, model, tool and file.")} level={3} />
      <div className="report-dashboard-grid">
        <div className="chart-card report-wide"><h3>{t("Cadence des événements", "Events per hour")}</h3><div className="report-hourly">{report.hourly.map((bucket) => <div key={bucket.label} className="report-hour"><span title={t(`${bucket.label} · ${bucket.count} événements`, `${bucket.label} · ${bucket.count} events`)} style={{ height: `${Math.max(4, bucket.count / maxHour * 100)}%` }} /><small>{bucket.label}</small></div>)}</div></div>
        <div className="chart-card"><h3>{t("Agents actifs", "Active agents")}</h3><div className="report-agent-list">{report.agents.length ? report.agents.map((row) => { const provider = providerFor(row.key); return <div key={row.key} className="report-agent-row"><span className="report-agent-name"><i style={{ background: provider?.color ?? "var(--accent)" }} />{row.name}</span><b>{formatCompact(row.events)}</b><small>{t(`${row.sessions} session(s) · ${row.turns} tour(s) · ${row.toolCalls} outil(s) · ${row.failures} échec(s)`, `${row.sessions} session(s) · ${row.turns} turn(s) · ${row.toolCalls} tool(s) · ${row.failures} failure(s)`)}{row.models.length ? ` · ${row.models.join(", ")}` : ""}</small></div>; }) : <span className="summary-empty">{t("Aucun agent actif sur la période.", "No active agent in the period.")}</span>}</div></div>
        <div className="chart-card"><h3>{t("Modèles et tokens", "Models and tokens")}</h3><div className="report-agent-list">{report.models.length ? report.models.map((model) => <div key={model.model} className="report-model-row"><span title={model.model}>{model.model}</span><b>{formatCompact(model.tokens)}</b><small>{t(`${model.requests} requête(s)`, `${model.requests} request(s)`)}</small></div>) : <span className="summary-empty">{t("Aucun modèle remonté.", "No model reported.")}</span>}</div></div>
        <div className="chart-card"><h3>{t("Outils les plus utilisés", "Most used tools")}</h3><div className="report-ranking">{report.tools.length ? report.tools.slice(0, 8).map((row) => <div key={row.name}><code>{row.name}</code><span>{t(`${row.calls} appel(s) · ${row.failed} échec(s)`, `${row.calls} call(s) · ${row.failed} failed`)}</span></div>) : <span className="summary-empty">{t("Aucun appel d’outil.", "No tool call.")}</span>}</div></div>
        <div className="chart-card"><h3>{t("Fichiers les plus touchés", "Most touched files")}</h3><div className="report-ranking">{report.files.length ? report.files.slice(0, 8).map((row) => <div key={row.path}><code title={row.path}>{row.path}</code><span>{t(`${row.reads} lecture(s) · ${row.writes} écriture(s)`, `${row.reads} read(s) · ${row.writes} write(s)`)}</span></div>) : <span className="summary-empty">{t("Aucun fichier remonté.", "No file reported.")}</span>}</div></div>
      </div>
    </section>
  </div>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return <div className={`agent-stat${tone ? ` ${tone}` : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}
