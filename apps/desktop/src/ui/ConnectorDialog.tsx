import { useState, type ReactNode } from "react";
import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { ConnectorKind } from "./providers";

type ClaudeSetup = { endpoint: string; token: string; settings_fragment: string; statusline_fragment: string };
type CodexSetup = { sessions_dir: string; available: boolean };
type OpenCodeSetup = { data_dir: string; database_paths: string[]; available: boolean };
type HermesSetup = { home: string; database_paths: string[]; available: boolean };
type CopilotSetup = { sessions_dir: string; available: boolean };
type AntigravitySetup = { data_dir: string; available: boolean };
type QwenSetup = { projects_dir: string; available: boolean };
type CursorSetup = { endpoint: string; settings_fragment: string };
type ReasonixSetup = { projects_dir: string; available: boolean };
type ContinueSetup = { dev_data_dir: string; available: boolean };
type SourceSetup = { paths: string[]; available: boolean };
type NoSetup = Record<string, never>;
type SourceKind = "gemini" | "pi" | "omp" | "kimi" | "goose" | "crush" | "zed";
const SOURCE_KINDS: readonly ConnectorKind[] = ["gemini", "pi", "omp", "kimi", "goose", "crush", "zed"];
type SetupByKind = { cursor: CursorSetup; reasonix: ReasonixSetup; claude: ClaudeSetup; codex: CodexSetup; opencode: OpenCodeSetup; qwen: QwenSetup; antigravity: AntigravitySetup; copilot: CopilotSetup; continue: ContinueSetup; hermes: HermesSetup } & { [K in SourceKind]: SourceSetup } & { aider: NoSetup; process: NoSetup };

export type ConnectorSetup = { [K in ConnectorKind]: { kind: K; setup: SetupByKind[K] } }[ConnectorKind];

const SETUP_COMMANDS: Record<Exclude<ConnectorKind, SourceKind | "aider" | "process">, string> = {
  claude: "claude_setup",
  codex: "codex_setup",
  opencode: "opencode_setup",
  qwen: "qwen_setup",
  reasonix: "reasonix_setup",
  cursor: "cursor_setup",
  antigravity: "antigravity_setup",
  copilot: "copilot_setup",
  continue: "continue_setup",
  hermes: "hermes_setup"
};

export async function loadConnectorSetup(kind: ConnectorKind): Promise<ConnectorSetup> {
  if (kind === "aider" || kind === "process") return { kind, setup: {} } as ConnectorSetup;
  if (SOURCE_KINDS.includes(kind)) return { kind, setup: await invoke<SourceSetup>("source_setup", { kind }) } as ConnectorSetup;
  const setup = await invoke<SetupByKind[typeof kind]>(SETUP_COMMANDS[kind as keyof typeof SETUP_COMMANDS]);
  return { kind, setup } as ConnectorSetup;
}

/** Where a log-based connector reads from, and whether that place exists on this computer. */
export function connectorSource(connector: ConnectorSetup): { path: string; found: boolean } | null {
  switch (connector.kind) {
    case "claude": case "cursor": case "aider": case "process": return null;
    case "gemini": case "pi": case "omp": case "kimi": case "goose": case "crush": case "zed":
      return { path: connector.setup.paths.join(" · "), found: connector.setup.available };
    case "codex": return { path: connector.setup.sessions_dir, found: connector.setup.available };
    case "antigravity": return { path: connector.setup.data_dir, found: connector.setup.available };
    case "copilot": return { path: connector.setup.sessions_dir, found: connector.setup.available };
    case "qwen": return { path: connector.setup.projects_dir, found: connector.setup.available };
    case "reasonix": return { path: connector.setup.projects_dir, found: connector.setup.available };
    case "continue": return { path: connector.setup.dev_data_dir, found: connector.setup.available };
    case "hermes": return { path: connector.setup.database_paths.join(" · ") || `${connector.setup.home}/state.db`, found: connector.setup.available };
    case "opencode": return { path: connector.setup.database_paths.join(" · ") || connector.setup.data_dir, found: connector.setup.available };
  }
}

