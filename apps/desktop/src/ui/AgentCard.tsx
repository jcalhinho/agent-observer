import type { CSSProperties } from "react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import { t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { providerFor, providers } from "./providers";
import { useConfiguredModels } from "./useConfiguredModels";

/** Le vocabulaire unique des états d'agent. */
export function statusInfo(status: PulseStatus): { label: string; explanation: string } {
  switch (status) {
    case "looping": return { label: t("Tourne en rond", "Going in circles"), explanation: t("L’agent répète les mêmes actions sans avancer. Interviens : il consomme des tokens pour rien.", "The agent repeats the same actions without progress. Step in: it burns tokens for nothing.") };
    case "blocked": return { label: t("Bloqué", "Blocked"), explanation: t("Au moins deux outils ont échoué d’affilée.", "At least two tools failed in a row.") };
    case "stalled": return { label: t("Silencieux", "Silent"), explanation: t("Un tour est en cours mais rien ne se passe depuis plus de 2 minutes. Il attend souvent une validation.", "A turn is open but nothing happened for over 2 minutes. It often waits for your approval.") };
    case "waiting": return { label: t("T’attend", "Waiting for you"), explanation: t("Son dernier tour est terminé : il est prêt pour ton prochain message.", "Its last turn is done: it is ready for your next message.") };
    case "working": return { label: t("Au travail", "Working"), explanation: t("Il agit en ce moment.", "It is acting right now.") };
    case "idle": return { label: t("Au repos", "Idle"), explanation: t("Aucune activité récente.", "No recent activity.") };
    case "never": return { label: t("Pas encore vu", "Not seen yet"), explanation: t("Aucun événement reçu de cet agent.", "No event received from this agent.") };
  }
}

/** Âge d'un événement, en clair. */
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

/** 12 400 -> « 12,4k ». */
function compact(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(".", ",")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
}

const fallback = providers.find((provider) => provider.eventKey === "custom")!;

/**
 * Où travaille l'agent, en un mot lisible.
 *
 * Trois cas à gérer : certains agents (Reasonix) ne transmettent pas leur
 * répertoire de travail, mais bien le chemin des fichiers qu'ils touchent ;
 * un chemin qui est le dossier personnel afficherait sinon le nom de
 * l'utilisateur, ce qui n'apprend rien ; et la racine n'a pas de dernier
 * segment. Le chemin complet reste au survol.
 */
export function placeOf(project: { project_path: string | null; file_path: string | null } | null): { label: string; full: string | null } {
  const raw = project?.project_path ?? null;
  // Faute de répertoire de travail, le dossier parent du dernier fichier touché.
  const derived = raw ?? (project?.file_path ? project.file_path.replaceAll("\\", "/").split("/").slice(0, -1).join("/") : null);
  if (!derived) return { label: t("dossier inconnu", "unknown folder"), full: null };

  const parts = derived.replaceAll("\\", "/").split("/").filter(Boolean);
  // `/Users/<nom>` ou `/home/<nom>` : c'est le dossier personnel.
  const isHome = parts.length === 2 && (parts[0] === "Users" || parts[0] === "home");
  const label = isHome ? "~" : parts.at(-1) ?? "/";
  return { label: raw ? label : t(`${label} (déduit)`, `${label} (inferred)`), full: derived };
}

/**
 * Une carte, huit informations : qui, son état, ce qu'il fait, depuis quand, où, quel modèle,
 * combien de tokens, et le remplissage du contexte. Rien d'autre.
 */
