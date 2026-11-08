#!/usr/bin/env bash
# Installs (or updates) Agent Observer from the latest published GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/jcalhinho/agent-observer/main/install.sh | bash
#
# macOS: the .dmg for your processor goes to /Applications (the running copy is closed first).
# Linux: the AppImage goes to ~/.local/bin/agent-observer.
# Every download is checked against the release's SHA256SUMS.txt before anything is installed.
#
# Options (environment variables):
#   AGENT_OBSERVER_VERSION=0.13.3   install that version instead of the latest one
#   AGENT_OBSERVER_REPO=owner/repo  install from a fork
#   AGENT_OBSERVER_DRY_RUN=1        print what would be downloaded and installed, change nothing
set -euo pipefail

REPO="${AGENT_OBSERVER_REPO:-jcalhinho/agent-observer}"
APP_NAME="Agent Observer"
# Releases before 0.15 named the app "RepoWatcher Agent Observer": that copy is replaced.
LEGACY_APP_NAME="RepoWatcher Agent Observer"
DRY_RUN="${AGENT_OBSERVER_DRY_RUN:-0}"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "AGENT_OBSERVER_REPO must look like owner/repo."
command -v curl >/dev/null || fail "curl is required."

# --- which file for this machine -------------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)
    case "$arch" in
      arm64) label="macos-arm64" ;;
      x86_64) label="macos-x64" ;;
      *) fail "unsupported Mac processor: $arch" ;;
    esac
    extension="dmg"
    ;;
  Linux)
    [[ "$arch" == "x86_64" ]] || fail "only x86_64 Linux builds are published (found $arch)."
    label="linux-x64"
    extension="AppImage"
    ;;
  *) fail "this script installs on macOS and Linux; for Windows, download the installer from https://github.com/$REPO/releases" ;;
esac

# --- which version ---------------------------------------------------------------------------
version="${AGENT_OBSERVER_VERSION:-}"
if [[ -z "$version" ]]; then
  # github.com answers /releases/latest with a redirect to /releases/tag/v<version>: no API, no JSON.
  headers="$(curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null)" || fail "could not reach github.com to find the latest release."
  location="$(printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }' | tail -n 1)"
  version="${location##*/tag/v}"
  [[ "$location" == */tag/v* ]] || fail "no published release found for $REPO (draft releases are not visible)."
fi
version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || fail "unexpected version: $version"

asset="Agent-Observer_${version}_${label}.${extension}"
base="https://github.com/$REPO/releases/download/v${version}"
say "Agent Observer ${version} for ${label}"
say "  ${base}/${asset}"

if [[ "$DRY_RUN" == "1" ]]; then
  case "$os" in
    Darwin) say "Would install: /Applications/${APP_NAME}.app" ;;
    Linux) say "Would install: ${HOME}/.local/bin/agent-observer" ;;
  esac
  exit 0
fi

# --- download and check ----------------------------------------------------------------------
work="$(mktemp -d)"
mounted=""
cleanup() {
  if [[ -n "$mounted" ]]; then
    hdiutil detach "$mounted" -quiet >/dev/null 2>&1 || true
    rmdir "$mounted" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

curl -fL --progress-bar -o "$work/$asset" "$base/$asset" || fail "download failed: $base/$asset"
curl -fsSL -o "$work/SHA256SUMS.txt" "$base/SHA256SUMS.txt" || fail "could not download SHA256SUMS.txt"

expected="$(awk -v name="$asset" '$2 == name || $2 == "*"name { print $1 }' "$work/SHA256SUMS.txt")"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "$asset is not listed in SHA256SUMS.txt"
if command -v sha256sum >/dev/null; then
  actual="$(sha256sum "$work/$asset" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$work/$asset" | awk '{ print $1 }')"
fi
[[ "$actual" == "$expected" ]] || fail "checksum mismatch for $asset: the download is corrupted or was tampered with."
say "Checksum OK."

# --- install ---------------------------------------------------------------------------------
if [[ "$os" == "Darwin" ]]; then
  mounted="$(mktemp -d)"
  hdiutil attach "$work/$asset" -nobrowse -readonly -quiet -mountpoint "$mounted" || fail "could not open the disk image"
  # The disk image of an older release still holds the former name.
  name="$APP_NAME"
  [[ -d "$mounted/${name}.app" ]] || name="$LEGACY_APP_NAME"
  source_app="$mounted/${name}.app"
  [[ -d "$source_app" ]] || fail "the disk image does not contain ${APP_NAME}.app"
  dest="/Applications/${name}.app"

  # Two copies cannot share the collector port: close the running ones first (either name).
  for running in "$APP_NAME" "$LEGACY_APP_NAME"; do
    installed="/Applications/${running}.app"
    pgrep -f "${installed}/Contents/MacOS/" >/dev/null 2>&1 || continue
    say "Closing the running copy…"
    osascript -e "quit app \"${running}\"" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      pgrep -f "${installed}/Contents/MacOS/" >/dev/null 2>&1 || break
      sleep 0.5
    done
    pgrep -f "${installed}/Contents/MacOS/" >/dev/null 2>&1 && fail "quit ${running} and run this script again."
  done

  rm -rf "$dest"
  ditto "$source_app" "$dest"
  # The copy under the other name is the same app (same settings and history): remove it.
  for other in "$APP_NAME" "$LEGACY_APP_NAME"; do
    [[ "$other" == "$name" ]] && continue
    if [[ -d "/Applications/${other}.app" ]]; then
      rm -rf "/Applications/${other}.app"
      say "Removed the former copy: /Applications/${other}.app"
    fi
  done
  # curl does not mark downloads as quarantined; clear the flag anyway in case a copy was.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  say "Installed: $dest"
  open "$dest" || true
else
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  install -m 0755 "$work/$asset" "$bin_dir/agent-observer"
  say "Installed: $bin_dir/agent-observer"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *) say "Add ${bin_dir} to your PATH, or run it with its full path." ;;
  esac
  say "AppImages need FUSE 2 (libfuse2 on Ubuntu). A .deb is also attached to each release."
fi
