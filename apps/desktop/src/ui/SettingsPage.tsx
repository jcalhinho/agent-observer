import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SectionHeader } from "./Explain";
import { currentLang, locale, setLang, t, type Lang } from "./i18n";
import { noticeKinds, type NoticeKind } from "./notificationRules";
import { useSubscription } from "./costPreferences";
import { isRaceQuality } from "./SprintTrack";
import type { RaceQuality } from "./SprintTrack3D";
import { DEFAULT_STORY_TIME, isClock, latestSlot } from "./story";
import { pickAgent, storySettings, useStoryAgents } from "./useStory";
import { isBoolean, isString, readPreference, usePreference, writePreference } from "./preferences";
import { activeProviders } from "./providers";

type CapturePolicy = { capture_prompts: boolean; capture_commands: boolean };

const retentionOptions = (): Array<[number, string]> => [[7, t("7 jours", "7 days")], [30, t("30 jours", "30 days")], [90, t("90 jours", "90 days")], [365, t("1 an", "1 year")], [0, t("Tout garder", "Keep everything")]];

/** What is recorded, for how long, and the history export / erase actions. */
export function SettingsPage({ onExport, onClear, onMini }: { onExport: () => Promise<string | null>; onClear: () => Promise<boolean>; onMini: () => void }) {
  const [policy, setPolicy] = useState<CapturePolicy | null>(null);
  const [retention, setRetention] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    // Every setup command reports the shared capture policy.
    invoke<CapturePolicy>("codex_setup").then(({ capture_prompts, capture_commands }) => setPolicy({ capture_prompts, capture_commands })).catch(() => { setPreview(true); setNotice(t("Aperçu : les réglages ne sont disponibles que dans l’application de bureau.", "Preview: settings are only available in the desktop app.")); });
    invoke<number>("retention_policy").then(setRetention).catch(() => undefined);
  }, []);

  async function savePolicy(next: CapturePolicy) {
    try {
      await invoke("update_capture_policy", { capturePrompts: next.capture_prompts, captureCommands: next.capture_commands });
      setPolicy(next);
      setNotice(t("Réglage enregistré.", "Setting saved."));
    } catch {
      setNotice(t("Impossible d’enregistrer ce réglage.", "Could not save this setting."));
    }
  }

  async function saveRetention(days: number) {
    if (days > 0 && retention !== null && (retention === 0 || days < retention) && !window.confirm(t(`Supprimer dès maintenant les événements de plus de ${days} jours ? Cette action ne peut pas être annulée.`, `Delete events older than ${days} days now? This cannot be undone.`))) return;
    try {
      const removed = await invoke<number>("update_retention_policy", { days });
      setRetention(days);
      setNotice(removed ? t(`${removed.toLocaleString(locale())} événements anciens supprimés.`, `${removed.toLocaleString(locale())} old events deleted.`) : t("Réglage enregistré.", "Setting saved."));
    } catch (error) {
      setNotice(String(error));
    }
  }

  return <section className="page settings-page">
    <SectionHeader title={t("Réglages", "Settings")} description={t("Ce que l’app enregistre, combien de temps elle le garde, et ce que tu peux en faire. Tout reste sur cet ordinateur.", "What the app records, how long it keeps it, and what you can do with it. Everything stays on this computer.")} />
    {notice && <p className={`notice ${preview ? "warn" : ""}`} role="status">{notice}</p>}

    <div className="settings-group">
      <h3>{t("Ce qui est enregistré", "What is recorded")}</h3>
      <p>{t("Par défaut, l’app ne garde que le déroulé : quel agent, quel outil, quel fichier, quand, combien de tokens. Les réponses des agents, leurs raisonnements et les résultats des outils ne sont jamais enregistrés.", "By default the app only keeps the outline: which agent, which tool, which file, when, how many tokens. Agents’ answers, their reasoning and tool outputs are never recorded.")}</p>
      <Toggle checked={policy?.capture_prompts ?? false} disabled={!policy} onChange={(value) => policy && savePolicy({ ...policy, capture_prompts: value })} title={t("Enregistrer le texte de mes messages aux agents", "Record the text of my messages to agents")} hint={t("Utile pour relire une session, mais tes messages peuvent contenir du code privé ou des informations confidentielles.", "Useful to review a session, but your messages may contain private code or confidential information.")} />
      <Toggle checked={policy?.capture_commands ?? false} disabled={!policy} onChange={(value) => policy && savePolicy({ ...policy, capture_commands: value })} title={t("Enregistrer les commandes lancées par les agents", "Record the commands agents run")} hint={t("Par exemple « npm test ». Une commande peut contenir un mot de passe ou un jeton : à activer en connaissance de cause.", "For example “npm test”. A command may contain a password or a token: enable knowingly.")} />
    </div>

    <StorySettings />

    <NotificationSettings />

    <div className="settings-group">
      <h3>{t("Coût", "Cost")}</h3>
      <p>{t("Le montant affiché est toujours calculé au tarif de l’API. Si tu utilises un agent via un abonnement, indique-le : le montant devient « valeur consommée » au lieu d’un coût.", "The amount shown is always computed at API prices. If you use an agent through a subscription, say so: the amount becomes “value consumed” instead of a cost.")}</p>
      {activeProviders.map((provider) => <SubscriptionToggle key={provider.eventKey} eventKey={provider.eventKey} name={provider.name} />)}
    </div>

    <div className="settings-group">
      <h3>{t("Combien de temps", "How long")}</h3>
      <label className="setting-row">
        <span><b>{t("Conservation des événements", "Event retention")}</b><small>{t("Les événements plus anciens sont supprimés automatiquement, au démarrage puis toutes les heures.", "Older events are deleted automatically, at startup and then every hour.")}</small></span>
        <select value={retention ?? ""} disabled={retention === null} onChange={(event) => void saveRetention(Number(event.target.value))}>
          {retention === null && <option value="">—</option>}
          {retentionOptions().map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>

    <div className="settings-group">
      <h3>{t("Mes données", "My data")}</h3>
      <div className="setting-row">
        <span><b>{t("Exporter l’historique", "Export history")}</b><small>{t("Un fichier JSON avec tous les événements enregistrés, pour les archiver ou les analyser ailleurs.", "A JSON file with every recorded event, to archive or analyse elsewhere.")}</small></span>
        <button className="button" onClick={async () => { const message = await onExport(); if (message) setNotice(message); }}>{t("Exporter…", "Export…")}</button>
      </div>
      <div className="setting-row">
        <span><b>{t("Effacer l’historique", "Erase history")}</b><small>{t("Supprime définitivement tous les événements enregistrés sur cet ordinateur.", "Permanently deletes every event recorded on this computer.")}</small></span>
        <button className="button danger" onClick={async () => { if (await onClear()) setNotice(t("Historique effacé.", "History erased.")); }}>{t("Effacer…", "Erase…")}</button>
      </div>
    </div>

    <div className="settings-group">
      <h3>{t("Affichage", "Display")}</h3>
      <LanguageSetting />
      <RaceQualitySetting />
      <LaunchHostSetting />
      <div className="setting-row">
        <span><b>{t("Mode mini", "Mini mode")}</b><small>{t("Réduit l’app à une colonne dans un coin de l’écran, toujours visible, avec une carte par agent.", "Shrinks the app to an always-visible column in a corner of the screen, one card per agent.")}</small></span>
        <button className="button" onClick={onMini}>{t("Passer en mode mini", "Switch to mini mode")}</button>
      </div>
    </div>
  </section>;
}

