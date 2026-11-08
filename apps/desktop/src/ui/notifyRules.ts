import type { BudgetState, Collision } from "./analysis";
import type { PulseStatus } from "./agentPulse";
import { t } from "./i18n";
import { usd } from "./insights";
import { agentName } from "./providers";

/** Une notification à envoyer. `id` sert à ne pas la répéter. */
export type Alert = { id: string; title: string; body: string };

type PulseLike = { key: string; status: PulseStatus; failureStreak: number; loop: { evidence: string } | null };

/**
 * Les changements d'état qui méritent de te sortir de ce que tu fais : un agent qui tourne en
 * rond, qui est bloqué, silencieux, ou qui vient de finir son tour. Le premier passage ne notifie
 * rien (`previous` vide) : on ne réveille pas pour un état déjà là au lancement.
 */
export function attentionAlerts(previous: Record<string, PulseStatus>, pulses: PulseLike[]): Alert[] {
  const alerts: Alert[] = [];
  for (const pulse of pulses) {
    const before = previous[pulse.key];
    if (before === undefined || before === pulse.status) continue;
    const name = agentName(pulse.key);
    if (pulse.status === "looping") alerts.push({ id: `${pulse.key}:looping`, title: t(`${name} tourne en rond`, `${name} is going in circles`), body: pulse.loop?.evidence ?? t("Il répète les mêmes actions sans avancer.", "It repeats the same actions without progress.") });
    else if (pulse.status === "blocked") alerts.push({ id: `${pulse.key}:blocked`, title: t(`${name} est bloqué`, `${name} is blocked`), body: t(`${pulse.failureStreak} échecs d’affilée.`, `${pulse.failureStreak} failures in a row.`) });
    else if (pulse.status === "stalled") alerts.push({ id: `${pulse.key}:stalled`, title: t(`${name} est silencieux`, `${name} went quiet`), body: t("Un tour est ouvert mais rien ne bouge : il attend peut-être ta validation.", "A turn is open but nothing moves: it may be waiting for your approval.") });
    else if (pulse.status === "waiting" && (before === "working" || before === "stalled")) alerts.push({ id: `${pulse.key}:waiting`, title: t(`${name} a fini`, `${name} is done`), body: t("Son tour est terminé : il attend ton prochain message.", "Its turn is finished: it is waiting for your next message.") });
  }
  return alerts;
}

/** Les collisions apparues depuis le dernier passage. */
export function collisionAlerts(known: ReadonlySet<string>, collisions: Collision[], key: (collision: Collision) => string): Alert[] {
  return collisions.filter((collision) => !known.has(key(collision))).map((collision) => {
    const names = collision.agents.map(agentName).join(" + ");
    const place = collision.path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");
    return collision.kind === "file"
      ? { id: key(collision), title: t("Deux agents sur le même fichier", "Two agents on the same file"), body: `${names} · ${place}` }
      : { id: key(collision), title: t("Deux agents dans le même projet", "Two agents in the same project"), body: `${names} · ${place}` };
  });
}

/** Le franchissement d'un seuil de budget, une seule fois par seuil et par jour. */
export function budgetAlert(previous: BudgetState, current: BudgetState, spent: number | null, limit: number | null, day: string): Alert | null {
  if (previous === current || spent === null || !limit) return null;
  if (current === "over") return { id: `budget:over:${day}`, title: t("Budget du jour dépassé", "Daily budget exceeded"), body: t(`≈ ${usd(spent)} dépensés sur ${usd(limit)} prévus.`, `≈ ${usd(spent)} spent of ${usd(limit)} planned.`) };
  if (current === "near" && previous !== "over") return { id: `budget:near:${day}`, title: t("Budget du jour bientôt atteint", "Daily budget almost reached"), body: t(`≈ ${usd(spent)} sur ${usd(limit)} prévus.`, `≈ ${usd(spent)} of ${usd(limit)} planned.`) };
  return null;
}

/** Le texte de l'icône de la barre de menus : qui t'attend, sinon qui travaille. */
export function trayStatusText(statuses: string[]): { needYou: number; text: string } {
  const needYou = statuses.filter((status) => status === "looping" || status === "blocked" || status === "stalled" || status === "waiting").length;
  const working = statuses.filter((status) => status === "working").length;
  const parts: string[] = [];
  if (needYou) parts.push(t(`${needYou} t’${needYou > 1 ? "attendent" : "attend"}`, `${needYou} need${needYou > 1 ? "" : "s"} you`));
  if (working) parts.push(t(`${working} au travail`, `${working} working`));
  return { needYou, text: parts.length ? parts.join(" · ") : t("Aucun agent actif", "No active agent") };
}
