# Comprendre agent-observer en 5 minutes

Ce fichier est la porte d'entrée du projet. Il explique à quoi sert
l'application, de quoi elle est faite, et où regarder quand on cherche
quelque chose. Les autres documents entrent dans les détails.

## À quoi ça sert

Savoir ce que font tes agents de code. Qui travaille en ce moment, qui
attend une réponse de toi, et ce qui s'est passé plus tôt.

Rien ne sort de ton ordinateur. L'app lit, elle n'envoie rien.

## Comment les données arrivent

Tes agents écrivent déjà sur ton disque ce qu'ils font. L'app lit ces
fichiers, en lecture seule, et en tire une suite d'événements.

Deux cas :

- **Claude Code** pousse ses événements vers l'app, par des hooks. L'app
  ouvre pour ça un petit serveur local protégé par un jeton.
- **Les six autres** (Codex, Copilot, Antigravity, Qwen Code, OpenCode,
  Reasonix) sont lus depuis leurs propres fichiers de session, que l'app
  surveille.

Chaque agent a son lecteur, un fichier par agent, et tous produisent le
même type d'événement.

## Les quatre morceaux

**1. Les lecteurs** — `apps/desktop/src-tauri/src/*_sessions.rs`,
`claude_transcripts.rs`, `codex_rollout.rs`. Un par agent. C'est là que se
trouve tout le savoir sur le format de chacun, et c'est le cœur du projet.

**2. L'événement commun** — `crates/session-events`. Le type que tous les
lecteurs remplissent : quel agent, quelle session, quel outil, quel
fichier, quand. Si tu ne lis qu'un seul fichier du projet, lis celui-là.

**3. Le stockage et l'assemblage** — `main.rs` (le serveur local, la base
SQLite, les commandes appelées par l'interface), `ingest.rs` (l'API locale
ouverte), `redact.rs` (le nettoyage des messages d'erreur), `workspace.rs`
(les dépôts Git trouvés dans un dossier), `procs.rs` (les processus et
leurs ports), `models.rs` (le modèle configuré pour chaque agent).

**4. L'interface** — `apps/desktop/src/ui/`. En React, dans une fenêtre
Tauri.

## L'interface, écran par écran

- **`Stage.tsx`** — l'écran principal : une carte par agent, avec ce qu'il
  fait, où, et depuis combien de temps. Un clic ouvre ses détails.
- **`SessionsPage.tsx` et `EventFeed.tsx`** — l'historique, événement par
  événement.
- **`SessionAnalytics.tsx`** — les graphiques sur la période choisie.
- **`AgentsPanel.tsx` et `AgentCard.tsx`** — le détail d'un agent.
- **`ConnectorsPage.tsx`** — brancher chaque agent. C'est par là qu'on
  commence quand rien n'apparaît.
- **`SettingsPage.tsx`** — ce qui est enregistré, combien de temps,
  l'export et l'effacement.
- **`MiniView.tsx`** — la version réduite dans un coin de l'écran.

## Lancer le projet

```bash
cd apps/desktop
npm install          # la première fois
npm run tauri dev    # l'app en mode développement
npm run typecheck    # vérifier les types
npm test             # les tests de l'interface
cd src-tauri && cargo test   # les tests Rust
```

## Ce qui a été retiré, et pourquoi

Le projet avait accumulé des fonctions qui noyaient l'essentiel : un suivi
en 3D, un générateur d'« Histoire » du jour, un rapport quotidien, un
panneau pour interroger un modèle sur tes événements, et le saut vers la
fenêtre de l'agent.

Tout ça est parti. La raison est simple : le besoin de départ est de
**voir** ce que font les agents, et chaque fonction en plus rendait ça
moins lisible. Le saut vers la fenêtre relevait d'ailleurs plutôt d'un
outil de contrôle des agents que d'un observateur.

L'historique git garde tout : la branche `main` contient encore ces
fonctions si tu veux en récupérer une.