/** The daily story: when, with which agent, and what it needs before it can run. */
function StorySettings() {
  const { agents } = useStoryAgents();
  const [auto, setAuto] = usePreference("story.auto", false, isBoolean);
  const [time, setTime] = usePreference("story.time", DEFAULT_STORY_TIME, isClock);
  const [agent, setAgent] = usePreference("story.agent", "auto", isString);
  const [message, setMessage] = useState("");
  const chosen = agents ? pickAgent(agents, agent) : null;
  const allowed = Boolean(chosen && storySettings.consented().includes(chosen.provider));

  function toggle(value: boolean) {
    setMessage("");
    if (value && !allowed) { setMessage(t("Écris d’abord une première histoire à la main (panneau Histoire, à droite) : l’app te demandera ton accord pour cet agent.", "Write a first story by hand (Story panel, on the right) first: the app will ask your permission for that agent.")); return; }
    // Starting today: the story is for the next 18:00, not for yesterday's.
    if (value) writePreference("story.last-slot", latestSlot(Date.now(), time));
    setAuto(value);
  }

  return <div className="settings-group">
    <h3>{t("Histoire du jour", "Daily story")}</h3>
    <p>{t("Un agent que tu as déjà écrit l’histoire de tes dernières 24 h, une fois par jour. Il est lancé sans outil, dans un dossier vide, avec un résumé de chiffres et de noms (jamais le texte de tes messages) ; cela consomme ton forfait. Désactivé par défaut.", "An agent you already have writes the story of your last 24 hours, once a day. It runs with no tools, in an empty folder, on a summary of numbers and names (never the text of your messages); it uses your plan. Off by default.")}</p>
    {message && <p className="notice warn" role="status">{message}</p>}
    <Toggle checked={auto} disabled={!agents?.length} onChange={toggle} title={t("Écrire l’histoire chaque jour", "Write the story every day")} hint={agents?.length ? t("Si l’app était fermée à l’heure choisie, l’histoire est écrite au lancement suivant.", "If the app was closed at that time, the story is written at the next launch.") : t("Aucun agent compatible trouvé sur cet ordinateur.", "No supported agent found on this computer.")} />
    <label className="setting-row"><span><b>{t("Heure", "Time")}</b><small>{t("Heure locale. Sans l’option ci-dessus, l’app te prévient seulement que le rapport est prêt.", "Local time. Without the option above, the app only tells you the report is ready.")}</small></span>
      <input type="time" value={time} onChange={(event) => { if (isClock(event.target.value)) { setTime(event.target.value); writePreference("story.last-slot", latestSlot(Date.now(), event.target.value)); } }} />
    </label>
    {agents && agents.length > 1 && <label className="setting-row"><span><b>{t("Agent qui écrit", "Writing agent")}</b><small>{t("« Automatique » prend Claude Code, puis Codex, Gemini CLI, Qwen Code, OpenCode.", "“Automatic” takes Claude Code, then Codex, Gemini CLI, Qwen Code, OpenCode.")}</small></span>
      <select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="auto">{t("Automatique", "Automatic")}</option>{agents.map((candidate) => <option key={candidate.provider} value={candidate.provider}>{candidate.name}</option>)}</select>
    </label>}
  </div>;
}

