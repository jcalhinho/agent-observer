# Comprendre agent-observer en 3 minutes

## À quoi ça sert

Savoir ce que font tes agents de code, en un coup d'œil, sur un seul écran.

Rien ne sort de ton ordinateur. L'app lit, elle n'envoie rien.

## Ce que montre l'écran

Une barre par agent, empilées en colonne. Chaque barre répond d'abord à huit questions :

1. **Qui t'attend** — l'état, en un mot, coloré selon l'urgence.
2. **Qui travaille** — compté en haut de l'écran.
3. **Ce qu'il fait là** — l'outil en cours et son fichier ou sa commande.
4. **Depuis combien de temps** — l'âge de la dernière activité.
5. **Où** — le dossier du projet.
6. **Si ça tourne mal** — boucle détectée ou échecs en série, affiché à la
   place de l'activité et en couleur.
7. **Combien ça consomme** — les tokens de la session, et une barre de
   remplissage du contexte.
8. **Quel modèle** — celui que l'agent a rapporté, sinon celui qui est
   configuré.

Puis viennent les chiffres alignés d'une barre à l'autre (tokens, cache, coût,
contexte, outils, activité) et une seconde ligne : limites d'abonnement, git,
rythme, collisions, outils les plus utilisés.

Les barres les plus urgentes passent devant : tourne en rond, bloqué,
silencieux, t'attend, au travail, au repos. Autour : des alertes en haut,
une barre d'état en bas, l'historique par jour, le thème clair ou sombre et
le mode réduit en colonne.

## Comment les données arrivent

Tes agents écrivent déjà sur ton disque ce qu'ils font. L'app lit ces
fichiers, en lecture seule.

- **Claude Code** pousse ses événements par des hooks, vers un petit serveur
  local protégé par un jeton.
- **Les sept autres** (Codex, Copilot, Antigravity, Qwen Code, OpenCode,
  Reasonix, Continue) sont lus depuis leurs fichiers de session ou journaux,
  surveillés en continu.
- **Cursor** passe aussi par un hook.

## Où est quoi

**Le Rust**, dans `apps/desktop/src-tauri/src/` :

| Fichier | Rôle |
|---|---|
| `claude_transcripts.rs`, `codex_rollout.rs`, `copilot_sessions.rs`, `copilot_chat.rs`, `antigravity_sessions.rs`, `qwen_sessions.rs`, `opencode_sessions.rs`, `reasonix_sessions.rs`, `continue_sessions.rs` | un lecteur par agent, c'est le cœur du projet |
| `main.rs` | le serveur local, la base SQLite, les commandes de l'interface |
| `limits.rs` | les limites d'abonnement rapportées par Codex et Claude Code |
| `activity.rs` | le résumé d'activité en lecture seule (pour le serveur MCP) |
| `git_info.rs` | l'état git d'un dossier, en lecture seule |
| `diagnostics.rs` | les compteurs du diagnostic (événements par agent, requêtes refusées) |
| `tray.rs` | l'icône de la barre des menus et son menu |
| `models.rs` | le modèle configuré pour chaque agent |
| `redact.rs` | le nettoyage des messages d'erreur |
| `procs.rs` | les processus locaux et leurs ports |
| `no_window.rs` | éviter les fenêtres de console sous Windows |

**L'événement commun**, dans `crates/session-events/` : le type que tous les
lecteurs remplissent. Si tu ne lis qu'un fichier du projet, lis celui-là.

**L'interface**, dans `apps/desktop/src/ui/` :

| Fichier | Rôle |
|---|---|
| `App.tsx` | l'écran unique : la barre du haut, les alertes, les barres, la barre d'état |
| `AgentBar.tsx` | la barre d'un agent |
| `AgentDetail.tsx` | le panneau de détail d'un agent |
| `History.tsx` | l'historique par jour (`useHistory.ts` : la requête filtrée à la base) |
| `pastSessions.ts` | les sessions précédentes d'un agent, dans son détail |
| `projectGroups.ts` | le rangement des barres par projet |
| `DiagnosticSection.tsx`, `diagnosticView.ts` | le diagnostic des réglages et son texte à copier |
| `UpdatesSection.tsx` | la mise à jour intégrée (versions signées seulement) |
| `analysis.ts` | collisions, rythme, budget, totaux par jour |
| `limitsView.ts` | l'affichage des limites d'abonnement |
| `SettingsPanel.tsx` | le panneau des réglages et des connecteurs |
| `agentPulse.ts` | le calcul de l'état d'un agent à partir de ses événements |
| `loopDetector.ts` | la détection des boucles |
| `activity-copy.ts` | transformer un événement en phrase lisible |
| `contextUsage.ts` | le remplissage de la fenêtre de contexte |
| `sessionSummary.ts` | les totaux d'une session (tours, outils, tokens) |
| `useObserver.ts` | le flux d'événements : l'historique récent puis le direct |

## Lancer le projet

```bash
cd apps/desktop
npm install          # la première fois
npm run tauri dev    # l'app
npm run typecheck    # les types
npm test             # les tests de l'interface
cd src-tauri && cargo test   # les tests Rust (après npm run build : Tauri embarque l'interface)
```