function readOnlyCopy(kind: Exclude<ConnectorKind, "claude" | "cursor" | "aider" | "process">): { name: string; how: string; tokens: string } {
  switch (kind) {
    case "codex": return { name: "Codex", how: t("L’app lit les journaux de session que Codex écrit sur ton disque, au fur et à mesure.", "The app reads the session logs Codex writes to your disk, as they are written."), tokens: t("Codex fournit les tokens de chaque requête au modèle.", "Codex reports the tokens of each model request.") };
    case "copilot": return { name: "GitHub Copilot", how: t("L’app lit les journaux d’événements que l’agent Copilot écrit sur ton disque (Copilot CLI et sessions d’agent de VS Code), au fur et à mesure. Les messages, le raisonnement et les résultats d’outils ne sont jamais enregistrés.", "The app reads the event logs the Copilot agent writes to your disk (Copilot CLI and VS Code agent sessions), as they are written. Messages, reasoning and tool results are never recorded."), tokens: t("Copilot fournit les tokens et le modèle de chaque requête.", "Copilot reports the tokens and model of each request.") };
    case "antigravity": return { name: "Antigravity", how: t("L’app lit en lecture seule les fichiers locaux d’Antigravity : la liste de ses conversations et, pour les sessions récentes, le détail de chaque étape. Les messages et le contenu des fichiers ne sont jamais enregistrés.", "The app reads Antigravity’s local files, read-only: its list of conversations and, for recent sessions, the detail of each step. Messages and file contents are never recorded."), tokens: t("Antigravity fournit les tokens de chaque étape. Pour le modèle, l’app interroge le serveur local d’Antigravity (lecture seule) : coût estimé au tarif API quand le modèle est connu.", "Antigravity reports the tokens of each step. For the model, the app asks Antigravity’s local server (read-only): the cost is estimated at API rates when the model is priced.") };
    case "qwen": return { name: "Qwen Code", how: t("L’app lit les journaux de conversation que Qwen Code écrit pour chaque projet.", "The app reads the conversation logs Qwen Code writes for each project."), tokens: t("Qwen Code fournit les tokens, le modèle et la durée de chaque requête.", "Qwen Code reports the tokens, model and duration of each request.") };
    case "reasonix": return { name: "Reasonix", how: t("L’app lit les journaux de session que Reasonix (Studio ou CLI) écrit pour chaque projet.", "The app reads the session logs Reasonix (Studio or CLI) writes for each project."), tokens: t("Reasonix fournit les tokens, le cache et le modèle de chaque requête.", "Reasonix reports the tokens, cache and model of each request.") };
    case "continue": return { name: "Continue", how: t("L’app lit les journaux locaux que l’extension Continue écrit à chaque réponse et à chaque outil (dev_data). Le texte des messages, des réponses et des outils n’est jamais enregistré. Les appels d’outils sont rattachés à la conversation de la dernière réponse vue ; seuls les appels écrits après le lancement de l’app sont lus.", "The app reads the local logs the Continue extension writes for each answer and each tool (dev_data). The text of messages, answers and tools is never recorded. Tool calls are tied to the conversation of the latest answer seen; only calls written after the app started are read."), tokens: t("Continue compte lui-même les tokens de chaque réponse avec son tokenizer : ils sont marqués estimés. L’autocomplétion n’est pas comptée.", "Continue counts each answer’s tokens itself with its tokenizer: they are marked estimated. Autocomplete is not counted.") };
    case "hermes": return { name: "Hermes", how: t("L’app lit la base de données d’Hermes (state.db, et celle de chaque profil) en lecture seule. Hermes l’écrit à la fin de chaque tour d’outils : ses actions arrivent par paquets, pas une par une. Le texte des réponses et le résultat des outils ne sont jamais enregistrés ; seuls les messages écrits après le lancement de l’app sont lus.", "The app reads Hermes’s database (state.db, and each profile’s) read-only. Hermes writes it at the end of each tool round: its actions arrive in batches, not one by one. The text of answers and tool results is never recorded; only messages written after the app started are read."), tokens: t("Hermes fournit les tokens par modèle et par session ; l’app compte ce qui s’ajoute depuis son lancement.", "Hermes reports tokens per model and session; the app counts what is added after it started.") };
    case "gemini": return { name: "Gemini CLI", how: t("L’app lit les journaux de conversation que Gemini CLI écrit pour chaque projet, au fur et à mesure.", "The app reads the conversation logs Gemini CLI writes for each project, as they are written."), tokens: t("Gemini CLI fournit les tokens et le modèle de chaque réponse ; la réflexion est ajoutée aux tokens écrits.", "Gemini CLI reports the tokens and model of each answer; thinking is added to the output tokens.") };
    case "pi": return { name: "pi", how: t("L’app lit les journaux de session que pi écrit pour chaque projet, au fur et à mesure.", "The app reads the session logs pi writes for each project, as they are written."), tokens: t("pi fournit les tokens, le cache et le modèle de chaque réponse, et ceux de ses appels annexes.", "pi reports the tokens, cache and model of each answer, and of its side calls.") };
    case "omp": return { name: "omp", how: t("L’app lit les journaux de session qu’omp (oh-my-pi) écrit pour chaque projet, au fur et à mesure.", "The app reads the session logs omp (oh-my-pi) writes for each project, as they are written."), tokens: t("omp fournit les tokens, le cache et le modèle de chaque réponse, et ceux de ses appels annexes.", "omp reports the tokens, cache and model of each answer, and of its side calls.") };
    case "kimi": return { name: "Kimi Code", how: t("L’app lit le journal que Kimi Code écrit pour chaque session (et ses sous-agents), au fur et à mesure.", "The app reads the log Kimi Code writes for each session (and its subagents), as it is written."), tokens: t("Kimi Code fournit les tokens et le cache de chaque appel au modèle.", "Kimi Code reports the tokens and cache of each model call.") };
    case "goose": return { name: "Goose", how: t("L’app lit la base de sessions de Goose en lecture seule.", "The app reads Goose’s session database, read-only."), tokens: t("Goose note les tokens de chaque appel au modèle ; l’app en retire le cache, que Goose compte dans l’entrée.", "Goose records the tokens of each model call; the app takes out the cache, which Goose counts in the input.") };
    case "crush": return { name: "Crush", how: t("L’app lit en lecture seule la base que Crush tient dans chaque projet (.crush/crush.db), d’après sa liste de projets.", "The app reads, read-only, the database Crush keeps in each project (.crush/crush.db), from its list of projects."), tokens: t("Crush ne garde que les tokens de sa dernière étape, cache compris sans le détailler : le cache n’est pas séparé, et une étape très brève peut échapper à l’app.", "Crush only keeps the tokens of its latest step, cache included but not broken out: the cache is not separated, and a very short step can escape the app.") };
    case "zed": return { name: "Zed", how: t("L’app lit en lecture seule les conversations de l’agent de Zed, et compare chaque sauvegarde à la précédente.", "The app reads the Zed agent’s conversations read-only, and compares each save with the previous one."), tokens: t("Zed garde le cumul des tokens de chaque conversation : l’app en déduit ceux de chaque échange (valeurs calculées).", "Zed keeps each conversation’s running token total: the app works out each exchange’s tokens from it (computed values).") };
    case "opencode": return { name: "OpenCode", how: t("L’app lit la base de données d’OpenCode en lecture seule.", "The app reads OpenCode’s database, read-only."), tokens: t("OpenCode fournit les tokens de chaque réponse.", "OpenCode reports the tokens of each answer.") };
  }
}

