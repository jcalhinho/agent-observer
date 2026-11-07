import { useId } from "react";

/** Barres d'activité : une barre par minute, la plus récente à droite. */
export function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const width = 100 / values.length;
  return <svg className="spark-bars" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}>
    {values.map((value, index) => {
      const height = value === 0 ? 1 : Math.max(3, (value / max) * 24);
      return <rect key={index} x={index * width + width * 0.14} y={24 - height} width={width * 0.72} height={height} rx={0.6} className={value === 0 ? "zero" : index === values.length - 1 ? "last" : ""} />;
    })}
  </svg>;
}

/** Courbe pleine, pour la taille du contexte au fil des requêtes. `ceiling` fixe le haut du graphique (la fenêtre). */
export function Area({ values, ceiling, label }: { values: number[]; ceiling?: number | null; label: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const top = Math.max(ceiling ?? 0, ...values, 1);
  const step = 100 / (values.length - 1);
  const points = values.map((value, index) => [index * step, 28 - (value / top) * 26] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return <svg className="spark-area" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs>
      <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="currentColor" stopOpacity=".38" />
        <stop offset="1" stopColor="currentColor" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d={`${line} L100 28 L0 28 Z`} fill={`url(#${id})`} />
    <path d={line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>;
}

export type Segment = { key: string; short: string; label: string; value: number; className: string };

/** Barre empilée : répartition des tokens. */
export function Stack({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;
  return <div className="stack" role="img" aria-label={label}>
    {segments.filter((segment) => segment.value > 0).map((segment) => <i key={segment.key} className={segment.className} style={{ flexGrow: segment.value }} title={segment.label} />)}
  </div>;
}
