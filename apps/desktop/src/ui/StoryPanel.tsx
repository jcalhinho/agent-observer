import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, Feather, Square, Trash2 } from "lucide-react";
import { EmptyState } from "./Explain";
import { locale, t } from "./i18n";
import { Prose } from "./Prose";
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

/** Says what will be sent and to whom, once per agent, before anything leaves the computer. */
function Consent({ agent, events, onAllow, onCancel }: { agent: StoryAgent; events: SessionEvent[]; onAllow: () => void; onCancel: () => void }) {
  const preview = useMemo(() => previewStory(events), [events]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <header className="dialog-header"><h2 id="consent-title">{t(`Écrire l’histoire avec ${agent.name} ?`, `Write the story with ${agent.name}?`)}</h2></header>
      <div className="dialog-body">
        <p>{t(`L’app lance ${agent.name} (${originLabel(agent.origin)}${agent.version ? `, ${agent.version}` : ""}) une seule fois, sans aucun outil et dans un dossier vide, avec le résumé ci-dessous. Il est envoyé à son fournisseur, comme tout ce que tu lui écris, et consomme ton forfait ou tes crédits. Aucune clé n’est demandée.`, `The app runs ${agent.name} (${originLabel(agent.origin)}${agent.version ? `, ${agent.version}` : ""}) once, with no tools and in an empty folder, on the summary below. It goes to its provider like anything you type to it and uses your plan or credits. No key is asked for.`)}</p>
        <p>{t("Ce résumé ne contient ni le texte de tes messages, ni tes commandes, ni les dossiers de ton disque : seulement des chiffres, des noms de projets, de modèles, d’outils et de fichiers.", "The summary holds neither the text of your messages, nor your commands, nor your disk folders: only numbers and the names of projects, models, tools and files.")}</p>
        <details className="consent-facts"><summary>{t("Voir exactement ce qui est envoyé", "See exactly what is sent")}</summary><pre>{preview.prompt}</pre></details>
        <div className="dialog-actions"><button className="button" onClick={onCancel}>{t("Annuler", "Cancel")}</button><button className="button primary" onClick={onAllow}>{t("Autoriser et écrire", "Allow and write")}</button></div>
      </div>
    </section>
  </div>;
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
    {asking && <Consent agent={asking} events={events} onCancel={() => setAsking(null)} onAllow={() => { storySettings.consent(asking.provider); const target = asking; setAsking(null); void run(target); }} />}
  </section>;
}
