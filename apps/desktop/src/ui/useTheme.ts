import { useEffect } from "react";
import { oneOf, usePreference } from "./preferences";

export type Theme = "dark" | "light";

/** Thème de l'interface, retenu d'un lancement à l'autre et posé sur `<html data-theme>`. */
export function useTheme() {
  const [theme, setTheme] = usePreference<Theme>("theme", "dark", oneOf("dark", "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#d9dde3" : "#101318");
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")] as const;
}
