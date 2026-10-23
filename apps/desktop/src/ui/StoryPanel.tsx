import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, Feather, Square, Trash2 } from "lucide-react";
import { EmptyState } from "./Explain";
import { locale, t } from "./i18n";
import { Prose } from "./Prose";
import { Consent } from "./Consent";
import { cancelStory, pickAgent, previewStory, storySettings, StoryError, useStories, useStoryAgents, writeStory, type StoryAgent, type StoryRecord } from "./useStory";
import type { SessionEvent } from "./types";

const originLabel = (origin: StoryAgent["origin"]) => origin === "editor" ? t("extension d’éditeur", "editor extension") : origin === "desktop" ? t("application", "desktop app") : t("ligne de commande", "command line");

export function describeStoryError(error: unknown) {
  const { code, detail } = error instanceof StoryError ? error : { code: "failed", detail: String(error) };
  switch (code) {
    case "not_installed": return t("Cet agent n’est plus trouvé sur cet ordinateur.", "This agent can no longer be found on this computer.");
    case "busy": return t("Une histoire est déjà en cours d’écriture.", "A story is already being written.");
    case "timeout": return t(`L’agent n’a pas répondu à temps (${detail}). Réessaie, ou choisis un autre agent.`, `The agent did not answer in time (${detail}). Try again, or pick another agent.`);
    case "cancelled": return t("Écriture annulée.", "Writing cancelled.");
    case "empty": return t("L’agent n’a rien répondu.", "The agent answered nothing.");
    default: return t(`L’agent a répondu par une erreur : ${detail || "inconnue"}`, `The agent answered with an error: ${detail || "unknown"}`);
  }
}

/** The story of the last 24 hours, written by an agent already installed here. */
export function StoryPanel({ events }: { events: SessionEvent[] }) {
  const { agents, refresh } = useStoryAgents();
  const { stories, reload, remove } = useStories();
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<StoryAgent | null>(null);
  const [chosen, setChosen] = useState(() => storySettings.agent());
  const [copied, setCopied] = useState(false);
  const agent = agents ? pickAgent(agents, chosen) : null;
  const story: StoryRecord | undefined = stories.find((candidate) => candidate.id === shown) ?? stories[0];

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function run(target: StoryAgent) {
    setError("");
    setBusy(true);
    setSeconds(0);
    try {
      const written = await writeStory(events, target.provider);
      reload();
      setShown(written.id);
    } catch (reason) {
      if (!(reason instanceof StoryError && reason.code === "cancelled")) setError(describeStoryError(reason));
    } finally {
      setBusy(false);
    }
  }
  function start() {
    if (!agent || busy) return;
    if (storySettings.consented().includes(agent.provider)) void run(agent);
    else setAsking(agent);
  }
  async function exportStory() {
    if (!story) return;
    const day = story.created_at.slice(0, 10);
    const path = await save({ title: t("Enregistrer l’histoire", "Save the story"), defaultPath: `agent-observer-${day}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] }).catch(() => null);
    if (path) await invoke("export_text", { path, text: story.text }).catch((reason) => setError(String(reason)));
  }

  return <section className="panel story">
    <div className="panel-bar">
      <button className="button primary" onClick={busy ? () => void cancelStory() : start} disabled={!busy && !agent}>
        {busy ? <><Square size={12} />{t(`Annuler · ${seconds} s`, `Cancel · ${seconds} s`)}</> : <><Feather size={13} />{t("Écrire l’histoire", "Write the story")}</>}
      </button>
      {agents && agents.length > 1 && <select className="field-select" value={agent?.provider ?? ""} onChange={(event) => { setChosen(event.target.value); }} aria-label={t("Agent qui écrit", "Writing agent")} disabled={busy}>
        {agents.map((candidate) => <option key={candidate.provider} value={candidate.provider}>{candidate.name}</option>)}
      </select>}
      {stories.length > 1 && <select className="field-select" value={story?.id ?? ""} onChange={(event) => setShown(Number(event.target.value))} aria-label={t("Histoires précédentes", "Previous stories")}>
        {stories.map((candidate) => <option key={candidate.id} value={candidate.id}>{new Date(candidate.created_at).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {candidate.agent}</option>)}
      </select>}
    </div>
    {error && <p className="notice warn" role="alert">{error}</p>}
    {agents && !agents.length && <EmptyState title={t("Aucun agent compatible trouvé", "No supported agent found")} action={<button className="button small" onClick={refresh}>{t("Chercher à nouveau", "Look again")}</button>}>{t("L’histoire est écrite par un agent que tu as déjà : Claude Code, Codex, Gemini CLI, Qwen Code ou OpenCode (en ligne de commande, en extension d’éditeur ou, pour Claude, dans l’application). Rien à installer d’autre, aucune clé.", "The story is written by an agent you already have: Claude Code, Codex, Gemini CLI, Qwen Code or OpenCode (command line, editor extension or, for Claude, the desktop app). Nothing else to install, no key.")}</EmptyState>}
    {busy && <p className="story-wait" role="status"><i />{t(`${agent?.name ?? "L’agent"} écrit l’histoire de tes dernières 24 h…`, `${agent?.name ?? "The agent"} is writing the story of your last 24 hours…`)}</p>}
    {story ? <article className="story-body">
      <Prose text={story.text} />
      <footer className="story-meta">
        <span>{t(`Écrit par ${story.agent} en ${Math.round(story.seconds)} s`, `Written by ${story.agent} in ${Math.round(story.seconds)} s`)} · {new Date(story.created_at).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</span>
        <span className="story-actions">
          <button className="icon-button" onClick={() => { void navigator.clipboard.writeText(story.text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }} aria-label={t("Copier", "Copy")} title={copied ? t("Copié", "Copied") : t("Copier", "Copy")}><Copy size={13} /></button>
          <button className="icon-button" onClick={() => void exportStory()} aria-label={t("Enregistrer en Markdown", "Save as Markdown")} title={t("Enregistrer en Markdown", "Save as Markdown")}><Download size={13} /></button>
          <button className="icon-button" onClick={() => void remove(story.id)} aria-label={t("Supprimer cette histoire", "Delete this story")} title={t("Supprimer cette histoire", "Delete this story")}><Trash2 size={13} /></button>
        </span>
      </footer>
    </article> : agents?.length && !busy ? <EmptyState title={t("Pas encore d’histoire", "No story yet")}>{t(`Clique sur « Écrire l’histoire » : ${agent?.name ?? "ton agent"} racontera tes dernières 24 h à partir des faits ci-dessous. Chaque jour à 18 h si tu l’actives dans Réglages.`, `Click “Write the story”: ${agent?.name ?? "your agent"} will tell your last 24 hours from the facts below. Every day at 18:00 if you turn it on in Settings.`)}</EmptyState> : null}
    {asking && <Consent agent={asking} preview={previewStory(events).prompt} onCancel={() => setAsking(null)} onAllow={() => { storySettings.consent(asking.provider); const target = asking; setAsking(null); void run(target); }} />}
  </section>;
}