/** How much the 3D race may ask of the computer. */
function RaceQualitySetting() {
  const [quality, setQuality] = usePreference<RaceQuality>("race-quality", "auto", isRaceQuality);
  return <label className="setting-row">
    <span><b>{t("Qualité de la course 3D", "3D race quality")}</b><small>{t("« Léger » dessine à basse résolution, 20 images par seconde : pour un ordinateur lent ou une batterie à ménager. « Fluide » dessine plus net et à 60 images par seconde.", "“Light” draws at a low resolution, 20 frames per second: for a slow computer or to save battery. “Smooth” draws sharper at 60 frames per second.")}</small></span>
    <select value={quality} onChange={(event) => setQuality(event.target.value as RaceQuality)}>
      <option value="light">{t("Léger", "Light")}</option>
      <option value="auto">{t("Automatique", "Automatic")}</option>
      <option value="smooth">{t("Fluide", "Smooth")}</option>
    </select>
  </label>;
}

function LaunchHostSetting() {
  const [host, setHost] = usePreference<string>("launch-host", "terminal", (value): value is string => typeof value === "string");
  return <label className="setting-row">
    <span><b>{t("Relancer un agent arrêté dans…", "Start a stopped agent again in…")}</b><small>{t("Quand tu cliques sur « Aller à l’agent » et que l’agent n’est plus lancé, il est relancé dans son dossier avec la commande qui reprend sa session, dans le terminal où il était, sinon ici. Pour un éditeur, le dossier est ouvert et la commande copiée.", "When you click “Go to agent” and the agent is no longer running, it is started again in its folder with the command that resumes its session — in the terminal it was in, otherwise here. For an editor, the folder is opened and the command copied.")}</small></span>
    <select value={host} onChange={(event) => setHost(event.target.value)}>
      <option value="terminal">Terminal</option>
      <option value="iterm">iTerm2</option>
      <option value="code">VS Code</option>
      <option value="cursor">Cursor</option>
      <option value="windsurf">Windsurf</option>
    </select>
  </label>;
}

