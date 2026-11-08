import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { dailyTotals, localDay, type DayTotals, type Share } from "./analysis";
import { locale, t } from "./i18n";
import { compact, percent, shortModel, usd } from "./insights";
import { agentName } from "./providers";
import type { SessionEvent } from "./types";

const PERIODS = [1, 7, 30, 90];

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

function merge(days: DayTotals[], pick: (day: DayTotals) => Record<string, Share>) {
  const total = new Map<string, Share>();
  for (const day of days) {
    for (const [name, share] of Object.entries(pick(day))) {
      const current = total.get(name) ?? { tokens: 0, cost: null };
      total.set(name, { tokens: current.tokens + share.tokens, cost: share.cost === null ? current.cost : (current.cost ?? 0) + share.cost });
    }
  }
  return [...total].sort((a, b) => (b[1].cost ?? 0) - (a[1].cost ?? 0) || b[1].tokens - a[1].tokens);
}

const projectName = (path: string) => path ? path.split("/").filter(Boolean).at(-1) ?? path : t("dossier inconnu", "unknown folder");

/**
 * Ce qui s'est passé jour par jour : tokens, taux de cache, coût estimé, économie du cache, et la
 * répartition par agent et par projet. Calculé depuis l'historique local, dans la limite de ta
 * conservation (Réglages).
 */
