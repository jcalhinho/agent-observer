#!/usr/bin/env bash
# Writes the Homebrew cask of one release to stdout.
#   packaging/homebrew/render-cask.sh <version> <sha256 arm64 dmg> <sha256 x64 dmg> <owner/repo>
# The release workflow attaches the result to each release; copy it to Casks/agent-observer.rb
# in a tap repository named <owner>/homebrew-tap to make `brew install --cask` work.
set -euo pipefail

if (( $# != 4 )); then
  echo "usage: $0 <version> <sha256-arm64> <sha256-x64> <owner/repo>" >&2
  exit 2
fi
version="$1" arm="$2" intel="$3" repo="$4"
for sum in "$arm" "$intel"; do
  [[ "$sum" =~ ^[0-9a-f]{64}$ ]] || { echo "not a sha256: $sum" >&2; exit 2; }
done
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { echo "not a version: $version" >&2; exit 2; }
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "not owner/repo: $repo" >&2; exit 2; }

cat <<CASK
cask "agent-observer" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${arm}",
         intel: "${intel}"

  url "https://github.com/${repo}/releases/download/v#{version}/Agent-Observer_#{version}_macos-#{arch}.dmg"
  name "Agent Observer"
  desc "Local dashboard of what your AI coding agents are doing"
  homepage "https://github.com/${repo}"

  depends_on macos: ">= :big_sur"

  app "RepoWatcher Agent Observer.app"

  # The app is not signed with an Apple Developer ID yet: without this, Gatekeeper refuses to
  # open it after a Homebrew install.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/RepoWatcher Agent Observer.app"]
  end

  zap trash: [
    "~/Library/Application Support/dev.repowatcher.agentobserver",
    "~/Library/Caches/dev.repowatcher.agentobserver",
    "~/Library/WebKit/dev.repowatcher.agentobserver",
  ]
end
CASK
