import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { t } from "./i18n";

type State =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "current" }
  | { step: "found"; update: Update }
  | { step: "installing"; percent: number | null }
  | { step: "failed"; message: string };

/**
 * Mise à jour à la demande : l'app ne contacte GitHub que quand on clique. La section n'apparaît que
 * dans une version publiée avec une clé de signature (sinon il n'y a rien de vérifiable à installer).
 */
export function UpdatesSection() {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });

  useEffect(() => {
    invoke<boolean>("updates_available").then(setAvailable).catch(() => setAvailable(false));
    getVersion().then(setVersion).catch(() => undefined);
  }, []);

  if (!available) return null;

  async function lookUp() {
    setState({ step: "checking" });
    try {
      const update = await check();
      setState(update ? { step: "found", update } : { step: "current" });
    } catch (error) {
      setState({ step: "failed", message: String(error) });
    }
  }

  async function install(update: Update) {
    let total = 0;
    let received = 0;
    setState({ step: "installing", percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState({ step: "installing", percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null });
        }
      });
      await relaunch();
    } catch (error) {
      setState({ step: "failed", message: String(error) });
    }
  }

  return <section>
    <h3>{t("Mises à jour", "Updates")}</h3>
    <p className="hint">{t("Chaque mise à jour est signée : l’app vérifie la signature avant de l’installer. Elle ne contacte GitHub que quand tu cliques.", "Every update is signed: the app checks the signature before installing it. It only contacts GitHub when you click.")}</p>
    <div className="row">
      <span>{t("Version installée", "Installed version")}<small>{version || "—"}</small></span>
      {state.step === "found"
        ? <button className="button primary" onClick={() => void install(state.update)}>{t(`Installer la ${state.update.version} et redémarrer`, `Install ${state.update.version} and restart`)}</button>
        : <button className="button" disabled={state.step === "checking" || state.step === "installing"} onClick={() => void lookUp()}>{state.step === "checking" ? t("Vérification…", "Checking…") : t("Vérifier", "Check")}</button>}
    </div>
    {state.step === "current" && <p className="hint" role="status">{t("Tu as la dernière version.", "You have the latest version.")}</p>}
    {state.step === "found" && <p className="hint" role="status">{t(`Version ${state.update.version} disponible`, `Version ${state.update.version} available`)}{state.update.date ? ` · ${state.update.date.slice(0, 10)}` : ""}.</p>}
    {state.step === "installing" && <p className="hint" role="status">{state.percent === null ? t("Téléchargement…", "Downloading…") : t(`Téléchargement : ${state.percent} %`, `Downloading: ${state.percent} %`)}</p>}
    {state.step === "failed" && <p className="hint" role="alert">{t("La mise à jour a échoué : ", "The update failed: ")}{state.message}</p>}
  </section>;
}
