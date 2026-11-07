import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Une notification système. Silencieux hors de l'application de bureau (aperçu, démo, navigateur). */
export async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* pas de notification possible ici : l'alerte reste visible dans l'écran */
  }
}

/** Le nombre d'agents qui t'attendent, sur l'icône de l'app quand le système le permet. */
export async function setBadge(count: number) {
  try {
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch {
    /* idem */
  }
}
