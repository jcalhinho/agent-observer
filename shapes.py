#!/usr/bin/env python3
"""Imprime la STRUCTURE des sessions Continue et Copilot Chat.
Aucun contenu : les chaines deviennent 'str', les nombres 'num'.
"""
import glob, json, os, sqlite3, sys

HOME = os.path.expanduser("~")

def shape(value, depth=0):
    if depth > 4:
        return "..."
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in list(value.items())[:25]}
    if isinstance(value, list):
        return [shape(value[0], depth + 1), f"...x{len(value)}"] if value else []
    if isinstance(value, str):
        return "str"
    if isinstance(value, bool):
        return "bool"
    if value is None:
        return "null"
    return "num"

print("=" * 60)
print("CONTINUE")
print("=" * 60)
index = os.path.join(HOME, ".continue/sessions/sessions.json")
if os.path.exists(index):
    with open(index) as f:
        print("sessions.json ->", json.dumps(shape(json.load(f)), indent=1)[:900])
files = [p for p in glob.glob(os.path.join(HOME, ".continue/sessions/*.json"))
         if not p.endswith("sessions.json")]
print(f"\n{len(files)} fichier(s) de session")
if files:
    newest = max(files, key=os.path.getmtime)
    print("le plus recent :", os.path.basename(newest))
    with open(newest) as f:
        print(json.dumps(shape(json.load(f)), indent=1)[:2500])

print()
print("=" * 60)
print("COPILOT CHAT (VS Code)")
print("=" * 60)
db = os.path.join(HOME, "Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db")
if not os.path.exists(db):
    print("base introuvable")
    sys.exit(0)
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
    for name, sql in con.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"):
        try:
            n = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        except Exception as error:
            n = f"illisible ({error})"
        print(f"\n-- table {name} : {n} lignes")
        print((sql or "").strip()[:500])
    con.close()
except Exception as error:
    print("ouverture impossible :", error)
    print("si c'est un verrou, ferme VS Code et relance.")
