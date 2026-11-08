import { compact } from "./insights";
import { locale, t } from "./i18n";

type ProviderStats = { provider: string; events: number; last_event_at: string | null; last_received_at: string | null };
export type Diagnostic = {
  version: string;
  os: string;
  arch: string;
  collector: string;
  started_at: string;
  home: string;
  database: { path: string; size_bytes: number; events: number; oldest: string | null; newest: string | null; retention_days: number };
  providers: ProviderStats[];
  rejected_requests: number;
};
/** Où un connecteur lit, et si ce dossier existe ; null pour les connecteurs à hooks. */
type Source = { path: string; found: boolean } | null;
export type AgentLine = { key: string; name: string; source: Source; stats: ProviderStats | null };

/** Remplace le dossier personnel par `~`. */
export function hideHome(path: string, home: string) {
  const base = home.replace(/[\\/]+$/, "");
  if (!base || !path.startsWith(base)) return path;
  const rest = path.slice(base.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("\\") ? `~${rest}` : path;
}

export function bytes(size: number) {
  const number = (value: number) => value.toLocaleString(locale(), { maximumFractionDigits: 1 });
  if (size < 1024) return t(`${size} o`, `${size} B`);
  if (size < 1024 * 1024) return `${number(Math.round(size / 1024))} ${t("Ko", "KB")}`;
  return `${number(size / 1024 / 1024)} ${t("Mo", "MB")}`;
}

function ago(iso: string | null, now: number) {
  if (!iso) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return t(`il y a ${seconds} s`, `${seconds} s ago`);
  if (seconds < 3600) return t(`il y a ${Math.round(seconds / 60)} min`, `${Math.round(seconds / 60)} min ago`);
  if (seconds < 86_400) return t(`il y a ${Math.round(seconds / 3600)} h`, `${Math.round(seconds / 3600)} h ago`);
  return t(`il y a ${Math.round(seconds / 86_400)} j`, `${Math.round(seconds / 86_400)} d ago`);
}

/** Une phrase par agent : ce qu'il a apporté depuis le lancement et d'où il est lu. */
export function agentSummary(line: AgentLine, home: string, now: number) {
  const where = line.source === null
    ? t("hooks", "hooks")
    : `${hideHome(line.source.path, home)}, ${line.source.found ? t("trouvé", "found") : t("introuvable", "not found")}`;
  const activity = line.stats && line.stats.events > 0
    ? t(`${compact(line.stats.events)} événement(s) depuis le lancement, reçu ${ago(line.stats.last_received_at, now)}`, `${compact(line.stats.events)} event(s) since launch, received ${ago(line.stats.last_received_at, now)}`)
    : t("rien reçu depuis le lancement", "nothing received since launch");
  return { where, activity };
}

/** Le diagnostic en texte, à coller dans un signalement de bug : le dossier personnel est masqué. */
export function diagnosticText(diagnostic: Diagnostic, agents: AgentLine[], now: number) {
  const db = diagnostic.database;
  const lines = [
    `Agent Observer ${diagnostic.version} — ${diagnostic.os} ${diagnostic.arch}`,
    t(`Collecteur : ${diagnostic.collector}, lancé ${ago(diagnostic.started_at, now)}`, `Collector: ${diagnostic.collector}, started ${ago(diagnostic.started_at, now)}`),
    t(`Base : ${hideHome(db.path, diagnostic.home)} · ${compact(db.events)} événement(s) · ${bytes(db.size_bytes)}`, `Database: ${hideHome(db.path, diagnostic.home)} · ${compact(db.events)} event(s) · ${bytes(db.size_bytes)}`)
      + (db.oldest && db.newest ? t(` · du ${db.oldest.slice(0, 10)} au ${db.newest.slice(0, 10)}`, ` · from ${db.oldest.slice(0, 10)} to ${db.newest.slice(0, 10)}`) : "")
      + (db.retention_days > 0 ? t(` · rétention ${db.retention_days} j`, ` · retention ${db.retention_days} d`) : t(" · tout est gardé", " · everything kept")),
    t(`Requêtes refusées par le collecteur (clé absente ou fausse, contenu illisible) : ${diagnostic.rejected_requests}`, `Requests refused by the collector (missing or wrong key, unreadable content): ${diagnostic.rejected_requests}`),
    t("Agents :", "Agents:"),
    ...agents.map((line) => {
      const { where, activity } = agentSummary(line, diagnostic.home, now);
      return `- ${line.name} (${where})${t(" : ", ": ")}${activity}`;
    })
  ];
  return lines.join("\n");
}
