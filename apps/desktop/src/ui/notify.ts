import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Whether the system lets the app notify; asks once if it has not been decided. */
export async function canNotify() {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** A plain notification, when the user allows them. */
export async function notifyUser(title: string, body: string) {
  if (await canNotify()) sendNotification({ title, body });
}