export function AgentCard({ pulse, now }: { pulse: AgentPulse; now: number }) {
  const provider = providerFor(pulse.key) ?? fallback;
  const status = statusInfo(pulse.status);
  const session = pulse.session;

  // 6. Ce qui va mal passe devant ce que l'agent raconte.
  const trouble = pulse.status === "looping" && pulse.loop
    ? t(`Boucle : ${pulse.loop.evidence}`, `Loop: ${pulse.loop.evidence}`)
    : pulse.status === "blocked"
      ? t(`${pulse.failureStreak} échecs d’affilée`, `${pulse.failureStreak} failures in a row`)
      : null;

  // 3. Ce qu'il fait, là.
  const doing = pulse.current
    ? `${pulse.current.text}${pulse.current.detail ? ` · ${pulse.current.detail}` : ""}`
    : status.explanation;

  // 4. Où.
  const place = placeOf(pulse.project);

  // 8. Quel modèle : celui de la dernière réponse, sinon celui qui est
  //    configuré dans les réglages de l'agent.
  const configured = useConfiguredModels()[provider.eventKey];
  const model = pulse.model ?? configured ?? null;
  // Un agent peut changer de modèle en cours de session, ou en utiliser un
  // plus petit pour une tâche de fond : on le dit au survol plutôt que
  // d'afficher un nom trompeur.
  const modelTitle = pulse.modelsSeen.length > 1
    ? t(`Modèle de la dernière réponse. Dans cette session : ${pulse.modelsSeen.join(", ")}.`, `Model of the latest response. In this session: ${pulse.modelsSeen.join(", ")}.`)
    : pulse.model
      ? t("Modèle de la dernière réponse", "Model of the latest response")
      : t("Modèle choisi dans les réglages de l’agent ; aucune réponse encore observée", "Model selected in the agent’s settings; no response observed yet");

  // 7. Combien il consomme.
  const tokens = session && (session.inputTokens !== null || session.outputTokens !== null)
    ? (session.inputTokens ?? 0) + (session.outputTokens ?? 0)
    : null;
  const context = pulse.context;

  return <article
    className={`card status-${pulse.status}`}
    style={{ "--agent-color": provider.color } as CSSProperties}
    aria-label={`${provider.name} : ${status.label}`}
  >
    <header className="card-head">
      <ProviderMark provider={provider} small />
      <b>{provider.name}</b>
      <span className="badge" title={status.explanation}>{status.label}</span>
    </header>

    <p className={`card-doing ${trouble ? "trouble" : `tone-${pulse.current?.tone ?? "info"}`}`}>
      <span>{trouble ?? doing}</span>
      <time dateTime={pulse.lastEventAt ? new Date(pulse.lastEventAt).toISOString() : undefined}>
        {since(pulse.lastEventAt, now)}
      </time>
    </p>

    <p className="card-where">
      <span title={place.full ?? undefined}>{place.label}</span>
      {pulse.launchMode && <span className="card-launch" title={t("Comment l’agent a été lancé, d’après ce qu’il rapporte", "How the agent was launched, as it reports it")}>{pulse.launchMode}</span>}
      {model && <span className={`card-model ${pulse.modelsSeen.length > 1 ? "mixed" : ""}`} title={modelTitle}>{model}{pulse.modelsSeen.length > 1 ? " +" : ""}</span>}
    </p>

    <div className="card-usage">
      <span className="card-tokens" title={session ? t(`${compact(session.inputTokens ?? 0)} lus, ${compact(session.outputTokens ?? 0)} écrits dans cette session`, `${compact(session.inputTokens ?? 0)} read, ${compact(session.outputTokens ?? 0)} written in this session`) : undefined}>
        {tokens === null ? t("tokens inconnus", "tokens unknown") : `${compact(tokens)} tokens`}
      </span>
      {context?.percent !== null && context !== null && <span className={`card-ctx state-${context.state}`} title={t("Remplissage de la fenêtre de contexte", "How full the context window is")}>
        {t("contexte", "context")} {Math.round(context.percent)}%
      </span>}
    </div>

    {context?.percent !== null && context !== null && <div className={`ctx-bar state-${context.state}`} role="img" aria-label={t(`Contexte rempli à ${Math.round(context.percent)} %`, `Context ${Math.round(context.percent)}% full`)}>
      <i style={{ width: `${Math.min(100, Math.max(2, context.percent))}%` }} />
    </div>}
  </article>;
}
