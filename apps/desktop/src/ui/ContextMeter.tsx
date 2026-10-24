import { formatCompact } from "./analytics";
import { WARN_AT, type ContextUsage } from "./contextUsage";
import { t } from "./i18n";

/** What a source of the window means, for the tooltip. */
function sourceNote(usage: ContextUsage) {
  if (usage.windowSource === "reported") return t("Taille de la fenêtre donnée par l’agent.", "Window size reported by the agent.");
  if (usage.windowSource === "table") return t("Taille de la fenêtre d’après la table des modèles connus.", "Window size from the table of known models.");
  if (usage.windowSource === "observed") return t("Le contexte a dépassé la fenêtre connue du modèle : la fenêtre affichée est la plus petite qui le contient.", "The context grew past the model’s known window: the window shown is the smallest that holds it.");
  return t("Taille de la fenêtre inconnue pour ce modèle : pas de pourcentage.", "Window size unknown for this model: no percentage.");
}

/**
 * How full the context window is: a bar, "57 % · 570k / 1M", amber from 80 % and red from 95 %. With a
 * window of unknown size it only says how many tokens the latest request held.
 */
export function ContextMeter({ usage, trend = false }: { usage: ContextUsage; trend?: boolean }) {
  const label = usage.window ? `${Math.round(usage.percent ?? 0)} % · ${formatCompact(usage.used)} / ${formatCompact(usage.window)}` : t(`${formatCompact(usage.used)} tokens`, `${formatCompact(usage.used)} tokens`);
  const detail = [
    t("Taille de la dernière requête : nouveaux tokens + tokens lus ou écrits dans le cache.", "Size of the latest request: new tokens + tokens read from or written to the cache."),
    usage.cachedShare !== null ? t(`${Math.round(usage.cachedShare * 100)} % viennent du cache.`, `${Math.round(usage.cachedShare * 100)}% come from the cache.`) : "",
    usage.compactions ? t(`Compacté ${usage.compactions} fois dans cette session.`, `Compacted ${usage.compactions} time${usage.compactions > 1 ? "s" : ""} in this session.`) : "",
    sourceNote(usage)
  ].filter(Boolean).join(" ");
  return <div className={`ctx-meter state-${usage.state}`} title={detail}>
    <span className="ctx-label">{t("Contexte", "Context")}</span>
    {usage.window !== null && <span className="ctx-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usage.percent ?? 0)} aria-label={t("Part de la fenêtre de contexte utilisée", "Share of the context window in use")}><i style={{ width: `${usage.percent ?? 0}%` }} /><b style={{ left: `${WARN_AT * 100}%` }} aria-hidden="true" /></span>}
    <span className="ctx-value">{label}{usage.compactions ? <small> · {t(`compacté ×${usage.compactions}`, `compacted ×${usage.compactions}`)}</small> : null}</span>
    {trend && usage.series.length > 1 && <ContextTrend usage={usage} />}
  </div>;
}

/** The size of each request of the session, against the window (or the largest request without one). */
function ContextTrend({ usage }: { usage: ContextUsage }) {
  const top = usage.window ?? Math.max(...usage.series);
  const width = 240;
  const height = 34;
  const points = usage.series.map((size, index) => `${(index / (usage.series.length - 1)) * width},${height - Math.min(1, size / top) * (height - 3) - 1.5}`).join(" ");
  return <svg className="ctx-trend" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("Évolution du contexte pendant la session", "Context over the session")}>
    <polyline points={points} />
  </svg>;
}
