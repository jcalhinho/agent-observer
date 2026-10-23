import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Send, Square, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { buildAskFacts, buildAskPrompt, readAnswer, STARTERS, type Suggestion, type Turn } from "./ask";
import { isDayRange, rangeLabel, type AnalyticsRange } from "./analytics";
import { Consent } from "./Consent";
import { currentLang, t } from "./i18n";
import { Prose } from "./Prose";
import { describeStoryError } from "./StoryPanel";
import type { SessionEvent } from "./types";
import { askAgent, cancelStory, pickAgent, storySettings, StoryError, useStoryAgents, type StoryAgent } from "./useStory";

type Message = Turn & { suggestions?: Suggestion[]; failed?: boolean };

/**
 * Questions about the history ("why were there errors?"), answered by an agent already installed
 * here from facts the app selects for the period shown below the race. Nothing is kept.
 */
export function AskPanel({ events, range, onOpenSession }: { events: SessionEvent[]; range: AnalyticsRange; onOpenSession: (key: string) => void }) {
  const { agents } = useStoryAgents();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ agent: StoryAgent; question: string; preview: string } | null>(null);
  const [chosen, setChosen] = useState(() => storySettings.agent());
  const [copied, setCopied] = useState<string | null>(null);
  const refs = useRef<Map<string, string>>(new Map());
  const end = useRef<HTMLDivElement>(null);
  const agent = agents ? pickAgent(agents, chosen) : null;
  const period = range === "all" ? t("tout l’historique", "the whole history") : isDayRange(range) ? rangeLabel(range) : rangeLabel(range);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages.length, busy]);

  /** The facts, with the subjects of the commits made while the main sessions ran (when Git can tell). */
  async function gather() {
    const now = Date.now();
    const lang = currentLang();
    const first = buildAskFacts(events, range, now, lang);
    const found: Record<string, string[]> = {};
    await Promise.all(first.targets.map(async (target) => {
      try {
        const result = await invoke<{ commits: Array<{ subject: string }> }>("commits_in_window", { path: target.projectPath, since: target.from, until: target.to });
        const subjects = result.commits.slice(0, 5).map((commit) => commit.subject.slice(0, 90));
        if (subjects.length) found[target.ref] = subjects;
      } catch { /* not a Git folder, or Git is missing: no commit facts */ }
    }));
    return Object.keys(found).length ? buildAskFacts(events, range, now, lang, found) : first;
  }

  async function send(question: string, target: StoryAgent) {
    const history = messages.filter((message) => !message.failed).map(({ role, text }) => ({ role, text }));
    setMessages((current) => [...current, { role: "user", text: question }]);
    setDraft("");
    setBusy(true);
    try {
      const { facts, refs: map } = await gather();
      refs.current = map;
      const answer = readAnswer(await askAgent(target.provider, buildAskPrompt(question, history, facts)));
      setMessages((current) => [...current, { role: "assistant", text: answer.text, suggestions: answer.suggestions }]);
    } catch (error) {
      if (!(error instanceof StoryError && error.code === "cancelled")) setMessages((current) => [...current, { role: "assistant", text: describeStoryError(error), failed: true }]);
    } finally {
      setBusy(false);
    }
  }
  function ask(question: string) {
    const text = question.trim();
    if (!text || busy || !agent) return;
    if (storySettings.consented().includes(agent.provider)) void send(text, agent);
    else void gather().then(({ facts }) => setAsking({ agent, question: text, preview: buildAskPrompt(text, [], facts) }));
  }

  return <section className="panel ask">
    <div className="panel-bar">
      <h3 className="block-title">{t("Demander", "Ask")} <small>{t(`sur ${period}`, `about ${period}`)}</small></h3>
      {agents && agents.length > 1 && <select className="field-select" value={agent?.provider ?? ""} onChange={(event) => setChosen(event.target.value)} aria-label={t("Agent qui répond", "Answering agent")} disabled={busy}>{agents.map((candidate) => <option key={candidate.provider} value={candidate.provider}>{candidate.name}</option>)}</select>}
      {messages.length > 0 && <button className="icon-button" onClick={() => setMessages([])} disabled={busy} aria-label={t("Nouvelle conversation", "New conversation")} title={t("Nouvelle conversation", "New conversation")}><Trash2 size={13} /></button>}
    </div>

    {agents && !agents.length && <p className="notice warn">{t("Aucun agent compatible trouvé : Claude Code, Codex, Gemini CLI, Qwen Code ou OpenCode.", "No supported agent found: Claude Code, Codex, Gemini CLI, Qwen Code or OpenCode.")}</p>}
    {!messages.length && <div className="ask-intro">
      <p className="panel-lead">{t("Pose une question sur ce qui s’est passé sur la période choisie sous la course. La réponse vient de ton agent installé, à partir de faits calculés ici ; elle cite les sessions concernées, un clic les ouvre dans l’historique.", "Ask about what happened in the period chosen under the race. The answer comes from your installed agent, from facts computed here; it cites the sessions it relies on and a click opens them in the history.")}</p>
      <div className="ask-starters">{STARTERS.map((starter) => <button key={starter.en} className="button small" onClick={() => ask(t(starter.fr, starter.en))} disabled={!agent || busy}>{t(starter.fr, starter.en)}</button>)}</div>
      <p className="panel-note">{t("Les messages d’erreur ne sont pas enregistrés par défaut : pour comprendre le « pourquoi », active « Garder les messages d’erreur » dans Réglages.", "Error messages are not recorded by default: to understand the “why”, turn on “Keep error messages” in Settings.")}</p>
    </div>}

    <div className="ask-thread" aria-live="polite">
      {messages.map((message, index) => message.role === "user"
        ? <p key={index} className="ask-user">{message.text}</p>
        : <article key={index} className={`ask-answer ${message.failed ? "is-error" : ""}`}>
            {message.failed ? <p>{message.text}</p> : <Prose text={message.text} onRef={(ref) => { const key = refs.current.get(ref); if (key) onOpenSession(key); }} />}
            {message.suggestions && message.suggestions.length > 0 && <div className="ask-suggestions">
              <h4 className="block-title">{t("Pistes à toi de décider", "Ideas, for you to decide")}</h4>
              {message.suggestions.map((suggestion) => <div key={suggestion.message} className="ask-suggestion">
                <span><b>{suggestion.agent}</b>{suggestion.message}</span>
                <button className="icon-button" onClick={() => { void navigator.clipboard.writeText(suggestion.message); setCopied(suggestion.message); window.setTimeout(() => setCopied(null), 1400); }} aria-label={t("Copier le message", "Copy the message")} title={copied === suggestion.message ? t("Copié", "Copied") : t("Copier le message", "Copy the message")}><Copy size={13} /></button>
              </div>)}
              <p className="panel-note">{t("L’app n’envoie rien à ta place : copie le message et colle-le dans l’agent.", "The app sends nothing for you: copy the message and paste it into the agent.")}</p>
            </div>}
          </article>)}
      {busy && <p className="story-wait" role="status"><i />{t(`${agent?.name ?? "L’agent"} réfléchit…`, `${agent?.name ?? "The agent"} is thinking…`)}</p>}
      <div ref={end} />
    </div>

    <form className="ask-form" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(draft); } }} rows={2} maxLength={600} placeholder={t("Ex. : pourquoi Codex a échoué cet après-midi ?", "E.g. why did Codex fail this afternoon?")} aria-label={t("Ta question", "Your question")} disabled={!agent} />
      {busy ? <button type="button" className="button" onClick={() => void cancelStory()}><Square size={12} />{t("Annuler", "Cancel")}</button> : <button className="button primary" disabled={!draft.trim() || !agent}><Send size={13} />{t("Envoyer", "Send")}</button>}
    </form>
    {asking && <Consent agent={asking.agent} purpose="ask" preview={asking.preview} onCancel={() => setAsking(null)} onAllow={() => { storySettings.consent(asking.agent.provider); const pending = asking; setAsking(null); void send(pending.question, pending.agent); }} />}
  </section>;
}