function LanguageSetting() {
  const chosen = readPreference<Lang | null>("language", null, (value): value is Lang | null => value === null || value === "fr" || value === "en");
  const value = chosen ?? "system";
  return <label className="setting-row">
    <span><b>{t("Langue", "Language")}</b><small>{t("Par défaut, celle de ton système.", "Defaults to your system’s language.")}</small></span>
    <select value={value} onChange={(event) => setLang(event.target.value === "system" ? null : event.target.value as Lang)} data-lang={currentLang()}>
      <option value="system">{t("Langue du système", "System language")}</option>
      <option value="fr">Français</option>
      <option value="en">English</option>
    </select>
  </label>;
}

function SubscriptionToggle({ eventKey, name }: { eventKey: string; name: string }) {
  const [checked, setChecked] = useSubscription(eventKey);
  return <Toggle checked={checked} disabled={false} onChange={setChecked} title={t(`${name} : je suis au forfait`, `${name}: I am on a subscription`)} hint={t("Le montant est affiché comme « valeur consommée ».", "The amount is shown as “value consumed”.")} />;
}

function Toggle({ checked, disabled, onChange, title, hint }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; title: string; hint: string }) {
  return <label className="setting-row toggle">
    <span><b>{title}</b><small>{hint}</small></span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

function NotificationSettings() {
  const [enabled, setEnabled] = usePreference("notify.enabled", true, isBoolean);
  const [dailyReport, setDailyReport] = usePreference("daily-report.enabled", true, isBoolean);
  return <div className="settings-group">
    <h3>Notifications</h3>
    <p>{t("L’app te prévient quand un agent a besoin de toi, même si elle est en arrière-plan. Un clic sur la notification t’amène directement à l’agent. Les alertes (boucle, erreurs) ont un son distinct et s’affichent aussi en rouge en haut de l’app.", "The app tells you when an agent needs you, even in the background. Clicking the notification takes you straight to the agent. Alerts (loops, errors) have a distinct sound and also show in red at the top of the app.")}</p>
    <Toggle checked={enabled} disabled={false} onChange={setEnabled} title={t("Activer les notifications", "Enable notifications")} hint={t("Coupe toutes les notifications d’un coup (le badge et les bandeaux restent).", "Turns every notification off at once (the badge and banners stay).")} />
    <Toggle checked={dailyReport} disabled={false} onChange={setDailyReport} title={t("Rapport quotidien", "Daily report")} hint={t("Une notification locale après 24 h d’activité ; le détail reste dans l’onglet Rapport 24 h.", "A local notification after 24 hours of activity; details stay in the 24 h report tab.")} />
    {noticeKinds().map((entry) => <KindToggle key={entry.kind} kind={entry.kind} label={entry.alert ? `⚠ ${entry.label}` : entry.label} hint={entry.hint} disabled={!enabled} />)}
  </div>;
}

function KindToggle({ kind, label, hint, disabled }: { kind: NoticeKind; label: string; hint: string; disabled: boolean }) {
  const [checked, setChecked] = usePreference(`notify.${kind}`, kind !== "stalled", isBoolean);
  return <Toggle checked={checked} disabled={disabled} onChange={setChecked} title={label} hint={hint} />;
}
