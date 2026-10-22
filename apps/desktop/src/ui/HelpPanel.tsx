import { statusInfo } from "./AgentCard";
import type { PulseStatus } from "./agentPulse";
import { t } from "./i18n";

function glossary(): Array<[string, string]> {
  return [
    [t("Agent", "Agent"), t("Un assistant de code (Claude Code, Codex, Gemini CLI, OpenCode, Qwen Code…) qui lit et modifie ton projet à ta demande.", "A coding assistant (Claude Code, Codex, Gemini CLI, OpenCode, Qwen Code…) that reads and edits your project on request.")],
    [t("Session", "Session"), t("Une conversation avec un agent, du premier message à la fermeture.", "One conversation with an agent, from the first message to closing it.")],
    [t("Tour", "Turn"), t("Un aller-retour : ton message, puis tout le travail que l’agent fait pour y répondre.", "One round trip: your message, then all the work the agent does to answer it.")],
    [t("Outil", "Tool"), t("Une action de l’agent : lire un fichier, le modifier, chercher dans le code, lancer une commande…", "An action of the agent: read a file, edit it, search the code, run a command…")],
    [t("Événement", "Event"), t("Une trace reçue par l’app : une action, un message, la fin d’un tour, un relevé de tokens.", "A trace received by the app: an action, a message, the end of a turn, a token report.")],
    ["Token", t("Unité de texte traitée par le modèle d’IA (environ ¾ de mot). Les « tokens lus » sont le contexte envoyé au modèle, les « tokens écrits » sa réponse.", "Unit of text processed by the AI model (about ¾ of a word). “Read” tokens are the context sent to the model, “written” tokens its answer.")],
    ["Cache", t("Partie du contexte que le fournisseur a déjà vue et réutilise : elle coûte beaucoup moins cher (10 % du prix chez Anthropic).", "Part of the context the provider has already seen and reuses: it costs far less (10% of the price at Anthropic).")],
    [t("Coût estimé", "Estimated cost"), t("Calcul à partir des prix publics du modèle. Ce n’est pas une facture : abonnements, forfaits et remises ne sont pas connus de l’app.", "Computed from the model’s public prices. Not an invoice: subscriptions, plans and discounts are unknown to the app.")],
    ["Workspace", t("Un dossier (ou un fichier .code-workspace de VS Code) qui regroupe plusieurs dépôts Git suivis ensemble.", "A folder (or a VS Code .code-workspace file) grouping several Git repositories followed together.")],
    [t("Dépôt", "Repository"), t("Un projet suivi par Git. L’app montre son état (branche, changements non enregistrés) à côté de l’activité des agents.", "A project tracked by Git. The app shows its state (branch, uncommitted changes) next to the agents’ activity.")],
    [t("Connecteur", "Connector"), t("La façon dont l’app observe un agent : en lisant ses journaux, en recevant ses notifications (hooks) ou via l’API locale.", "How the app observes an agent: reading its logs, receiving its notifications (hooks) or through the local API.")]
  ];
}

const STATUS_ORDER: PulseStatus[] = ["looping", "blocked", "stalled", "waiting", "working", "idle", "never"];

