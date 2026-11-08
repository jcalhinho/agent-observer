#!/usr/bin/env bash
# Writes the `latest.json` the in-app updater reads, from the signed update files of one release.
#   packaging/updater/render-latest-json.sh <version> <owner/repo> <assets dir>
# Each platform is listed only when its update file and its .sig are both in <assets dir>:
#   darwin-aarch64  Agent-Observer_<version>_macos-arm64.app.tar.gz
#   darwin-x86_64   Agent-Observer_<version>_macos-x64.app.tar.gz
#   windows-x86_64  Agent-Observer_<version>_windows-x64-setup.exe
#   linux-x86_64    Agent-Observer_<version>_linux-x64.AppImage
# The app downloads https://github.com/<owner/repo>/releases/latest/download/latest.json, so a
# draft release offers nothing until it is published.
set -euo pipefail

if (( $# != 3 )); then
  echo "usage: $0 <version> <owner/repo> <assets dir>" >&2
  exit 2
fi
version="$1" repo="$2" assets="$3"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { echo "not a version: $version" >&2; exit 2; }
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "not owner/repo: $repo" >&2; exit 2; }
[[ -d "$assets" ]] || { echo "not a directory: $assets" >&2; exit 2; }

python3 - "$version" "$repo" "$assets" <<'PY'
import datetime, json, os, sys

version, repo, assets = sys.argv[1:4]
files = {
    "darwin-aarch64": f"Agent-Observer_{version}_macos-arm64.app.tar.gz",
    "darwin-x86_64": f"Agent-Observer_{version}_macos-x64.app.tar.gz",
    "windows-x86_64": f"Agent-Observer_{version}_windows-x64-setup.exe",
    "linux-x86_64": f"Agent-Observer_{version}_linux-x64.AppImage",
}
platforms = {}
for platform, name in files.items():
    path = os.path.join(assets, name)
    if os.path.isfile(path) and os.path.isfile(path + ".sig"):
        with open(path + ".sig", encoding="utf-8") as handle:
            signature = handle.read().strip()
        if not signature:
            sys.exit(f"empty signature: {name}.sig")
        platforms[platform] = {
            "signature": signature,
            "url": f"https://github.com/{repo}/releases/download/v{version}/{name}",
        }
if not platforms:
    sys.exit("no signed update file found")
json.dump({
    "version": version,
    "notes": f"https://github.com/{repo}/blob/v{version}/CHANGELOG.md",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": platforms,
}, sys.stdout, indent=2)
print()
PY
