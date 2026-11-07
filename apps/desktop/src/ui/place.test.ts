import { describe, expect, it } from "vitest";
import { placeOf } from "./AgentBar";

describe("placeOf", () => {
  it("prend le dernier segment du repertoire de travail", () => {
    expect(placeOf({ project_path: "/Users/ajc/Projects/agent-observer", file_path: null }).label)
      .toBe("agent-observer");
  });

  it("affiche ~ pour le dossier personnel, pas le nom de l'utilisateur", () => {
    expect(placeOf({ project_path: "/Users/ajc", file_path: null }).label).toBe("~");
    expect(placeOf({ project_path: "/home/ajc", file_path: null }).label).toBe("~");
  });

  it("deduit le dossier du fichier touche quand l'agent ne donne pas son repertoire", () => {
    const place = placeOf({ project_path: null, file_path: "/Users/ajc/Projects/api/src/main.rs" });
    expect(place.label).toContain("src");
    expect(place.full).toBe("/Users/ajc/Projects/api/src");
  });

  it("dit clairement qu'il ne sait pas", () => {
    expect(placeOf({ project_path: null, file_path: null }).full).toBeNull();
    expect(placeOf(null).full).toBeNull();
  });

  it("accepte les chemins Windows", () => {
    expect(placeOf({ project_path: "C:\\Users\\ajc\\Projects\\api", file_path: null }).label)
      .toBe("api");
  });

  it("garde le chemin complet pour le survol", () => {
    expect(placeOf({ project_path: "/Users/ajc/Projects/api", file_path: null }).full)
      .toBe("/Users/ajc/Projects/api");
  });
});