export function History({ events, now, period, onPeriod, loading, truncated, onClose }: {
  events: SessionEvent[]; now: number; period: number; onPeriod: (days: number) => void; loading: boolean; truncated: boolean; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [mode, setMode] = useState<"agent" | "model" | "project">("agent");
  const days = useMemo(() => dailyTotals(events, now, period), [events, now, period]);
  const today = localDay(now);
  const peak = Math.max(0.0001, ...days.map((day) => day.cost ?? 0));
  const peakTokens = Math.max(1, ...days.map((day) => day.tokens));
  const useCost = days.some((day) => day.cost !== null);
  const total = days.reduce((sum, day) => ({ tokens: sum.tokens + day.tokens, cost: sum.cost + (day.cost ?? 0), saved: sum.saved + (day.saved ?? 0), requests: sum.requests + day.requests, prompt: sum.prompt + day.prompt, hit: sum.hit + day.hit, miss: sum.miss + day.miss, unpriced: sum.unpriced + day.unpriced }), { tokens: 0, cost: 0, saved: 0, requests: 0, prompt: 0, hit: 0, miss: 0, unpriced: 0 });
  const breakdown = merge(days, (day) => mode === "agent" ? day.byAgent : mode === "model" ? day.byModel : day.byProject);
  const cacheKnown = total.hit + total.miss > 0;
  const hitRate = cacheKnown ? total.hit / (total.hit + total.miss) : null;
  const pricedDays = days.filter((day) => day.cost !== null).length;
  const unpricedDays = days.filter((day) => day.tokens > 0 && day.cost === null).length;
  const activeDays = days.filter((day) => day.tokens > 0 || day.requests > 0).length;

  return <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="sheet history" role="dialog" aria-modal="true" aria-label={t("Historique", "History")}>
      <header className="sheet-head">
        <b>{t("Historique", "History")}</b>
        <span className="detail-actions">
          <span className="segmented" role="group">
            {PERIODS.map((days) => <button key={days} className={period === days ? "on" : ""} aria-pressed={period === days} onClick={() => onPeriod(days)}>{days === 1 ? t("Aujourd’hui", "Today") : t(`${days} j`, `${days} d`)}</button>)}
          </span>
          <button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")}><X size={15} /></button>
        </span>
      </header>

      {loading && <p className="hint">{t("Lecture de l’historique local…", "Reading the local history…")}</p>}
      {truncated && <p className="notice">{t("L’historique est très long : seule la partie la plus récente a été lue.", "The history is very long: only its most recent part was read.")}</p>}
      {!loading && !days.length && <p className="hint">{t("Rien d’enregistré sur cette période. L’app ne garde que ce qu’elle a observé, dans la limite de ta conservation (Réglages).", "Nothing recorded over this period. The app only keeps what it observed, within your retention setting (Settings).")}</p>}

      {days.length > 0 && <>
        <div className="overview hist-total">
          <div title={t("Estimation au tarif API public de chaque modèle vu — pas ce qu’un abonnement te facture.", "Estimate at each model’s public API price — not what a subscription bills you.")}>
            <span className="k">{t("Dépense estimée", "Estimated spend")}</span>
            <strong className="v">{pricedDays ? `≈ ${usd(total.cost)}` : "—"}</strong>
            <p>{pricedDays ? t(`${pricedDays} jour(s) chiffré(s) sur ${days.length}. Estimation au tarif API.`, `${pricedDays} priced day(s) out of ${days.length}. Estimate at API price.`) : t("Aucun coût chiffrable sur la période.", "No priced cost over this period.")}{total.unpriced > 0 ? ` ${t(`${total.unpriced} requête(s) sans prix connu, non comptées.`, `${total.unpriced} request(s) with no known price, not counted.`)}` : ""}</p>
          </div>
          <div>
            <span className="k">Tokens</span>
            <strong className="v">{compact(total.tokens)}</strong>
            <p>{cacheKnown ? t(`dont ${compact(total.hit + total.miss)} en entrée : ${compact(total.hit)} lus du cache · ${compact(total.miss)} manqués`, `of which ${compact(total.hit + total.miss)} input: ${compact(total.hit)} hit · ${compact(total.miss)} missed`) : t(`dont ${compact(total.prompt)} en entrée`, `of which ${compact(total.prompt)} input`)}</p>
          </div>
          <div title={t("lus ÷ (lus + manqués), sur les agents qui rapportent leur cache", "hit ÷ (hit + miss), over agents that report their cache")}>
            <span className="k">{t("Taux de cache", "Cache hit rate")}</span>
            <strong className={`v ${hitRate === null ? "" : hitRate >= 0.8 ? "good" : hitRate >= 0.4 ? "mid" : "low"}`}>{hitRate === null ? "—" : percent(hitRate)}</strong>
            <p>{hitRate === null ? t("Aucun agent n’a rapporté son cache.", "No agent reported its cache.") : t("Plus c’est haut, moins ça coûte : garde le début du prompt stable.", "Higher is cheaper: keep the start of the prompt stable.")}</p>
          </div>
          <div>
            <span className="k">{t("Requêtes", "Requests")}</span>
            <strong className="v">{compact(total.requests)}</strong>
            <p>{t(`Réponses du modèle qui ont rapporté leur usage. ${activeDays} jour(s) actif(s) sur ${days.length}.`, `Model responses that reported usage. ${activeDays} active day(s) out of ${days.length}.`)}</p>
          </div>
        </div>
        {cacheKnown && <p className="hint">{t(`Sur les ${compact(total.hit + total.miss)} tokens d’entrée envoyés sur cette période, ${percent(total.hit / (total.hit + total.miss))} ont touché le cache : une lecture de cache est facturée bien moins qu’un token manqué.`, `Of the ${compact(total.hit + total.miss)} input tokens sent over this period, ${percent(total.hit / (total.hit + total.miss))} hit the cache: a cache read is billed far below a missed token.`)}</p>}

        <section>
          <h3>{t("Tokens par jour", "Tokens per day")}</h3>
          <ol className="bars-days" aria-label={t("Tokens par jour", "Tokens per day")}>
            {[...days].reverse().map((day) => <li key={day.day} className={day.day === today ? "today" : ""} title={`${dayLabel(day.day)} · ${compact(day.tokens)}`}>
              <i style={{ height: `${Math.max(3, (day.tokens / peakTokens) * 100)}%` }} />
              <small>{new Date(`${day.day}T12:00:00`).toLocaleDateString(locale(), { day: "numeric" })}</small>
            </li>)}
          </ol>
        </section>

        {useCost && <section>
          <h3>{t("Dépense estimée par jour", "Estimated spend per day")} <small>{t("tracée à part : autre unité", "drawn apart: different unit")}</small></h3>
          <ol className="bars-days cost" aria-label={t("Dépense par jour", "Spend per day")}>
            {[...days].reverse().map((day) => <li key={day.day} className={day.day === today ? "today" : ""} title={`${dayLabel(day.day)} · ${day.cost !== null ? `≈ ${usd(day.cost)}` : t("pas de coût chiffré", "no priced cost")}`}>
              <i style={{ height: `${day.cost === null ? 0 : Math.max(3, ((day.cost ?? 0) / peak) * 100)}%` }} />
              <small>{new Date(`${day.day}T12:00:00`).toLocaleDateString(locale(), { day: "numeric" })}</small>
            </li>)}
          </ol>
          {unpricedDays > 0 && <p className="hint">{t(`${unpricedDays} jour(s) ont de l’usage mais aucun coût chiffré (modèle absent de la table des prix) : ce ne sont pas des jours gratuits.`, `${unpricedDays} day(s) have usage but no priced cost (model not in the price table): they are not free days.`)}</p>}
        </section>}

        <section>
          <h3>{t("Jour par jour", "Day by day")}</h3>
          <table>
            <thead><tr><th>{t("Jour", "Day")}</th><th className="num">Tokens</th><th className="num">{t("Cache", "Cache")}</th><th className="num">{t("Requêtes", "Requests")}</th><th className="num">{t("Coût", "Cost")}</th><th className="num">{t("Gagné", "Saved")}</th><th className="num">{t("Sessions", "Sessions")}</th></tr></thead>
            <tbody>{days.map((day) => <tr key={day.day} className={day.day === today ? "today" : ""}>
              <td>{dayLabel(day.day)}</td>
              <td className="num">{compact(day.tokens)}</td>
              <td className="num">{day.cacheHit === null ? "—" : percent(day.cacheHit)}</td>
              <td className="num">{day.requests}</td>
              <td className="num">{day.cost === null ? "—" : `${day.costPartial ? "≥ " : "≈ "}${usd(day.cost)}`}</td>
              <td className="num good">{day.saved === null ? "—" : usd(day.saved)}</td>
              <td className="num">{day.sessions}{day.failures ? <em title={t("échecs d’outils", "tool failures")}> · {day.failures}✗</em> : null}</td>
            </tr>)}</tbody>
          </table>
        </section>

        <section>
          <h3>{t("Répartition", "Breakdown")}
            <span className="segmented small" role="group">
              <button className={mode === "agent" ? "on" : ""} aria-pressed={mode === "agent"} onClick={() => setMode("agent")}>{t("par agent", "by agent")}</button>
              <button className={mode === "model" ? "on" : ""} aria-pressed={mode === "model"} onClick={() => setMode("model")}>{t("par modèle", "by model")}</button>
              <button className={mode === "project" ? "on" : ""} aria-pressed={mode === "project"} onClick={() => setMode("project")}>{t("par projet", "by project")}</button>
            </span>
          </h3>
          <ul className="share">
            {breakdown.map(([name, share]) => {
              const top = Math.max(1, ...breakdown.map(([, other]) => other.cost ?? other.tokens));
              const value = share.cost ?? share.tokens;
              return <li key={name || "?"}>
                <span title={mode === "project" ? name : undefined}>{mode === "agent" ? agentName(name) : mode === "model" ? (name ? shortModel(name) : t("modèle non rapporté", "model not reported")) : projectName(name)}</span>
                <i style={{ width: `${Math.max(3, (value / top) * 100)}%` }} />
                <b>{share.cost !== null ? `≈ ${usd(share.cost)}` : compact(share.tokens)}</b>
                <small>{compact(share.tokens)}</small>
              </li>;
            })}
          </ul>
          <p className="hint">{t("Coût au tarif API public, sur les modèles connus de la table des prix ; un agent dont le modèle n’y est pas n’a que ses tokens.", "Cost at public API list price, for models in the price table; an agent whose model is not in it only shows its tokens.")}</p>
        </section>
      </>}
    </aside>
  </div>;
}
