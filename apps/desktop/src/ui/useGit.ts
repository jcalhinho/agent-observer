import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDemo } from "./demo";
import type { RepositorySnapshot } from "./types";

export type GitState = { status: "ok"; snapshot: RepositorySnapshot } | { status: "none" } | { status: "loading" };

const REFRESH_MS = 15_000;

function demoSnapshot(path: string): RepositorySnapshot | null {
  const name = path.split("/").filter(Boolean).at(-1) ?? "repo";
  if (name === "dossier-sans-titre") return null;
  const dirty = name.length % 4;
  return {
    root: path, project_hash: name, branch: name === "viralforge" ? "fix/tts-queue" : name === "agent-observer" ? "ui-riche" : "main",
    ahead: name === "agent-observer" ? 3 : 0, behind: name === "viralforge" ? 2 : 0, changed_total: dirty + 2,
    changed_files: [{ path: "src/ui/AgentCard.tsx", status: "M" }, { path: "src/ui/insights.ts", status: "??" }].slice(0, Math.max(1, dirty)),
    recent_commits: [{ short_id: "f34c2d6", subject: "docs: README réécrit pour l’écran unique", relative_time: "2 hours ago" }]
  };
}

/**
 * L'état git des dossiers de projet des agents, rafraîchi toutes les 15 secondes. Un dossier qui
 * n'est pas un dépôt (ou que git ne peut pas lire) vaut `none` : on n'affiche rien plutôt qu'une erreur.
 */
export function useGit(paths: Array<string | null>): Record<string, GitState> {
  const [state, setState] = useState<Record<string, GitState>>({});
  const wanted = [...new Set(paths.filter((path): path is string => Boolean(path)))].sort();
  const signature = wanted.join("\n");
  const busy = useRef(false);

  useEffect(() => {
    if (!wanted.length) return;
    let cancelled = false;
    const refresh = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const entries = await Promise.all(wanted.map(async (path): Promise<[string, GitState]> => {
          if (isDemo()) {
            const snapshot = demoSnapshot(path);
            return [path, snapshot ? { status: "ok", snapshot } : { status: "none" }];
          }
          try {
            return [path, { status: "ok", snapshot: await invoke<RepositorySnapshot>("repository_snapshot", { path }) }];
          } catch {
            return [path, { status: "none" }];
          }
        }));
        if (!cancelled) setState((current) => ({ ...current, ...Object.fromEntries(entries) }));
      } finally {
        busy.current = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
    // `signature` résume la liste des dossiers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return state;
}

/** Ouvre le dossier dans le gestionnaire de fichiers ; sans effet hors de l'application de bureau. */
export async function revealFolder(path: string) {
  try {
    await invoke("reveal_in_file_manager", { path });
  } catch {
    /* hors application de bureau, ou dossier disparu */
  }
}
