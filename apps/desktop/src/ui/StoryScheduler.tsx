import { useEffect, useRef } from "react";
import { t } from "./i18n";
import { notifyUser } from "./notify";
import { isBoolean, readPreference, writePreference } from "./preferences";
import { latestSlot, storyDue } from "./story";
import { pickAgent, storySettings, StoryError, writeStory } from "./useStory";
import { invoke } from "@tauri-apps/api/core";
import type { StoryAgent } from "./useStory";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

/** The sentence a notification shows: the first paragraph of the story, without its title. */
export function storyTeaser(text: string) {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part && !part.startsWith("#") && !part.startsWith("-")) ?? "";
  const plain = line.replace(/[*`]/g, "");
  return plain.length > 150 ? `${plain.slice(0, 147)}…` : plain;
}

/**
 * Once a day, at the chosen time (18:00 by default), writes the story and says so; if the app was
 * closed then, it happens at the next launch. With the daily story off, it only reminds you that
 * the report is ready. Renders nothing.
 */
export function StoryScheduler({ events }: { events: SessionEvent[] }) {
  const now = useNow(30_000);
  const running = useRef(false);
  useEffect(() => {
    if (!events.length || running.current) return;
    const time = storySettings.time();
    const auto = storySettings.auto();
    const last = auto ? storySettings.lastSlot() : readPreference("report.last-slot", 0, (value): value is number => typeof value === "number");
    if (last === 0) { writePreference(auto ? "story.last-slot" : "report.last-slot", latestSlot(now, time)); return; }
    const due = storyDue(last, now, time);
    if (due === null) return;
    writePreference(auto ? "story.last-slot" : "report.last-slot", due);

    if (!auto) {
      if (readPreference("notify.enabled", true, isBoolean) && readPreference("daily-report.enabled", true, isBoolean)) void notifyUser(t("Ton rapport des dernières 24 h est prêt", "Your 24 h report is ready"), t("Ouvre le panneau Histoire pour le lire.", "Open the Story panel to read it."));
      return;
    }
    running.current = true;
    void (async () => {
      try {
        const agents = await invoke<StoryAgent[]>("story_agents");
        const agent = pickAgent(agents, storySettings.agent());
        if (!agent || !storySettings.consented().includes(agent.provider)) return;
        const story = await writeStory(events, agent.provider);
        if (readPreference("notify.enabled", true, isBoolean)) await notifyUser(t("Ton histoire du jour est prête", "Your daily story is ready"), storyTeaser(story.text));
      } catch (error) {
        // A run that is busy is tried again at the next tick; any other failure is not retried until
        // tomorrow, so a broken login never burns quota. The story can be written by hand any time.
        if (error instanceof StoryError && error.code === "busy") writePreference("story.last-slot", last);
        else if (!(error instanceof StoryError)) console.warn(error);
      } finally {
        running.current = false;
      }
    })();
  }, [events, now]);
  return null;
}
