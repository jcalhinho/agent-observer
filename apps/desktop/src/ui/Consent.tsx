import { t } from "./i18n";
import type { StoryAgent } from "./useStory";

const originLabel = (origin: StoryAgent["origin"]) => origin === "editor" ? t("extension d’éditeur", "editor extension") : origin === "desktop" ? t("application", "desktop app") : t("ligne de commande", "command line");

/** Says what will be sent and to whom, once per agent, before anything leaves the computer. */
export function Consent({ agent, preview, purpose = "story", onAllow, onCancel }: { agent: StoryAgent; preview: string; purpose?: "story" | "ask"; onAllow: () => void; onCancel: () => void }) {
  const what = purpose === "ask" ? t("le résumé des faits de la période choisie et ta question", "a summary of the facts of the chosen period and your question") : t("le résumé ci-dessous", "the summary below");
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <header className="dialog-header"><h2 id="consent-title">{purpose === "ask" ? t(`Poser tes questions à ${agent.name} ?`, `Ask your questions to ${agent.name}?`) : t(`Écrire l’histoire avec ${agent.name} ?`, `Write the story with ${agent.name}?`)}</h2></header>
      <div className="dialog-body">
        <p>{t(`L’app lance ${agent.name} (${originLabel(agent.origin)}${agent.version ? `, ${agent.version}` : ""}) sans aucun outil et dans un dossier vide, avec ${what}. Cela est envoyé à son fournisseur, comme tout ce que tu lui écris, et consomme ton forfait ou tes crédits. Aucune clé n’est demandée.`, `The app runs ${agent.name} (${originLabel(agent.origin)}${agent.version ? `, ${agent.version}` : ""}) with no tools and in an empty folder, on ${what}. It goes to its provider like anything you type to it and uses your plan or credits. No key is asked for.`)}</p>
        <p>{t("Les faits ne contiennent ni le texte de tes messages, ni tes commandes, ni les dossiers de ton disque : seulement des chiffres et des noms de projets, de modèles, d’outils et de fichiers (et les messages d’erreur courts et nettoyés si tu as activé cette option).", "The facts hold neither the text of your messages, nor your commands, nor your disk folders: only numbers and the names of projects, models, tools and files (and short, cleaned error messages if you turned that option on).")}</p>
        <details className="consent-facts"><summary>{t("Voir exactement ce qui est envoyé", "See exactly what is sent")}</summary><pre>{preview}</pre></details>
        <div className="dialog-actions"><button className="button" onClick={onCancel}>{t("Annuler", "Cancel")}</button><button className="button primary" onClick={onAllow}>{t("Autoriser", "Allow")}</button></div>
      </div>
    </section>
  </div>;
}
