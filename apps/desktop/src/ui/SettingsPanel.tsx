import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { loadConnectorSetup, type ConnectorSetup } from "./ConnectorDialog";
import { DiagnosticSection } from "./DiagnosticSection";
import { currentLang, locale, setLang, t, type Lang } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { activeProviders } from "./providers";
import { readPreference } from "./preferences";

type CapturePolicy = { capture_prompts: boolean; capture_commands: boolean };

const retentionOptions = (): Array<[number, string]> => [
  [7, t("7 jours", "7 days")],
  [30, t("30 jours", "30 days")],
  [90, t("90 jours", "90 days")],
  [365, t("1 an", "1 year")],
  [0, t("Tout garder", "Keep everything")]
];

/**
 * Le seul panneau de l'app : brancher les agents, choisir ce qui est enregistré et combien de
 * temps, exporter ou effacer. Il se referme et on revient à l'écran unique.
 */
export type AlertSettings = { notifications: boolean; onNotifications: (value: boolean) => void; budget: number; onBudget: (value: number) => void };

export function SettingsPanel({ onClose, onConfigure, onExport, onClear, alerts }: {
  alerts: AlertSettings;
  onClose: () => void;
  onConfigure: (setup: ConnectorSetup) => void;
  onExport: () => Promise<string | null>;
  onClear: () => Promise<boolean>;
}) {
  const [policy, setPolicy] = useState<CapturePolicy | null>(null);
  const [retention, setRetention] = useState<number | null>(null);
  const [keepErrors, setKeepErrors] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Chaque commande de connecteur renvoie la politique de capture, qui est commune.
    invoke<CapturePolicy>("codex_setup")
      .then(({ capture_prompts, capture_commands }) => setPolicy({ capture_prompts, capture_commands }))
      .catch(() => setNotice(t("Aperçu : les réglages ne sont disponibles que dans l’application de bureau.", "Preview: settings are only available in the desktop app.")));
    invoke<number>("retention_policy").then(setRetention).catch(() => undefined);
    invoke<boolean>("capture_errors").then(setKeepErrors).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function savePolicy(next: CapturePolicy) {
    try {
      await invoke("update_capture_policy", { capturePrompts: next.capture_prompts, captureCommands: next.capture_commands });
      setPolicy(next);
      setNotice(t("Réglage enregistré.", "Setting saved."));
    } catch {
      setNotice(t("Impossible d’enregistrer ce réglage.", "Could not save this setting."));
    }
  }

  async function saveErrors(value: boolean) {
    try {
      await invoke("update_capture_errors", { enabled: value });
      setKeepErrors(value);
      setNotice(t("Réglage enregistré.", "Setting saved."));
    } catch {
      setNotice(t("Impossible d’enregistrer ce réglage.", "Could not save this setting."));
    }
  }

  async function saveRetention(days: number) {
    if (days > 0 && retention !== null && (retention === 0 || days < retention)
      && !window.confirm(t(`Supprimer dès maintenant les événements de plus de ${days} jours ? Cette action ne peut pas être annulée.`, `Delete events older than ${days} days now? This cannot be undone.`))) return;
    try {
      const removed = await invoke<number>("update_retention_policy", { days });
      setRetention(days);
      setNotice(removed
        ? t(`${removed.toLocaleString(locale())} événements anciens supprimés.`, `${removed.toLocaleString(locale())} old events deleted.`)
        : t("Réglage enregistré.", "Setting saved."));
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function configure(kind: Parameters<typeof loadConnectorSetup>[0]) {
    try {
      onConfigure(await loadConnectorSetup(kind));
    } catch {
      setNotice(t("Ce connecteur n’est disponible que dans l’application de bureau.", "This connector is only available in the desktop app."));
    }
  }

  const language = readPreference<Lang | null>("language", null, (value): value is Lang | null => value === null || value === "fr" || value === "en");

  return <div className="sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="sheet" role="dialog" aria-modal="true" aria-label={t("Réglages", "Settings")}>
      <header className="sheet-head">
        <b>{t("Réglages", "Settings")}</b>
        <button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")}><X size={15} /></button>
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}

      <section>
        <h3>{t("Agents", "Agents")}</h3>
        <p className="hint">{t("Un agent branché apparaît sur l’écran dès sa première action.", "A connected agent shows up on the screen from its first action.")}</p>
        <ul className="connector-list">
          {activeProviders.map((provider) => <li key={provider.eventKey}>
            <ProviderMark provider={provider} small />
            <span>{provider.name}</span>
            {provider.connector
              ? <button className="button" onClick={() => void configure(provider.connector!.kind)}>{t("Configurer", "Configure")}</button>
              : <small>{t("lu automatiquement", "read automatically")}</small>}
          </li>)}
        </ul>
      </section>

      <section>
        <h3>{t("Alertes", "Alerts")}</h3>
        <Toggle
          checked={alerts.notifications}
          disabled={false}
          onChange={alerts.onNotifications}
          title={t("Notifications système", "System notifications")}
          hint={t("Quand un agent tourne en rond, se bloque, se tait ou finit, ou que deux agents touchent au même fichier. Rien n’est envoyé tant que la fenêtre est au premier plan.", "When an agent goes in circles, gets blocked, goes quiet or finishes, or two agents touch the same file. Nothing is sent while the window is in front.")}
        />
        <label className="row">
          <span>{t("Budget du jour (coût estimé)", "Daily budget (estimated cost)")}<small>{t("0 pour désactiver. Alerte à 80 % puis au dépassement, au tarif API.", "0 to turn off. Alerts at 80 % then when exceeded, at API list price.")}</small></span>
          <input type="number" min={0} step={1} inputMode="decimal" className="budget-input" value={alerts.budget || ""} placeholder="0" onChange={(event) => alerts.onBudget(Math.max(0, Number(event.target.value) || 0))} aria-label={t("Budget du jour en dollars", "Daily budget in dollars")} />
        </label>
      </section>

      <section>
        <h3>{t("Ce qui est enregistré", "What is recorded")}</h3>
        <p className="hint">{t("Par défaut, l’app ne garde que le déroulé : quel agent, quel outil, quel fichier, quand, combien de tokens. Tout reste sur cet ordinateur.", "By default the app only keeps the outline: which agent, which tool, which file, when, how many tokens. Everything stays on this computer.")}</p>
        <Toggle
          checked={policy?.capture_prompts ?? false}
          disabled={!policy}
          onChange={(value) => policy && void savePolicy({ ...policy, capture_prompts: value })}
          title={t("Le texte de mes messages aux agents", "The text of my messages to agents")}
          hint={t("Tes messages peuvent contenir du code privé.", "Your messages may contain private code.")}
        />
        <Toggle
          checked={policy?.capture_commands ?? false}
          disabled={!policy}
          onChange={(value) => policy && void savePolicy({ ...policy, capture_commands: value })}
          title={t("Les commandes lancées par les agents", "The commands agents run")}
          hint={t("Une commande peut contenir un mot de passe.", "A command may contain a password.")}
        />
        <Toggle
          checked={keepErrors}
          disabled={!policy}
          onChange={(value) => void saveErrors(value)}
          title={t("Les messages d’erreur, courts et nettoyés", "Error messages, short and cleaned")}
          hint={t("Réduits à une ligne, sans clés ni mots de passe repérables.", "Cut to one line, with recognisable keys and passwords removed.")}
        />
      </section>

      <section>
        <h3>{t("Combien de temps", "How long")}</h3>
        <label className="row">
          <span>{t("Conservation des événements", "Event retention")}</span>
          <select value={retention ?? ""} disabled={retention === null} onChange={(event) => void saveRetention(Number(event.target.value))}>
            {retention === null && <option value="">—</option>}
            {retentionOptions().map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </section>

      <section>
        <h3>{t("Mes données", "My data")}</h3>
        <div className="row">
          <span>{t("Exporter l’historique", "Export history")}</span>
          <button className="button" onClick={async () => { const message = await onExport(); if (message) setNotice(message); }}>{t("Exporter…", "Export…")}</button>
        </div>
        <div className="row">
          <span>{t("Effacer l’historique", "Erase history")}</span>
          <button className="button danger" onClick={async () => { if (await onClear()) setNotice(t("Historique effacé.", "History erased.")); }}>{t("Effacer…", "Erase…")}</button>
        </div>
      </section>

      <section>
        <h3>{t("Langue", "Language")}</h3>
        <label className="row">
          <span>{t("Langue de l’app", "App language")}</span>
          <select value={language ?? "system"} onChange={(event) => setLang(event.target.value === "system" ? null : event.target.value as Lang)} data-lang={currentLang()}>
            <option value="system">{t("Langue du système", "System language")}</option>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>

      <DiagnosticSection />
    </aside>
  </div>;
}

function Toggle({ checked, disabled, onChange, title, hint }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; title: string; hint: string }) {
  return <label className="row toggle">
    <span>{title}<small>{hint}</small></span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}
