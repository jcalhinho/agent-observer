import { BarChart3, Clock3, FileText, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { formatCompact } from "./analytics";
import { buildDailyReport, reportMetricTokens, type DailyReport } from "./dailyReport";
import { providerFor } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

export function DailyReportPage({ events, hasMore }: { events: SessionEvent[]; hasMore: boolean }) {
  const now = useNow(30_000);
  const report = buildDailyReport(events, now);
  const maxHour = Math.max(1, ...report.hourly.map((bucket) => bucket.count));
  return <div className="page daily-report">
    <section className="page-section">
      <div className="section-header">
        <div className="section-header-text"><h2><Sparkles size={18} /> Rapport des dernières 24 h</h2><p>Une lecture éditoriale des faits, suivie des métriques brutes captées localement.</p></div>
        <div className="section-header-actions"><span className="report-period"><Clock3 size={14} /> {new Date(report.from).toLocaleString()} → maintenant</span><button className="button" onClick={() => window.location.reload()} title="Rafraîchir le rapport"><RefreshCw size={14} /> Actualiser</button></div>
      </div>
      {hasMore && <div className="notice warn">La fenêtre locale contient plus d’événements que ceux actuellement chargés. Le rapport est exact sur les événements présents ; charge l’historique depuis Sessions pour compléter la couverture.</div>}
      <div className="report-kpis">
        <Kpi label="Événements" value={formatCompact(report.events.length)} />
        <Kpi label="Sessions" value={formatCompact(report.sessions)} />
        <Kpi label="Tours" value={formatCompact(report.turns)} />
        <Kpi label="Tokens fournis" value={reportMetricTokens(report)} />
        <Kpi label="Échecs" value={formatCompact(report.failures)} tone={report.failures ? "bad" : undefined} />
      </div>
    </section>

    <section className="report-editorial">
      <div className="report-editorial-main"><div className="section-header"><div className="section-header-text"><h2><FileText size={17} /> Ce qui s’est passé</h2><p>Rédaction factuelle générée depuis les événements collectés, sans résumé inventé par un modèle.</p></div></div><p className="report-lead">{report.editorial.summary}</p>{report.editorial.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      <div className="report-highlights"><h3>À retenir</h3>{report.editorial.highlights.map((highlight) => <div key={highlight} className="report-highlight">{highlight}</div>)}</div>
    </section>

    <section className="page-section"><div className="section-header"><div className="section-header-text"><h2><BarChart3 size={17} /> Tableau de bord technique</h2><p>Détail par agent, outil, fichier, modèle et cadence horaire.</p></div></div>
      <div className="report-dashboard-grid">
        <div className="chart-card report-wide"><h3>Cadence des événements</h3><div className="report-hourly">{report.hourly.map((bucket) => <div key={bucket.label} className="report-hour"><span title={`${bucket.label} · ${bucket.count} événements`} style={{ height: `${Math.max(4, bucket.count / maxHour * 100)}%` }} /><small>{bucket.label}</small></div>)}</div></div>
        <div className="chart-card"><h3>Agents actifs</h3><div className="report-agent-list">{report.agents.length ? report.agents.map((row) => { const provider = providerFor(row.key); return <div key={row.key} className="report-agent-row"><span className="report-agent-name"><i style={{ background: provider?.color ?? "var(--accent)" }} />{row.name}</span><b>{formatCompact(row.events)}</b><small>{row.sessions} session(s) · {row.turns} tour(s) · {row.toolCalls} outil(s) · {row.failures} échec(s)</small><small>Modèles : {row.models.length ? row.models.join(", ") : "non remonté"}</small></div>; }) : <span className="summary-empty">Aucun agent actif sur la période.</span>}</div></div>
        <div className="chart-card"><h3>Modèles et tokens</h3><div className="report-agent-list">{report.models.length ? report.models.map((model) => <div key={model.model} className="report-model-row"><span title={model.model}>{model.model}</span><b>{formatCompact(model.tokens)}</b><small>{model.requests} requête(s)</small></div>) : <span className="summary-empty">Aucun modèle remonté.</span>}</div></div>
        <div className="chart-card"><h3>Outils les plus utilisés</h3><div className="report-ranking">{report.tools.length ? report.tools.slice(0, 8).map((row) => <div key={row.name}><code>{row.name}</code><span>{row.calls} appel(s) · {row.failed} échec(s)</span></div>) : <span className="summary-empty">Aucun appel d’outil.</span>}</div></div>
        <div className="chart-card"><h3>Fichiers les plus touchés</h3><div className="report-ranking">{report.files.length ? report.files.slice(0, 8).map((row) => <div key={row.path}><code title={row.path}>{row.path}</code><span>{row.reads} lecture(s) · {row.writes} écriture(s)</span></div>) : <span className="summary-empty">Aucun fichier remonté.</span>}</div></div>
      </div>
    </section>
  </div>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bad" }) { return <div className={`summary-stat${tone ? ` ${tone}` : ""}`}><span className="summary-stat-label">{label}</span><b>{value}</b></div>; }
