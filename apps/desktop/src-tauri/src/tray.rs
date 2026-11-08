//! L'icone de la barre de menus (macOS) ou de la zone de notification (Windows, Linux) : le nombre
//! d'agents qui t'attendent, toujours visible, et un menu pour ramener la fenetre ou quitter.
//!
//! L'interface calcule les etats et appelle `set_tray_status` ; cette icone ne decide de rien.

use tauri::{
    AppHandle, Manager, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "main";

/// Les entrees du menu dont le texte change (langue, etat).
pub struct TrayMenu {
    status: MenuItem<Wry>,
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Ramene la fenetre principale au premier plan, meme reduite.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Agent Observer", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Agent Observer", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&status, &PredefinedMenuItem::separator(app)?, &open, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Agent Observer")
        .menu(&menu)
        // Un clic gauche ramene la fenetre ; le menu reste au clic droit.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayMenu { status, open, quit });
    Ok(())
}

/// Le texte de l'etat, et celui des entrees du menu dans la langue de l'interface.
pub struct TrayStatus<'a> {
    pub need_you: u32,
    pub status: &'a str,
    pub open: &'a str,
    pub quit: &'a str,
}

/// Le titre affiche a cote de l'icone : le nombre d'agents qui t'attendent.
pub fn title_for(need_you: u32) -> Option<String> {
    (need_you > 0).then(|| need_you.to_string())
}

pub fn update(app: &AppHandle, status: TrayStatus<'_>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("Agent Observer — {}", status.status)));
        // Affiche a cote de l'icone sous macOS et Linux ; sans effet sous Windows.
        let _ = tray.set_title(title_for(status.need_you));
    }
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.status.set_text(status.status);
        let _ = menu.open.set_text(status.open);
        let _ = menu.quit.set_text(status.quit);
    }
}

#[cfg(test)]
mod tests {
    use super::title_for;

    #[test]
    fn the_title_is_the_count_of_agents_that_need_you() {
        assert_eq!(title_for(0), None);
        assert_eq!(title_for(3).as_deref(), Some("3"));
    }
}
