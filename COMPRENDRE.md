# Comprendre agent-observer en 3 minutes

## À quoi ça sert

Savoir ce que font tes agents de code, en un coup d'œil, sur un seul écran.

Rien ne sort de ton ordinateur. L'app lit, elle n'envoie rien.

## Les 8 informations de l'écran

Une carte par agent. Chaque carte répond à huit questions, et à rien d'autre :

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

Les cartes les plus urgentes passent devant : tourne en rond, bloqué,
silencieux, t'attend, au travail, au repos.

## Comment les données arrivent

Tes agents écrivent déjà sur ton disque ce qu'ils font. L'app lit ces
fichiers, en lecture seule.

- **Claude Code** pousse ses événements par des hooks, vers un petit serveur
  local protégé par un jeton.
- **Les six autres** (Codex, Copilot, Antigravity, Qwen Code, OpenCode,
  Reasonix) sont lus depuis leurs fichiers de session, surveillés en continu.
- **Cursor** passe aussi par un hook.

## Où est quoi

**Le Rust**, dans `apps/desktop/src-tauri/src/` :

| Fichier | Rôle |
|---|---|
| `claude_transcripts.rs`, `codex_rollout.rs`, `copilot_sessions.rs`, `antigravity_sessions.rs`, `qwen_sessions.rs`, `opencode_sessions.rs`, `reasonix_sessions.rs` | un lecteur par agent, c'est le cœur du projet |
| `main.rs` | le serveur local, la base SQLite, les commandes de l'interface |
| `models.rs` | le modèle configuré pour chaque agent |
| `redact.rs` | le nettoyage des messages d'erreur |
| `procs.rs` | les processus locaux et leurs ports |
| `no_window.rs` | éviter les fenêtres de console sous Windows |

**L'événement commun**, dans `crates/session-events/` : le type que tous les
lecteurs remplissent. Si tu ne lis qu'un fichier du projet, lis celui-là.

**L'interface**, dans `apps/desktop/src/ui/` :

| Fichier | Rôle |
|---|---|
| `App.tsx` | l'écran unique : la barre du haut et le plateau de cartes |
| `AgentCard.tsx` | une carte, les 8 informations |
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
cd src-tauri && cargo test   # les tests Rust
```

## Ce qui a été retiré

Le projet avait accumulé beaucoup de choses qui noyaient l'essentiel. Sont
partis, dans l'ordre : un suivi en 3D, un générateur d'« Histoire » du jour,
un rapport quotidien, un panneau pour interroger un modèle, le saut vers la
fenêtre de l'agent, puis les graphiques, l'historique événement par
événement, la page des dépôts Git, le mode mini, le centre de notifications,
l'estimation de coût en euros, la coquille à onglets et les connecteurs
personnalisés.

La raison est toujours la même : le besoin est de **voir** ce que font les
agents maintenant. Tout ce qui répondait à « qu'est-ce qui s'est passé » ou
« combien ça m'a coûté » diluait cette réponse.

L'historique git garde tout. La branche `main` contient la version complète,
`simplification` l'étape intermédiaire, `refonte` l'écran unique.
