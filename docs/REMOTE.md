# Agents on another machine

Agent Observer runs on your computer and listens on `127.0.0.1:43821` only. An agent that runs on a
server, a cloud VM or in a remote dev box cannot reach that address directly — and the app never
opens a port to the network.

An SSH **remote forward** solves it without changing anything in the app: the server's own
`127.0.0.1:43821` is tunnelled back to your computer's collector, so hooks configured with the
usual address reach the app.

## What works remotely

| Agent | Remotely | Why |
| --- | --- | --- |
| Claude Code | State, tools, files, waits — **not tokens** | Hooks travel through the tunnel. Tokens come from the session log, which stays on the server. |
| Claude Code limits | Yes, with the optional status line | The status line posts to the same address. |
| Cursor | Yes (hooks) | Same as Claude Code. Its hook reads the token file path of your computer: copy the token file to the same path on the server, or edit the command. |
| Codex, Copilot, Antigravity, OpenCode, Qwen Code, Reasonix | No | They are observed by reading files on the computer where they run. |

The project folder shown is the path **on the server**: git state and "open folder" are not
available for it (the app only reads folders of your own computer).

## Set up

1. On your computer, open the app and copy the Claude Code hooks block (**Settings → Claude Code**).
2. On the server, add that block to `~/.claude/settings.json` (it already points to
   `http://127.0.0.1:43821/claude-hook` and carries this installation's token).
3. Connect with a remote forward:

   ```sh
   ssh -R 43821:127.0.0.1:43821 you@server
   ```

   Or keep it in `~/.ssh/config`:

   ```
   Host my-server
     HostName server.example.com
     RemoteForward 43821 127.0.0.1:43821
   ```

4. Run Claude Code on the server as usual: its sessions show up in the app while the SSH
   connection is open. When it is closed, hooks give up after 2 seconds without disturbing the agent.

## Security

- `ssh -R` binds the forwarded port to the server's loopback only (unless the server sets
  `GatewayPorts yes`): other machines cannot reach it.
- On a server shared with other users, they can reach the server's `127.0.0.1:43821` while the
  tunnel is open. Every request still needs this installation's token, so they cannot post events,
  but do not share the token.
- Nothing else is exposed: the tunnel only forwards to the collector, which only accepts hook
  and status line requests.

## Containers on the same computer

A container has its own `127.0.0.1`. Point the hook URL at your computer instead
(`http://host.docker.internal:43821/claude-hook` with Docker Desktop), or run the container with
the host network. This has not been tested by the project yet.
