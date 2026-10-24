import { useConfiguredModels } from "./useConfiguredModels";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import { formatCompact, formatDuration } from "./analytics";
import { costLabelText, useSubscription } from "./costPreferences";
import { InfoTip } from "./Explain";
import { locale, t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { providerFor, providers } from "./providers";

/** The one vocabulary for agent states, used by the cards, the race and the help panel. */
export function statusInfo(status: PulseStatus): { label: string; explanation: string } {
  switch (status) {
    case "looping": return { label: t("Tourne en rond", "Going in circles"), explanation: t("L’agent répète les mêmes actions sans avancer (même commande, même fichier, même enchaînement). Interviens : il consomme des tokens pour rien.", "The agent repeats the same actions without progress (same command, same file, same sequence). Step in: it burns tokens for nothing.") };
    case "blocked": return { label: t("Bloqué", "Blocked"), explanation: t("Au moins deux outils ont échoué d’affilée. Jette un œil à sa session.", "At least two tools failed in a row. Have a look at its session.") };
    case "stalled": return { label: t("Silencieux", "Silent"), explanation: t("Un tour est en cours mais rien ne se passe depuis plus de 2 minutes. Il attend souvent une validation ou une réponse de ta part.", "A turn is open but nothing happened for over 2 minutes. It often waits for your approval or answer.") };
    case "waiting": return { label: t("T’attend", "Waiting for you"), explanation: t("Son dernier tour est terminé : il est prêt pour ton prochain message.", "Its last turn is done: it is ready for your next message.") };
    case "working": return { label: t("Au travail", "Working"), explanation: t("Il agit en ce moment : des événements arrivent depuis moins de 45 secondes.", "It is acting right now: events arrived less than 45 seconds ago.") };
    case "idle": return { label: t("Au repos", "Idle"), explanation: t("Aucune activité récente ; sa dernière session est terminée ou ancienne.", "No recent activity; its last session ended or is old.") };
    case "never": return { label: t("Pas encore vu", "Not seen yet"), explanation: t("Aucun événement reçu de cet agent. Vérifie son connecteur dans l’onglet Connecteurs.", "No event received from this agent. Check its connector in the Connectors tab.") };
  }
}

const fallbackProvider = providers.find((provider) => provider.eventKey === "custom")!;

export function since(at: number | null, now: number) {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return t("à l’instant", "just now");
  if (seconds < 60) return t(`il y a ${seconds} s`, `${seconds}s ago`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(`il y a ${minutes} min`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t(`il y a ${hours} h`, `${hours} h ago`) : t(`il y a ${Math.floor(hours / 24)} j`, `${Math.floor(hours / 24)} d ago`);
}

function Stat({ label, value, explanation, tone }: { label: string; value: string; explanation: string; tone?: "bad" }) {
  return <div className={`agent-stat ${tone ?? ""}`} title={explanation}><dt>{label}</dt><dd>{value}</dd></div>;
}

/**
 * One line of identity, one line of "what is it doing", one line of numbers, one thin activity
 * strip. Explanations live in tooltips; the whole card leads to the agent.
 */
export function AgentCard({ pulse, now, repository, compact = false, onGoTo }: { pulse: AgentPulse; now: number; repository: string | null; compact?: boolean; onGoTo?: (pulse: AgentPulse) => void }) {
  const provider = providerFor(pulse.key) ?? fallbackProvider;
  const status = statusInfo(pulse.status);
  const [subscription] = useSubscription(pulse.key);
  const session = pulse.session;
  const failRate = session && session.toolCalls ? Math.round((session.failures / session.toolCalls) * 100) : 0;
  const tokens = session && (session.inputTokens !== null || session.outputTokens !== null) ? (session.inputTokens ?? 0) + (session.outputTokens ?? 0) : null;
  const sparkMax = Math.max(1, ...pulse.spark);
  const folder = pulse.project?.project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  const place = repository ?? (folder ? t(`${folder} (hors workspace)`, `${folder} (outside the workspace)`) : t("dépôt inconnu", "unknown repository"));
  const configured = useConfiguredModels()[provider.eventKey];
  const reported = session ? (session.models?.length ? session.models : [session.model]).filter(Boolean).join(" · ") : "";
  const model = reported || (configured ? t(`${configured} (choisi)`, `${configured} (selected)`) : "");
  const note = pulse.status === "looping" && pulse.loop ? t(`Boucle détectée : ${pulse.loop.evidence}.`, `Loop detected: ${pulse.loop.evidence}.`) : pulse.status === "blocked" ? t(`${pulse.failureStreak} échecs d’affilée`, `${pulse.failureStreak} failures in a row`) : null;
  const needsYou = pulse.status === "waiting" || pulse.status === "stalled";

  // The whole card leads to the agent; its own buttons keep their role.
  const canGo = Boolean(onGoTo && pulse.session);
  const go = (event: MouseEvent | KeyboardEvent) => {
    if (!canGo || (event.target as HTMLElement).closest("button, a, summary, details")) return;
    if ("key" in event && event.key !== "Enter") return;
    onGoTo!(pulse);
  };
  const doing = pulse.current ? `${pulse.current.text}${pulse.current.detail ? ` · ${pulse.current.detail}` : ""}` : status.explanation;

  return <article className={`agent-card status-${pulse.status} ${compact ? "compact" : ""} ${canGo ? "clickable" : ""}`} style={{ "--agent-color": provider.color } as CSSProperties} aria-label={`${provider.name} : ${status.label}`} onClick={go} onKeyDown={go} tabIndex={canGo ? 0 : undefined} title={canGo ? t("Cliquer pour aller là où travaille l’agent", "Click to go where the agent works") : undefined}>
    <header className="agent-card-header">
      <ProviderMark provider={provider} small />
      <div className="agent-card-title">
        <b>{provider.name}</b>
        <span title={model ? `${place} · ${model}` : place}>{place}{model ? ` · ${model}` : ""}</span>
      </div>
      <span className="status-badge" title={status.explanation}>{status.label}</span>
      {canGo && <button className={`go-to-agent ${needsYou ? "primary" : ""}`} onClick={() => onGoTo!(pulse)} aria-label={needsYou ? t("Lui répondre", "Reply") : t("Aller à l’agent", "Go to agent")} title={needsYou ? t("Lui répondre", "Reply") : t("Aller à l’agent", "Go to agent")}><ArrowUpRight size={14} />{needsYou && <span>{t("Répondre", "Reply")}</span>}</button>}
    </header>

    <p className={`agent-now tone-${pulse.current?.tone ?? "info"}`} title={note ?? doing}>
      <span className="agent-now-text">{note ?? doing}</span>
      {pulse.current && <time>{since(pulse.current.at, now)}</time>}
    </p>

    {session && <dl className="agent-stats">
      <Stat label={pulse.turnStartedAt !== null ? t("Tour", "Turn") : t("Tours", "Turns")} value={pulse.turnStartedAt !== null ? formatDuration(Math.max(0, now - pulse.turnStartedAt)) : String(session.turns)} explanation={pulse.turnStartedAt !== null ? t("Temps écoulé depuis ton dernier message à l’agent.", "Time since your last message to the agent.") : t("Nombre d’échanges (ton message puis le travail de l’agent) dans sa session actuelle.", "Number of exchanges (your message, then the agent’s work) in its current session.")} />
      <Stat label={t("Outils", "Tools")} value={failRate ? `${session.toolCalls} · ${failRate}%` : String(session.toolCalls)} tone={failRate >= 20 ? "bad" : undefined} explanation={t("Actions lancées par l’agent dans sa session (lire, modifier, exécuter…) et la part qui a échoué.", "Actions the agent ran in its session (read, edit, run…) and the share that failed.")} />
      <Stat label="Tokens" value={tokens === null ? "—" : formatCompact(tokens)} explanation={tokens === null ? t("Ce connecteur ne transmet pas de compteur de tokens pour cette session.", "This connector reports no token counter for this session.") : t(`Volume de texte traité par le modèle dans la session : ${formatCompact(session.inputTokens ?? 0)} lus (contexte, cache compris) et ${formatCompact(session.outputTokens ?? 0)} écrits.`, `Text processed by the model in the session: ${formatCompact(session.inputTokens ?? 0)} read (context, cache included) and ${formatCompact(session.outputTokens ?? 0)} written.`)} />
      {session.cost !== null
        ? <Stat label={subscription ? t("Valeur", "Value") : t("Coût", "Cost")} value={"≈ " + session.cost.toLocaleString(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 2 })} explanation={subscription ? t("Ce que ces tokens coûteraient au tarif API. Tu es au forfait : ce n’est pas ce que tu paies.", "What these tokens would cost at API prices. You are on a subscription: this is not what you pay.") : t("Estimation à partir des prix publics du modèle et des tokens fournis. Ce n’est pas une facture : forfaits et remises ne sont pas connus.", "Estimate from the model’s public prices and the reported tokens. Not an invoice: plans and discounts are unknown.")} />
        : <Stat label={t("Fichiers", "Files")} value={String(session.filesChanged)} explanation={t("Fichiers différents que l’agent a modifiés pendant sa session (d’après les outils qu’il a utilisés).", "Distinct files the agent edited in its session (from the tools it used).")} />}
    </dl>}

    <div className="agent-spark" role="img" aria-label={t("Activité minute par minute sur les 15 dernières minutes", "Activity per minute over the last 15 minutes")} title={t("Activité · 15 dernières minutes", "Activity · last 15 minutes")}>{pulse.spark.map((value, index) => <i key={index} style={{ height: `${value ? Math.max(18, (value / sparkMax) * 100) : 8}%` }} className={value ? "" : "empty"} />)}</div>
  </article>;
}
