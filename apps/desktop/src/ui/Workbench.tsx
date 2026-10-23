import { useState, type ReactNode } from "react";
import type { AnalyticsRange } from "./analytics";
import { t } from "./i18n";
import { PeriodBar } from "./PeriodBar";

/**
 * The lower part of the window: charts and history side by side, both for the period chosen in
 * the bar above them. When it is too narrow for two columns, a switch shows one at a time.
 */
export function Workbench({ range, onRange, charts, history }: { range: AnalyticsRange; onRange: (range: AnalyticsRange) => void; charts: ReactNode; history: ReactNode }) {
  const [column, setColumn] = useState<"charts" | "history">("charts");
  return <div className="wb">
    <header className="wb-bar">
      <PeriodBar range={range} onRange={onRange} />
      <div className="segmented wb-switch" role="group" aria-label={t("Afficher", "Show")}>
        <button aria-pressed={column === "charts"} onClick={() => setColumn("charts")}>{t("Graphiques", "Charts")}</button>
        <button aria-pressed={column === "history"} onClick={() => setColumn("history")}>{t("Historique", "History")}</button>
      </div>
    </header>
    <div className="wb-cols">
      <div className="wb-col" data-active={column === "charts"}>{charts}</div>
      <div className="wb-col" data-active={column === "history"}>{history}</div>
    </div>
  </div>;
}