/** How a connector works and, for Claude Code, the hooks to add. Capture options live in Réglages. */
export function ConnectorSetupDialog({ connector, onClose }: { connector: ConnectorSetup; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copiedLine, setCopiedLine] = useState(false);
  if (connector.kind === "cursor") {
    const { setup } = connector;
    const copy = async () => {
      await navigator.clipboard.writeText(setup.settings_fragment);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    return <Dialog id="cursor" title={t("Brancher Cursor", "Set up Cursor")} onClose={onClose}>
      <p>{t("Cursor prévient l’app de chacune de ses actions grâce à des hooks : de petites notifications envoyées à l’app pendant qu’il travaille.", "Cursor tells the app about each of its actions through hooks: small notifications sent to the app while it works.")}</p>
      <ol className="steps">
        <li>{t("Ouvre ton fichier de hooks Cursor :", "Open your Cursor hooks file:")} <code>~/.cursor/hooks.json</code> (Windows : <code>%USERPROFILE%\.cursor\hooks.json</code>).</li>
        <li>{t("Ajoute le bloc ci-dessous, en le fusionnant avec l’existant si le fichier n’est pas vide.", "Add the block below, merging it with the existing content if the file is not empty.")}</li>
        <li>{t("Redémarre Cursor : ses sessions apparaissent ensuite dans l’app. L’app ne modifie jamais ce fichier elle-même.", "Restart Cursor: its sessions then show up in the app. The app never edits this file itself.")}</li>
      </ol>
      <textarea readOnly value={setup.settings_fragment} aria-label={t("Bloc de hooks à ajouter à Cursor", "Hooks block to add to Cursor")} />
      <p className="dialog-note">{t("Ce bloc contient le chemin du jeton de cette installation. Si l’app est fermée, les hooks abandonnent après 3 secondes sans gêner Cursor.", "This block points to this installation’s token. If the app is closed, the hooks give up after 3 seconds without disturbing Cursor.")}</p>
      <div className="dialog-actions"><button className="button" onClick={onClose}>{t("Fermer", "Close")}</button><button className="button primary" onClick={copy}>{copied ? t("Copié ✓", "Copied ✓") : t("Copier le bloc", "Copy the block")}</button></div>
    </Dialog>;
  }
  if (connector.kind === "claude") {
    const { setup } = connector;
    const copy = async () => {
      await navigator.clipboard.writeText(setup.settings_fragment);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    const copyStatusline = async () => {
      await navigator.clipboard.writeText(setup.statusline_fragment);
      setCopiedLine(true);
      window.setTimeout(() => setCopiedLine(false), 1800);
    };
    return <Dialog id="claude" title={t("Brancher Claude Code", "Set up Claude Code")} onClose={onClose}>
      <p>{t("Claude Code prévient l’app de chacune de ses actions grâce à des hooks : de petites notifications envoyées à l’app pendant qu’il travaille. Les tokens viennent en plus de son journal de session, lu automatiquement.", "Claude Code tells the app about each of its actions through hooks: small notifications sent to the app while it works. Tokens also come from its session log, read automatically.")}</p>
      <ol className="steps">
        <li>{t("Ouvre ton fichier de réglages Claude Code :", "Open your Claude Code settings file:")} <code>~/.claude/settings.json</code> (Windows : <code>%USERPROFILE%\.claude\settings.json</code>).</li>
        <li>{t("Ajoute le bloc hooks ci-dessous à l’objet existant, sans effacer le reste du fichier.", "Add the hooks block below to the existing object, without erasing the rest of the file.")}</li>
        <li>{t("Les sessions Claude Code apparaissent ensuite dans l’app. L’app ne modifie jamais ce fichier elle-même.", "Claude Code sessions then show up in the app. The app never edits this file itself.")}</li>
      </ol>
      <textarea readOnly value={setup.settings_fragment} aria-label={t("Bloc hooks à ajouter aux réglages Claude Code", "Hooks block to add to the Claude Code settings")} />
      <p className="dialog-note">{t("Ce bloc contient un jeton propre à cette installation : si tu réinstalles l’app, recopie-le. Si l’app est fermée, les hooks abandonnent après 2 secondes sans gêner Claude Code.", "This block holds a token specific to this installation: copy it again if you reinstall the app. If the app is closed, hooks give up after 2 seconds without disturbing Claude Code.")}</p>
      <div className="dialog-actions"><button className="button primary" onClick={copy}>{copied ? t("Copié ✓", "Copied ✓") : t("Copier le bloc", "Copy the block")}</button></div>
      <h3 className="dialog-sub">{t("Facultatif : les limites de ton abonnement", "Optional: your subscription limits")}</h3>
      <p>{t("Claude Code ne note ses limites d’usage (fenêtre de 5 h et de la semaine, abonnés Pro et Max) nulle part sur le disque : il ne les donne qu’à sa barre d’état. Ce bloc remplace ta barre d’état par une qui les transmet à l’app et affiche « modèle · contexte · 5h · 7d ». Seuls les pourcentages et les heures de remise à zéro sont gardés, en mémoire.", "Claude Code writes its usage limits (5-hour and weekly windows, Pro and Max subscribers) nowhere on disk: it only hands them to its status line. This block replaces your status line with one that passes them to the app and shows “model · context · 5h · 7d”. Only the percentages and reset times are kept, in memory.")}</p>
      <textarea readOnly value={setup.statusline_fragment} aria-label={t("Bloc de barre d’état à ajouter aux réglages Claude Code", "Status line block to add to the Claude Code settings")} />
      <p className="dialog-note">{t("Il utilise curl. Si tu as déjà ta propre barre d’état, ce bloc la remplace : garde la tienne si tu y tiens. App fermée : la barre reste vide, Claude Code n’est pas gêné.", "It uses curl. If you already have your own status line, this block replaces it: keep yours if you prefer. App closed: the line stays empty and Claude Code is not disturbed.")}</p>
      <div className="dialog-actions"><button className="button" onClick={onClose}>{t("Fermer", "Close")}</button><button className="button" onClick={copyStatusline}>{copiedLine ? t("Copié ✓", "Copied ✓") : t("Copier la barre d’état", "Copy the status line")}</button></div>
    </Dialog>;
  }
  if (connector.kind === "aider" || connector.kind === "process") {
    const aider = connector.kind === "aider";
    return <Dialog id={connector.kind} title={aider ? t("Aider : observé automatiquement", "Aider: observed automatically") : t("Agents vus à leur processus", "Agents seen by their process")} onClose={onClose}>
      <p>{aider
        ? t("L’app repère Aider quand il tourne, puis lit l’historique qu’il écrit à la racine du dépôt (.aider.chat.history.md) : messages, modèle, fichiers modifiés et tokens.", "The app spots Aider while it runs, then reads the history it writes at the repository root (.aider.chat.history.md): messages, model, edited files and tokens.")
        : t("Amp, Kiro CLI, Trae CLI, Qoder CLI, CodeBuddy, MiniMax Code, jcode, dsh et iFlow CLI n’écrivent rien que l’app sache lire. Elle voit seulement qu’ils tournent, depuis quand et dans quel dossier.", "Amp, Kiro CLI, Trae CLI, Qoder CLI, CodeBuddy, MiniMax Code, jcode, dsh and iFlow CLI write nothing the app can read. It only sees that they run, since when and in which folder.")}
        {" "}{t("Il n’y a rien à configurer.", "Nothing to set up.")}</p>
      <dl className="facts">
        <div><dt>Source</dt><dd>{t("La liste des programmes qui tournent, relue toutes les 4 secondes.", "The list of running programs, read every 4 seconds.")}</dd></div>
        <div><dt>Tokens</dt><dd>{aider ? t("Aider les écrit arrondis (« 2.3k ») : ils sont marqués estimés.", "Aider writes them rounded (“2.3k”): they are marked estimated.") : t("Non disponibles : ces agents ne les exposent pas.", "Not available: these agents do not expose them.")}</dd></div>
        <div><dt>{t("Historique", "History")}</dt><dd>{t("Seules les sessions qui ont lieu pendant que l’app est ouverte sont observées.", "Only sessions that happen while the app is open are observed.")}</dd></div>
      </dl>
      <div className="dialog-actions"><button className="button primary" onClick={onClose}>{t("Compris", "Got it")}</button></div>
    </Dialog>;
  }
  const copy = readOnlyCopy(connector.kind);
  const source = connectorSource(connector)!;
  return <Dialog id={connector.kind} title={t(`${copy.name} : observé automatiquement`, `${copy.name}: observed automatically`)} onClose={onClose}>
    <p>{copy.how} {t(`Il n’y a rien à configurer et aucun réglage de ${copy.name} n’est modifié.`, `Nothing to set up, and no ${copy.name} setting is changed.`)}</p>
    <dl className="facts">
      <div><dt>Source</dt><dd><code>{source.path}</code></dd></div>
      <div><dt>{t("État", "State")}</dt><dd>{source.found ? t("Trouvée sur cet ordinateur.", "Found on this computer.") : t(`Introuvable pour l’instant : lance ${copy.name} une première fois.`, `Not found yet: run ${copy.name} once.`)}</dd></div>
      <div><dt>Tokens</dt><dd>{copy.tokens}</dd></div>
      <div><dt>{t("Historique", "History")}</dt><dd>{t("Seules les sessions qui ont lieu pendant que l’app est ouverte sont observées.", "Only sessions that happen while the app is open are observed.")}</dd></div>
    </dl>
    <div className="dialog-actions"><button className="button primary" onClick={onClose}>{t("Compris", "Got it")}</button></div>
  </Dialog>;
}

function Dialog({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={`${id}-dialog-title`}>
      <header className="dialog-header"><h2 id={`${id}-dialog-title`}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")}><X size={16} /></button></header>
      <div className="dialog-body">
        {children}
        <p className="dialog-note">{t("Ce qui est enregistré (texte des prompts, commandes) se règle dans l’onglet Réglages.", "What is recorded (prompt text, commands) is set in the Settings tab.")}</p>
      </div>
    </section>
  </div>;
}
