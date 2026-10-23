import { ChevronLeft, ChevronRight } from "lucide-react";
import { RANGES, dayRange, dayWindow, isDayRange, isDayText, isToday, rangeLabel, type AnalyticsRange } from "./analytics";
import { t } from "./i18n";

const asInput = (range: AnalyticsRange) => (isDayRange(range) ? range.slice(4) : "");
const shifted = (range: `day:${string}`, days: number) => {
  const start = new Date(dayWindow(range).start);
  start.setDate(start.getDate() + days);
  return dayRange(start);
};

/**
 * The period the charts and the history look at: a sliding window up to now, or a calendar day
 * you can step through. One bar for both, so they always show the same period.
 */
export function PeriodBar({ range, onRange }: { range: AnalyticsRange; onRange: (range: AnalyticsRange) => void }) {
  const day = isDayRange(range);
  const today = dayRange(new Date());
  return <div className="period-bar">
    <div className="segmented" role="group" aria-label={t("Période", "Period")}>
      {RANGES.map((key) => <button key={key} aria-pressed={key === range} onClick={() => onRange(key)}>{rangeLabel(key)}</button>)}
    </div>
    <div className={`period-day ${day ? "is-on" : ""}`} role="group" aria-label={t("Choisir un jour", "Pick a day")}>
      <button className="icon-button" onClick={() => onRange(shifted(day ? range : (today as `day:${string}`), -1))} aria-label={t("Jour précédent", "Previous day")} title={t("Jour précédent", "Previous day")}><ChevronLeft size={14} /></button>
      <input type="date" value={asInput(day ? range : today)} max={asInput(today)} onChange={(event) => { const next = `day:${event.target.value}`; if (isDayText(next)) onRange(next); }} aria-label={t("Jour", "Day")} onFocus={() => { if (!day) onRange(today); }} />
      <button className="icon-button" onClick={() => onRange(shifted(range as `day:${string}`, 1))} disabled={!day || isToday(range)} aria-label={t("Jour suivant", "Next day")} title={t("Jour suivant", "Next day")}><ChevronRight size={14} /></button>
      {day && !isToday(range) && <button className="button small" onClick={() => onRange(today)}>{t("Aujourd’hui", "Today")}</button>}
    </div>
  </div>;
}
