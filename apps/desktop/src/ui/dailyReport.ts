import { countEditedFiles } from "./sessionSummary";
import { t } from "./i18n";
import { agentName } from "./providers";
import { eventsInRange, formatCompact, modelsUsed, timeAxis, topFiles, topTools } from "./analytics";
import type { SessionEvent } from "./types";

export type DailyReportAgent = {
  key: string;
  name: string;
  events: number;
  sessions: number;
  turns: number;
  toolCalls: number;
  failures: number;
  filesChanged: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
};

export type DailyReport = {
  from: number;
  to: number;
  events: SessionEvent[];
  sessions: number;
  agents: DailyReportAgent[];
  projects: string[];
  toolCalls: number;
  failures: number;
  waiting: number;
  turns: number;
  filesChanged: number;
  inputTokens: number;
  outputTokens: number;
  models: ReturnType<typeof modelsUsed>;
  tools: ReturnType<typeof topTools>;
  files: ReturnType<typeof topFiles>;
  hourly: Array<{ label: string; count: number }>;
  editorial: { summary: string; paragraphs: string[]; highlights: string[] };
};

function projectName(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function compactList(values: string[], max = 3) {
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max}`;
}

export function buildDailyReport(allEvents: SessionEvent[], now = Date.now()): DailyReport {
  const axis = timeAxis([], "24h", now);
  const events = eventsInRange(allEvents, axis);
  const keys = [...new Set(events.map((event) => event.provider))];
  const agentRows = keys.map((key): DailyReportAgent => {
    const own = events.filter((event) => event.provider === key);
    return {
      key,
      name: agentName(key),
      events: own.length,
      sessions: new Set(own.map((event) => `${event.provider}:${event.session_id}`)).size,
      turns: own.filter((event) => event.kind === "checkpoint").length,
      toolCalls: own.filter((event) => event.kind === "tool_started").length,
      failures: own.filter((event) => event.kind === "tool_failed" || (event.kind === "checkpoint" && /error|fail|cancel/i.test(event.outcome ?? ""))).length,
      filesChanged: countEditedFiles(own),
      inputTokens: own.reduce((sum, event) => sum + (event.input_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0), 0),
      outputTokens: own.reduce((sum, event) => sum + (event.output_tokens?.value ?? 0), 0),
      models: [...new Set(own.filter((event) => event.model?.value).map((event) => event.model!.value))]
    };
  }).sort((a, b) => b.events - a.events);

  const projects = [...new Set(events.map((event) => event.project_path).filter((path): path is string => Boolean(path)).map(projectName))].sort();
  const failures = events.filter((event) => event.kind === "tool_failed" || (event.kind === "checkpoint" && /error|fail|cancel/i.test(event.outcome ?? ""))).length;
  const waiting = events.filter((event) => event.kind === "checkpoint" && (event.outcome ?? "").startsWith("attention:")).length;
  const tools = topTools(events);
  const files = topFiles(events);
  const hourly = Array.from({ length: 24 }, (_, index) => {
    const start = axis.start + index * 60 * 60_000;
    return { label: new Date(start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), count: events.filter((event) => { const time = Date.parse(event.occurred_at); return time >= start && time < start + 60 * 60_000; }).length };
  });
  const inputTokens = events.reduce((sum, event) => sum + (event.input_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0), 0);
  const outputTokens = events.reduce((sum, event) => sum + (event.output_tokens?.value ?? 0), 0);
  const models = modelsUsed(events);
  const active = agentRows.filter((row) => row.events > 0);
  const leader = active[0];
  const fileChanges = countEditedFiles(events);
  const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);
  const summary = events.length === 0
    ? t("Aucune activité d’agent n’a été captée sur les dernières 24 heures.", "No agent activity was captured in the last 24 hours.")
    : t(
        `${active.length} ${plural(active.length, "agent a travaillé", "agents ont travaillé")} sur ${projects.length || "aucun"} projet${projects.length > 1 ? "s" : ""}, avec ${formatCompact(events.length)} événements observés.`,
        `${active.length} ${plural(active.length, "agent worked", "agents worked")} on ${projects.length || "no"} project${projects.length > 1 ? "s" : ""}, with ${formatCompact(events.length)} events observed.`
      );
  const paragraphs = events.length === 0
    ? [t("Le rapport reste prêt et se remplira dès qu’un connecteur transmettra une activité réelle.", "The report stays ready and fills in as soon as a connector reports real activity.")]
    : [
        t(
          `${leader?.name ?? "Les agents"} concentre${leader ? "" : "nt"} l’essentiel de l’activité avec ${formatCompact(leader?.events ?? 0)} événements${leader?.models.length ? `, notamment ${compactList(leader.models)}` : ""}.`,
          `${leader?.name ?? "Agents"} account${leader ? "s" : ""} for most of the activity with ${formatCompact(leader?.events ?? 0)} events${leader?.models.length ? `, mainly ${compactList(leader.models)}` : ""}.`
        ),
        t(
          `${formatCompact(fileChanges)} modification${fileChanges > 1 ? "s" : ""} de fichier${fileChanges > 1 ? "s" : ""} ont été observées${projects.length ? ` dans ${compactList(projects)}` : ""}. Les compteurs de tokens et de durée restent ceux fournis par les agents : rien n’est estimé ici.`,
          `${formatCompact(fileChanges)} file change${fileChanges === 1 ? "" : "s"} observed${projects.length ? ` in ${compactList(projects)}` : ""}. Token and duration counters are the ones the agents report: nothing is estimated here.`
        ),
        failures
          ? t(`${failures} incident${failures > 1 ? "s" : ""} technique${failures > 1 ? "s" : ""} mérite${failures > 1 ? "nt" : ""} une vérification dans le détail des sessions.`, `${failures} technical incident${failures === 1 ? "" : "s"} deserve${failures === 1 ? "s" : ""} a look in the session details.`)
          : t("Aucun échec de tool ou de tour n’a été enregistré sur la période.", "No tool or turn failure was recorded in the period.")
      ];
  const highlights = [
    t(`${formatCompact(fileChanges)} fichier(s) modifié(s)`, `${formatCompact(fileChanges)} file(s) changed`),
    t(`${formatCompact(tools.reduce((sum, row) => sum + row.calls, 0))} appels d’outils`, `${formatCompact(tools.reduce((sum, row) => sum + row.calls, 0))} tool calls`),
    failures ? t(`${failures} échec(s) à examiner`, `${failures} failure(s) to review`) : t("Aucun échec enregistré", "No failure recorded"),
    waiting ? t(`${waiting} attente(s) de validation ou de message`, `${waiting} wait(s) for approval or a message`) : t("Aucune attente signalée", "No wait reported")
  ];
  return {
    from: axis.start, to: axis.end, events, sessions: new Set(events.map((event) => `${event.provider}:${event.session_id}`)).size,
    agents: agentRows, projects, toolCalls: events.filter((event) => event.kind === "tool_started").length, failures, waiting,
    turns: events.filter((event) => event.kind === "checkpoint").length, filesChanged: countEditedFiles(events),
    inputTokens, outputTokens, models, tools, files, hourly, editorial: { summary, paragraphs, highlights }
  };
}

export function reportMetricTokens(report: DailyReport) { return t(`${formatCompact(report.inputTokens)} lus · ${formatCompact(report.outputTokens)} écrits`, `${formatCompact(report.inputTokens)} read · ${formatCompact(report.outputTokens)} written`); }