/** How the app works, what every state means, and the vocabulary used. */
export function HelpContent() {
  return <div className="help-content">
        <section>
          <h3>{t("En une phrase", "In one sentence")}</h3>
          <p>{t("Agent Observer regarde travailler tes agents de code sur cet ordinateur et te montre, en direct, ce qu’ils font, où, ce que ça consomme, et quand ils ont besoin de toi. Il ne les pilote jamais et n’envoie rien sur Internet, sauf quand tu demandes l’histoire du jour (voir plus bas).", "Agent Observer watches your coding agents work on this computer and shows you, live, what they do, where, what it costs, and when they need you. It never drives them and sends nothing over the Internet, except when you ask for the daily story (see below).")}</p>
        </section>
        <section>
          <h3>{t("Se repérer", "Finding your way")}</h3>
          <p>{t("Au centre, la course : chaque agent est un coureur. En bas, une pastille par agent (clique pour aller à lui). Sur chaque bord de la fenêtre, un rail d’onglets ouvre un tiroir :", "In the middle, the race: each agent is a runner. Along the bottom, one chip per agent (click to go to it). On each edge of the window a rail of tabs opens a drawer:")}</p>
          <ul>
            <li><b>{t("Gauche", "Left")}</b> : {t("agents en détail, sessions, dépôts.", "agents in detail, sessions, repositories.")}</li>
            <li><b>{t("Droite", "Right")}</b> : {t("l’histoire des 24 h et les graphiques.", "the 24 h story and the charts.")}</li>
            <li><b>{t("Bas", "Bottom")}</b> : {t("le fil d’activité et ce qui demande ton attention.", "the activity feed and what needs your attention.")}</li>
            <li><b>{t("Haut", "Top")}</b> : {t("connecteurs, réglages et cette aide.", "connectors, settings and this help.")}</li>
          </ul>
          <p>{t("Tire le bord intérieur d’un tiroir pour l’agrandir, épingle-le pour que la scène lui laisse la place, Échap referme les tiroirs libres.", "Drag a drawer’s inner edge to resize it, pin it so the stage makes room, Escape closes the loose drawers.")}</p>
        </section>
        <section>
          <h3>{t("Bien démarrer", "Getting started")}</h3>
          <ol className="steps">
            <li><b>{t("Connecteurs", "Connectors")}</b> : {t("vérifie que tes agents sont détectés ; branche Claude Code si tu l’utilises.", "check that your agents are detected; set up Claude Code if you use it.")}</li>
            <li><b>Workspace</b> : {t("choisis le dossier qui contient tes projets (en haut à droite de la scène).", "pick the folder that holds your projects (top right of the stage).")}</li>
            <li>{t("Travaille normalement avec tes agents : la scène se remplit toute seule.", "Work with your agents as usual: the stage fills itself.")}</li>
          </ol>
        </section>
        <section>
          <h3>{t("L’histoire du jour", "The daily story")}</h3>
          <p>{t("Un agent que tu as déjà (Claude Code, Codex, Gemini CLI, Qwen Code ou OpenCode) écrit l’histoire de tes dernières 24 h à partir d’un résumé calculé ici : à la demande, ou chaque jour à l’heure choisie (18 h par défaut). Il est lancé une seule fois, sans outil, dans un dossier vide ; rien n’est envoyé avant ton accord, et tu peux voir le résumé exact. Cela consomme ton forfait.", "An agent you already have (Claude Code, Codex, Gemini CLI, Qwen Code or OpenCode) writes the story of your last 24 hours from a summary computed here: on demand, or every day at the chosen time (18:00 by default). It runs once, with no tools, in an empty folder; nothing is sent before you agree, and you can see the exact summary. It uses your plan.")}</p>
        </section>
        <section>
          <h3>{t("Que veulent dire les statuts ?", "What do the statuses mean?")}</h3>
          <dl className="status-list">{STATUS_ORDER.map((status) => <div key={status} className={`status-${status}`}><dt><span className="status-badge">{statusInfo(status).label}</span></dt><dd>{statusInfo(status).explanation}</dd></div>)}</dl>
        </section>
        <section>
          <h3>{t("Notifications", "Notifications")}</h3>
          <p>{t("L’app te prévient quand un agent t’attend, demande une validation, devient silencieux, enchaîne les erreurs ou tourne en rond. Un clic sur la notification t’amène à l’agent. Les alertes (boucle, erreurs) s’affichent aussi en rouge en haut de l’app. Tout se règle dans Réglages.", "The app tells you when an agent waits for you, asks for approval, goes silent, keeps failing or goes round in circles. Clicking the notification takes you to the agent. Alerts (loops, errors) also show in red at the top of the app. Everything is set in Settings.")}</p>
        </section>
        <section>
          <h3>{t("Lire les chiffres", "Reading the numbers")}</h3>
          <p>{t("Les valeurs viennent de ce que chaque agent transmet. Quand un agent ne fournit pas une information (par exemple les tokens), l’app affiche « non fourni » plutôt que d’inventer un chiffre. Les estimations (coût) sont toujours signalées comme telles.", "Values come from what each agent reports. When an agent doesn’t provide something (tokens, for instance), the app shows “not reported” rather than making up a number. Estimates (cost) are always labelled as such.")}</p>
          <p>{t("Un changement Git n’est jamais attribué à un agent : l’app montre l’état des dépôts et l’activité des agents côte à côte, sans deviner qui a fait quoi.", "A Git change is never attributed to an agent: the app shows repository state and agent activity side by side, without guessing who did what.")}</p>
        </section>
        <section>
          <h3>{t("Glossaire", "Glossary")}</h3>
          <dl className="glossary">{glossary().map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
        </section>
  </div>;
}
