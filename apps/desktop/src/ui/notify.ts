import { invoke } from "@tauri-apps/api/core";
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

/** L'état affiché par l'icône de la barre de menus : son nombre, son infobulle et son menu. */
export async function setTrayStatus(needYou: number, status: string, open: string, quit: string) {
  try {
    await invoke("set_tray_status", { needYou, status, open, quit });
  } catch {
    /* idem */
  }
}
