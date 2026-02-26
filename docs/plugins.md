# Plugins

CodexMonitor supports external plugins loaded from local plugin directories.

## Default Plugin Directory

- `$CODEX_HOME/codex-monitor-plugins`
- If `CODEX_HOME` is not set, fallback is `~/.codex/codex-monitor-plugins`

You can configure directories in app settings (`pluginDirs`).

## Plugin Structure

Each plugin lives in its own folder:

```text
<plugin-id>/
  manifest.json
  dist/
    index.js
```

`manifest.json` example:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Adds custom workflow actions.",
  "entry": "dist/index.js",
  "permissions": ["events:read", "thread:read"]
}
```

## Runtime Behavior

- Plugin host can be toggled with `pluginsEnabled`.
- Individual plugins can be disabled with `disabledPluginIds`.
- Plugin status appears in the sidebar footer and settings feature section.
- Invalid plugin entry files are surfaced in settings.

## Plugin Data Storage

Plugins can use host APIs to read/write private data:

- Read: `plugin_data_read(pluginId)`
- Write: `plugin_data_write(pluginId, content)`

Files are stored under app data directory:

- `<app-data>/plugins-data/<pluginId>.json`

## Plugin Runtime API

Plugin entry files are executed in a local plugin host. The entry should export:

- a function: `module.exports = (host) => { ... }`
- or an object with `activate(host)` / optional `deactivate()`

Current host API:

- `host.on("agent:message-completed", handler)`
- `host.on("turn:completed", handler)`
- `host.playSound("success" | "error", { volumePercent?: number })`
- `host.showToast({ title, message, durationMs? })` (screen-bottom overlay toast)
- `host.data.read()` / `host.data.write(value)`
- `host.log(message, payload?)`

`agent:message-completed` payload:

```json
{
  "workspaceId": "workspace-id",
  "threadId": "thread-id",
  "itemId": "item-id",
  "text": "assistant message text",
  "completedAt": 1739952000000
}
```

`turn:completed` payload:

```json
{
  "workspaceId": "workspace-id",
  "threadId": "thread-id",
  "turnId": "turn-id",
  "text": "last assistant message text in this turn",
  "completedAt": 1739952000000
}
```
