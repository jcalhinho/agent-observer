import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentLang } from "./i18n";
import { isBoolean, isString, readPreference, writePreference } from "./preferences";
import { buildStoryFacts, buildStoryPrompt, DEFAULT_STORY_TIME, isClock, type StoryErrorCode, type StoryFacts } from "./story";
import type { SessionEvent } from "./types";

export type StoryAgent = { provider: string; name: string; program: string; origin: "command" | "editor" | "desktop"; version: string | null };
export type StoryRecord = { id: number; created_at: string; period_from: string; period_to: string; language: string; agent: string; text: string; seconds: number };
export class StoryError extends Error {
  constructor(readonly code: StoryErrorCode, readonly detail: string) { super(code); }
}

/** Agents that can write a story, in the order they are preferred when none is chosen. */
const PRIORITY = ["claude_code", "codex", "gemini_cli", "qwen_code", "opencode"];

export const storySettings = {
  auto: () => readPreference("story.auto", false, isBoolean),
  time: () => readPreference("story.time", DEFAULT_STORY_TIME, isClock),
  agent: () => readPreference("story.agent", "auto", isString),
  consented: () => readPreference<string[]>("story.consent", [], (value): value is string[] => Array.isArray(value) && value.every(isString)),
  consent: (provider: string) => writePreference("story.consent", [...new Set([...storySettings.consented(), provider])]),
  lastSlot: () => readPreference("story.last-slot", 0, (value): value is number => typeof value === "number" && Number.isFinite(value))
};

export function pickAgent(agents: StoryAgent[], chosen: string): StoryAgent | null {
  return agents.find((agent) => agent.provider === chosen) ?? [...agents].sort((a, b) => PRIORITY.indexOf(a.provider) - PRIORITY.indexOf(b.provider))[0] ?? null;
}

/** Agents installed on this computer (asked once, again on demand). */
export function useStoryAgents() {
  const [agents, setAgents] = useState<StoryAgent[] | null>(null);
  const refresh = useCallback(() => { invoke<StoryAgent[]>("story_agents").then(setAgents).catch(() => setAgents([])); }, []);
  useEffect(refresh, [refresh]);
  return { agents, refresh };
}

/** Stories already written, newest first. */
export function useStories() {
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const reload = useCallback(() => { invoke<StoryRecord[]>("list_stories", { limit: 60 }).then(setStories).catch(() => setStories([])); }, []);
  useEffect(reload, [reload]);
  const remove = useCallback(async (id: number) => { await invoke("delete_story", { id }); reload(); }, [reload]);
  return { stories, reload, remove };
}

export const previewStory = (events: SessionEvent[]): { facts: StoryFacts; prompt: string } => {
  const facts = buildStoryFacts(events, Date.now(), currentLang());
  return { facts, prompt: buildStoryPrompt(facts) };
};

/** Asks the agent for the story of the last 24 hours, and keeps it. */
export async function writeStory(events: SessionEvent[], provider: string): Promise<StoryRecord> {
  const { facts, prompt } = previewStory(events);
  let result: { text: string; agent: string; seconds: number };
  try {
    result = await invoke("generate_story", { provider, prompt });
  } catch (error) {
    const { code, detail } = (error ?? {}) as { code?: StoryErrorCode; detail?: string };
    throw new StoryError(code ?? "failed", detail ?? String(error));
  }
  const record = { id: 0, created_at: new Date().toISOString(), period_from: facts.period.from, period_to: facts.period.to, language: facts.language, agent: result.agent, text: result.text, seconds: result.seconds };
  record.id = await invoke<number>("save_story", { story: record });
  return record;
}

export const cancelStory = () => invoke("cancel_story").catch(() => undefined);

/** Asks the agent a question about the history; the answer is not kept anywhere. */
export async function askAgent(provider: string, prompt: string): Promise<string> {
  try {
    const result = await invoke<{ text: string }>("generate_story", { provider, prompt });
    return result.text;
  } catch (error) {
    const { code, detail } = (error ?? {}) as { code?: StoryErrorCode; detail?: string };
    throw new StoryError(code ?? "failed", detail ?? String(error));
  }
}
