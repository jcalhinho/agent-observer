<div align="center">

# Agent Observer

**Vois ce que font tes agents de code — et lequel a besoin de toi — sur un seul écran simple, sans rien envoyer nulle part.**

Une application de bureau locale pour macOS et Windows qui regarde travailler, en direct, Claude Code,
Codex, GitHub Copilot, Antigravity, OpenCode, Qwen Code et Reasonix sur ta machine.

[![CI](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml)
[![Dernière version](https://img.shields.io/github/v/release/jcalhinho/agent-observer?include_prereleases&sort=semver)](https://github.com/jcalhinho/agent-observer/releases)
[![Licence : MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

[Télécharger](#installation) · [Ce que tu vois](#ce-que-tu-vois) · [Confidentialité](#confidentialité) · [Compiler](#compiler-depuis-les-sources) · [Contribuer](CONTRIBUTING.md) · [English](README.md)

<img src="docs/media/screen.png" alt="Agent Observer : un seul écran avec une carte par agent, la plus urgente en premier" width="900">

</div>

---

## Pourquoi

Faire tourner deux ou trois agents de code en parallèle est devenu normal. Savoir lequel a
fini, lequel attend ton accord et lequel échoue sur la même commande depuis cinq minutes,
beaucoup moins. Agent Observer répond à une seule question d'un coup d'œil :
**qui a besoin de moi maintenant ?**

Il ne fait qu'**observer**. Il ne pilote jamais un agent, ne modifie jamais ton code ni les
réglages d'un agent à ta place, et n'envoie aucune télémétrie. Il ne fait aucune requête réseau de lui-même.

> **État :** début de vie (0.x). L'interface existe en **français et en anglais** (elle suit
> la langue du système ; change-la dans les Réglages).

## Ce que tu vois

Un écran : un **bandeau de totaux** en haut, puis **une barre par agent, en colonne**, les plus urgentes devant. Un
filtre (**Tous / Actifs / T'attendent**) réduit le plateau. Un clic sur une carte ouvre son détail.

**Le bandeau de totaux** additionne la dernière session de chaque agent : tokens, taux de cache, coût
estimé, ce que le cache a fait économiser, et appels d'outils (avec échecs et fichiers modifiés).

<img src="docs/media/card.png" alt="Une carte d'agent : état, activité, chiffres, tokens et cache, coût, contexte, outils" width="420">

**Chaque carte** montre :

| Bloc | Ce qu'il montre |
| --- | --- |
| **État** | Un mot, coloré selon l'urgence, avec l'âge de la dernière activité. |
| **Activité** | L'outil en cours et son fichier ou sa commande. Une boucle détectée ou des échecs en série la remplacent, en couleur. |
| **Où, comment, quel modèle** | Le dossier du projet (`~` pour ton dossier personnel, « déduit » quand il vient d'un chemin de fichier), la façon dont l'agent a été lancé (terminal, VS Code…), le dernier modèle rapporté (`+N` et une pastille en pointillés s'il en a utilisé plusieurs) et la durée du tour en cours. |
| **Chiffres de la session** | Tours, appels d'outils (avec échecs), fichiers distincts modifiés, durée. |
| **Tokens et cache** | Total des tokens, **taux de cache**, et une barre qui les répartit en cache lu, cache écrit, entrée nouvelle et sortie. |
| **Coût** | Une estimation au tarif API public des modèles, et **ce que le cache a fait économiser** par rapport aux mêmes requêtes sans aucun cache. |
| **Contexte** | Le remplissage de la fenêtre de contexte, le nombre de compactions, et la croissance de sa taille au fil de la session. |
| **Bande d'activité** | Les événements par minute sur les 15 dernières minutes. |
| **Outils** | Les outils les plus utilisés, avec leurs échecs. |
| **Objectif** | La dernière demande faite à l'agent (seulement si la capture des prompts est activée). |
| **Collisions** | Un avertissement quand un autre agent modifie le même fichier ou travaille dans le même dossier. |
| **Git** | Branche, commits en avance/retard, fichiers modifiés — appels `git` en lecture seule, délai de 4 s. |
| **Rythme** | Tokens par minute, $/h estimés, coût du tour en cours ; alerte quand le taux de cache s'effondre. |

**Le panneau de détail** (clic sur une carte) ajoute la répartition complète des tokens, la table de prix
derrière l'estimation, la courbe du contexte, les modèles vus, un tableau des outils, les fichiers touchés
(lus ou modifiés) et une chronologie des dernières actions. Chaque chiffre dit d'où il vient : rapporté par
l'agent, calculé ou estimé.

<img src="docs/media/detail.png" alt="Le panneau de détail d'un agent" width="900">

Un chiffre que l'agent ne rapporte pas s'affiche *non rapporté* ou « — », jamais inventé. Le coût est une
estimation aux prix API : un abonnement (Claude, Copilot…) ne facture pas ainsi, et un modèle absent de la
table de prix est laissé de côté, d'où le « ≥ » quand une partie de la session n'a pas pu être chiffrée. Le
taux de cache n'existe que pour les agents qui rapportent leurs lectures de cache (par exemple Claude Code
et Reasonix).

| État | Sens |
| --- | --- |
| **Tourne en rond** | Il répète les mêmes actions sans avancer (même commande, même fichier, même séquence) : il brûle des tokens pour rien. |
| **Bloqué** | Au moins deux outils ont échoué à la suite. |
| **Silencieux** | Un tour est ouvert mais rien ne s'est passé depuis plus de 2 minutes — souvent il attend ton accord. |
| **T'attend** | Son dernier tour est fini ; il est prêt pour ton prochain message. |
| **Au travail** | Des événements sont arrivés dans les 45 dernières secondes. |
| **Au repos** | Aucune activité récente. |
| **Pas encore vu** | Rien reçu — vérifie son connecteur. Listé dans un petit pied de page. |

La barre de contexte passe à l'orange dès 80 % et au rouge dès 95 %. La fenêtre vient de l'agent
quand il la rapporte, sinon d'une petite table de modèles documentés ; pour un modèle inconnu, la carte
affiche le nombre de tokens et aucun pourcentage plutôt qu'une supposition.

**L'essayer sans aucun agent :** lance `npm run dev` dans `apps/desktop` et ouvre
`http://127.0.0.1:1420/?demo`. L'écran se remplit d'événements fictifs (rien n'est lu ni écrit).

### Réglages

Le bouton de la barre du haut ouvre un panneau qui glisse ; referme-le et tu reviens à l'écran unique.

- **Connecteurs** : quels agents sont détectés, et comment les brancher (pour Claude Code, le
  fragment de réglages à copier).
- **Ce qui est enregistré** : les prompts, les commandes shell et les messages d'erreur sont désactivés par défaut.
- **Rétention** : de 7 jours à pour toujours.
- **Exporter / effacer** ton historique local.
- **Langue** : français ou anglais.

## Agents pris en charge

| Agent | Comment il est observé | Ce que tu dois faire |
| --- | --- | --- |
| **Claude Code** | [Hooks HTTP](https://docs.claude.com/en/docs/claude-code/hooks) officiels envoyés au collecteur local, plus la consommation de tokens lue dans les nouvelles lignes de ses transcriptions (`~/.claude/projects/**.jsonl`, `CLAUDE_CONFIG_DIR` respecté). | Copie le fragment affiché dans **Réglages › Connecteurs** dans `~/.claude/settings.json`. L'app ne le modifie jamais pour toi. |
| **Codex** | Enregistrements JSONL ajoutés dans `~/.codex/sessions` (`CODEX_HOME` respecté). | Rien. |
| **GitHub Copilot** | Deux sources, en lecture seule : les journaux d'événements de son agent dans `~/.copilot/session-state/<session>/events.jsonl` (Copilot CLI et sessions agent de VS Code ; `COPILOT_HOME` respecté), et le panneau Copilot Chat de VS Code (sa base locale `session-store.db` : les tours et les fichiers touchés, jamais le texte de l'assistant). | Rien. |
| **Antigravity** | Ses fichiers locaux dans `~/.gemini/antigravity`, ouverts en **lecture seule** : la liste des conversations et, pour les sessions récentes, une transcription pas à pas (tokens, outils, échecs). Antigravity n'enregistre qu'un code pour le modèle choisi ; l'app demande donc son nom au serveur local d'Antigravity (`127.0.0.1`, lecture seule, voir [Confidentialité](#confidentialité)). | Rien. |
| **OpenCode** | Sa base SQLite locale (`~/.local/share/opencode/opencode*.db`, `OPENCODE_DB` / `OPENCODE_DATA_DIR` respectés), ouverte en **lecture seule**. | Rien. |
| **Qwen Code** | Enregistrements de discussion JSONL ajoutés dans `~/.qwen/projects/<projet>/chats`. | Rien. |
| **Reasonix** | Ses fichiers de session dans `~/.reasonix/projects/<projet>/sessions/*.wire.jsonl` (écrits par Reasonix Studio), en lecture seule. | Rien. |
| **Cursor** | Hooks Cursor envoyés au collecteur local. | Copie le fragment affiché dans **Réglages › Connecteurs**. |

Sous Windows, `~` désigne `%USERPROFILE%`. Les connecteurs qui lisent des journaux commencent à la fin
des fichiers existants et n'observent que les nouveaux enregistrements : l'historique d'avant le
lancement de l'app n'est pas importé. La première lecture du panneau Copilot Chat fait pareil : une
carte Copilot Chat apparaît donc avec ta prochaine conversation.

Pas encore branchés : Continue, Cline, Roo Code, Aider et Gemini CLI. Les sessions lancées dans un
agent cloud ou une application de bureau qui ne laisse rien sur ton ordinateur ne peuvent pas être
observées. Pour ajouter un agent, voir [ajouter un connecteur](#ajouter-ton-propre-agent).

## Confidentialité

Tout reste sur ton ordinateur. L'app ne fait aucune requête réseau de son propre chef : elle ne fait
que recevoir des hooks sur `127.0.0.1`.

**Une requête locale vers Antigravity.** Ses fichiers ne contiennent qu'un code interne pour le modèle choisi ; pour afficher son nom, l'app interroge le serveur de langage d'Antigravity sur `127.0.0.1` (lecture seule), avec le jeton avec lequel cette application a été lancée, lu dans la liste des processus et gardé en mémoire le temps de cette requête. Seuls les noms de modèles sont conservés. Rien ne se passe si Antigravity ne tourne pas.

**Enregistré par défaut** — la *forme* du travail : quel agent, quelle session, quel outil,
quel chemin de fichier, quand, combien de temps, succès ou échec, nom du modèle et nombre de
tokens rapportés par l'agent lui-même.

**Sur option** (Réglages, désactivé par défaut) — le texte de tes prompts, les commandes shell
que lancent les agents, et une version courte et nettoyée des messages d'erreur (clés, jetons, mots de
passe et ton dossier personnel retirés). Ils peuvent contenir des secrets ; active-les en connaissance de cause.

**Jamais enregistré** — les réponses des agents, leur raisonnement, les sorties et résultats d'outils,
le contenu des fichiers, les chemins des transcriptions.

- Les événements sont stockés dans une base SQLite locale, dans le dossier de données de l'OS
  (`~/Library/Application Support/dev.repowatcher.agentobserver/` sous macOS,
  `%LOCALAPPDATA%\dev.repowatcher.agentobserver\` sous Windows).
- La rétention est réglable (7 jours à pour toujours) ; les événements plus anciens sont purgés au
  démarrage puis toutes les heures. L'historique peut être exporté en JSON ou effacé depuis les Réglages.
- Le collecteur de hooks n'écoute que sur `127.0.0.1:43821` et refuse les requêtes sans le jeton
  propre à l'installation, généré au premier lancement.

Voir [SECURITY.md](SECURITY.md) pour le modèle de menace et le signalement d'une vulnérabilité.

## Installation

Télécharge le dernier installateur depuis la [page des versions](https://github.com/jcalhinho/agent-observer/releases)
et vérifie-le avec `SHA256SUMS.txt` de la même version.

| Plateforme | Fichier |
| --- | --- |
| macOS, Apple Silicon (M1 et suivants) | `Agent-Observer_<version>_macos-arm64.dmg` |
| macOS, Intel | `Agent-Observer_<version>_macos-x64.dmg` |
| Windows 10/11, installation par utilisateur (recommandée) | `Agent-Observer_<version>_windows-x64-setup.exe` |
| Windows 10/11, MSI pour le déploiement géré | `Agent-Observer_<version>_windows-x64.msi` |

> [!IMPORTANT]
> Les premières versions ne sont **pas signées** avec un Developer ID Apple ni un certificat de
> signature Windows ; ton système t'avertira donc au premier lancement. Les étapes ci-dessous sont la
> façon habituelle d'ouvrir une application de confiance. Dans le doute, [compile-la depuis les sources](#compiler-depuis-les-sources).
> Sur un ordinateur professionnel, suis la politique logicielle de ton organisation plutôt que de la contourner.

### macOS

1. Ouvre le `.dmg` et glisse **Agent Observer** dans **Applications**.
2. Ouvre-le une première fois depuis **Applications**. macOS dit qu'il ne peut pas vérifier le développeur.
3. Autorise-le, selon ta version de macOS :
   - **macOS 15 Sequoia et suivants :** clique sur **Terminé**, ouvre **Réglages Système → Confidentialité et
     sécurité**, descends jusqu'au message concernant l'app et clique sur **Ouvrir quand même**, puis
     confirme avec ton mot de passe.
   - **macOS 14 et antérieurs :** dans le Finder, **clic droit (ou Contrôle-clic) sur l'app → Ouvrir**,
     puis **Ouvrir** dans la boîte de dialogue.

Tu ne le fais qu'une fois. Si macOS dit que l'app **« est endommagée et ne peut pas être ouverte »**,
c'est l'indicateur de quarantaine d'un téléchargement non signé, pas un vrai dommage. Retire-le dans
le Terminal :

```bash
xattr -dr com.apple.quarantine "/Applications/RepoWatcher Agent Observer.app"
```

### Windows

1. Lance `…-setup.exe`. Il s'installe pour l'utilisateur courant, sans droits d'administrateur.
2. Si **Microsoft Defender SmartScreen** affiche *« Windows a protégé votre PC »*, clique sur
   **Informations complémentaires → Exécuter quand même**.
3. WebView2 est déjà présent sous Windows 10/11 ; l'installateur le récupère s'il manque.

Quelque chose te semble bizarre sous Windows ? [`docs/WINDOWS.md`](docs/WINDOWS.md) est une courte liste de ce qu'on peut attendre pour chaque agent.

Vérifie la somme de contrôle dans PowerShell avant de lancer :

```powershell
Get-FileHash .\Agent-Observer_*_windows-x64-setup.exe -Algorithm SHA256
```

### Premier lancement

1. Ouvre les **Réglages** (en haut à droite) et vérifie que tes agents sont détectés. Pour Claude Code,
   copie le fragment affiché dans `~/.claude/settings.json` (le jeton qu'il contient est propre à cet
   ordinateur).
2. Travaille comme d'habitude avec tes agents — les cartes se remplissent toutes seules.

Une seule instance tourne à la fois : relancer l'app ramène la fenêtre existante au premier plan.

## Compiler depuis les sources

Prérequis : [Node.js 22](https://nodejs.org/), [Rust](https://rustup.rs/) stable (1.85 ou
plus) et les [prérequis Tauri 2](https://v2.tauri.app/start/prerequisites/) de ton système
(Xcode Command Line Tools sous macOS ; Microsoft C++ Build Tools et WebView2 sous Windows ;
WebKitGTK 4.1 sous Linux).

```bash
git clone https://github.com/jcalhinho/agent-observer.git
cd agent-observer
npm ci
npm run desktop:dev      # développement, avec rechargement à chaud
npm run desktop:build    # installateurs dans target/release/bundle/
```

Tests : `npm test` dans `apps/desktop` pour l'interface, `cargo test` dans `apps/desktop/src-tauri` pour le Rust.
Linux compile depuis les sources mais n'est pas encore empaqueté ni officiellement pris en charge.
[`COMPRENDRE.md`](COMPRENDRE.md) est une visite du code en trois minutes.

## Architecture

```
CLI des agents ──hooks (HTTP, 127.0.0.1 + jeton)──┐
               ──journaux locaux / SQLite (lecture seule)──┤
                                                  ▼
                      Lecteurs Rust (apps/desktop/src-tauri/src/*_sessions.rs, codex_rollout.rs, copilot_chat.rs, …)
                                                  │  SessionEvent (crates/session-events)
                                                  ▼
                      Base SQLite + commandes/événements Tauri (src-tauri/src/main.rs)
                                                  │
                                                  ▼
                      Interface React (apps/desktop/src/ui) — un écran, une carte par agent
```

- **`crates/session-events`** — le modèle d'événement commun à tous les lecteurs, sans lien avec un
  fournisseur. Chaque valeur mesurée porte son origine (`Provider`, `LocalObservation`, `Derived`,
  `Estimated`) : un lecteur omet ce qu'il ne peut pas observer plutôt que de l'inventer.
- **Lecteurs** (`apps/desktop/src-tauri/src/`) — un module Rust par agent qui transforme ses hooks,
  journaux JSONL ou lignes SQLite en `SessionEvent`, en écartant le contenu privé avant tout stockage.
- **Coque de bureau** — Tauri 2 : le collecteur en boucle locale (axum) et la base SQLite (rusqlite).
- **Interface** — React 19 + Vite. L'état d'un agent (`agentPulse.ts`), la détection de boucle, le
  remplissage du contexte et les totaux de session vivent dans de simples modules `.ts` testés avec Vitest.

## Ajouter ton propre agent

- **API HTTP locale** — envoie des événements au collecteur local depuis un script,
  un hook ou un plugin, dans n'importe quel langage. Documentée dans [`docs/CONNECTORS.md`](docs/CONNECTORS.md).
- **Lecteur natif** — un module Rust dans l'app de bureau. Voir
  [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-connector).

## FAQ

**Envoie-t-il mon code ou mes prompts quelque part ?**
Non. Il n'y a aucune télémétrie et l'app ne fait aucune requête réseau de son propre chef. Les prompts
et les commandes ne sont même pas stockés localement tant que tu ne les actives pas.

**Ralentit-il mes agents ?**
Les lecteurs de journaux ne lisent que les nouvelles lignes de fichiers que les agents écrivent déjà.
Les hooks de Claude Code sont des appels HTTP sans attente de réponse, avec un délai de 2 secondes ;
si l'app est fermée, Claude Code continue simplement.

**Pourquoi une carte n'affiche-t-elle pas de tokens, ou de taux de cache ?**
Parce que cet agent ne les rapporte pas dans ce que l'app peut lire. L'app affiche *non rapporté*
plutôt qu'une estimation.

**Le coût affiché est-il ce qu'on me facture ?**
Non. C'est ce que les mêmes tokens coûteraient au tarif API public de chaque modèle : un repère, pas une
facture. Les abonnements se facturent autrement, et un modèle absent de la table de prix est laissé de côté
(le coût affiche alors « ≥ »).

**Voit-il les sessions lancées avant que j'ouvre l'app ?**
Non. Les lecteurs observent la nouvelle activité à partir du moment où l'app tourne ; l'historique
antérieur n'est pas importé. Tout ce qui est observé ensuite reste disponible, dans la limite de ta rétention.

**Le port 43821 est déjà utilisé.**
Une autre copie de l'app (ou autre chose) l'occupe. Une seule instance peut collecter les hooks ;
Réglages › Connecteurs montre l'état du collecteur.

**Pourquoi l'app n'est-elle pas signée ?**
Les certificats de signature coûtent de l'argent et du temps ; la chaîne de publication est prête à
signer et notariser dès qu'ils seront disponibles. En attendant, chaque version est livrée avec ses
sommes SHA-256 et construite par GitHub Actions depuis la source taguée.

## Contribuer

Rapports de bugs, demandes de connecteurs, traductions et code sont les bienvenus — commence
par [CONTRIBUTING.md](CONTRIBUTING.md). Toute personne participante doit respecter le
[Code de conduite](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE). Agent Observer est un projet indépendant, non affilié à Anthropic, OpenAI, Google,
GitHub, Alibaba ni au projet OpenCode. Les noms de produits appartiennent à leurs propriétaires.
