import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectorSource, loadConnectorSetup } from "./ConnectorDialog";
import { demoDiagnostic, isDemo } from "./demo";
import { agentSummary, diagnosticText, hideHome, bytes, type AgentLine, type Diagnostic } from "./diagnosticView";
import { describeCollector } from "./CollectorStatus";
import { compact } from "./insights";
import { t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { activeProviders } from "./providers";

/** Garde un nombre et son unité sur la même ligne (« 4 s », « 72 Ko »). */
const keepTogether = (text: string) => text.replace(/(\d) (?=\S)/g, "$1\u00a0");

type Loaded = { diagnostic: Diagnostic; agents: AgentLine[] };

async function load(): Promise<Loaded> {
  if (isDemo()) {
    const { diagnostic, sources } = demoDiagnostic(Date.now());
    return { diagnostic, agents: activeProviders.map((provider) => ({
      key: provider.eventKey,
      name: provider.name,
      source: provider.connector && provider.connector.kind !== "claude" && provider.connector.kind !== "cursor" ? sources[provider.connector.kind] ?? null : null,
      stats: diagnostic.providers.find((entry) => entry.provider === provider.eventKey) ?? null
    })) };
  }
  const diagnostic = await invoke<Diagnostic>("diagnostic");
  const agents = await Promise.all(activeProviders.map(async (provider) => {
    // Un connecteur dont la commande échoue est affiché sans source plutôt que de masquer les autres.
    const source = provider.connector ? await loadConnectorSetup(provider.connector.kind).then(connectorSource).catch(() => null) : null;
    return { key: provider.eventKey, name: provider.name, source, stats: diagnostic.providers.find((entry) => entry.provider === provider.eventKey) ?? null };
  }));
  return { diagnostic, agents };
}

/** Pourquoi un agent n'apparait pas : d'où chaque connecteur lit, ce qu'il a apporté, et un texte à coller dans un ticket. */
export function DiagnosticSection() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<"ok" | "ko" | null>(null);

  const refresh = useCallback(() => {
    load().then((next) => { setLoaded(next); setFailed(false); setNow(Date.now()); }).catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function copy() {
    if (!loaded) return;
    try {
      await navigator.clipboard.writeText(diagnosticText(loaded.diagnostic, loaded.agents, Date.now()));
      setCopied("ok");
    } catch {
      setCopied("ko");
    }
    window.setTimeout(() => setCopied(null), 1800);
  }

  return <section>
    <h3>{t("Diagnostic", "Diagnostic")}</h3>
    <p className="hint">{t("Si un agent n’apparaît pas : ce que chaque connecteur a reçu depuis le lancement de l’app, et où il lit. Le texte copié masque ton dossier personnel et ne contient ni message ni commande.", "If an agent does not show up: what each connector received since the app started, and where it reads. The copied text hides your home folder and contains no message or command.")}</p>
    {failed && !loaded && <p className="hint">{t("Le diagnostic n’est disponible que dans l’application de bureau.", "The diagnostic is only available in the desktop app.")}</p>}
    {loaded && <>
      <ul className="connector-list diagnostic-list">
        {activeProviders.map((provider) => {
          const line = loaded.agents.find((entry) => entry.key === provider.eventKey);
          if (!line) return null;
          const { where, activity } = agentSummary(line, loaded.diagnostic.home, now);
          const missing = line.source !== null && !line.source.found;
          return <li key={provider.eventKey}>
            <ProviderMark provider={provider} small />
            <span>{provider.name}<small className={missing ? "diagnostic-missing" : undefined}>{where}</small></span>
            <small>{keepTogether(activity)}</small>
          </li>;
        })}
      </ul>
      <div className="row"><span>{t("Collecteur", "Collector")}<small>127.0.0.1:43821</small></span><small title={loaded.diagnostic.collector}>{describeCollector(loaded.diagnostic.collector).label}</small></div>
      <div className="row">
        <span>{t("Base locale", "Local database")}<small>{hideHome(loaded.diagnostic.database.path, loaded.diagnostic.home)}</small></span>
        <small className="diagnostic-figure">{keepTogether(t(`${compact(loaded.diagnostic.database.events)} événement(s) · ${bytes(loaded.diagnostic.database.size_bytes)}`, `${compact(loaded.diagnostic.database.events)} event(s) · ${bytes(loaded.diagnostic.database.size_bytes)}`))}</small>
      </div>
      <div className="row">
        <span>{t("Requêtes refusées", "Refused requests")}<small>{t("Clé absente ou fausse, contenu illisible.", "Missing or wrong key, unreadable content.")}</small></span>
        <small>{loaded.diagnostic.rejected_requests}</small>
      </div>
      <div className="row">
        <span>{`Agent Observer ${loaded.diagnostic.version}`}<small>{`${loaded.diagnostic.os} ${loaded.diagnostic.arch}`}</small></span>
        <button className="button" onClick={() => void copy()}>{copied === "ok" ? t("Copié ✓", "Copied ✓") : copied === "ko" ? t("Copie impossible", "Could not copy") : t("Copier le diagnostic", "Copy diagnostic")}</button>
      </div>
    </>}
  </section>;
}
