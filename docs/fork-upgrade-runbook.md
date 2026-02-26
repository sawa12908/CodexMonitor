# Fork Upgrade Runbook

Use this runbook when pulling upstream changes into your fork while keeping plugin support.

## Branch Strategy

- `upstream-main`: tracks upstream repository
- `custom-main`: your distributable branch
- feature branches for changes (`feature/*`)

## Upgrade Steps

1. Fetch upstream changes.
2. Update `upstream-main` from upstream default branch.
3. Rebase or merge `custom-main` onto latest `upstream-main`.
4. Resolve conflicts with priority:
   - `src/plugins/*` or plugin-related files
   - `src/App.tsx` sidebar/status wiring
   - `src/features/settings/*` plugin settings section
   - `src-tauri/src/shared/plugins_core.rs`
   - `src-tauri/src/plugins.rs`, daemon RPC wiring
5. Run validation:
   - `npm run typecheck`
   - `npm run test`
   - `cd src-tauri && cargo check`
6. Smoke-test:
   - Plugin host toggle on/off
   - Plugin discovery refresh
   - Plugin enabled/disabled behavior

## Conflict Minimization Rules

- Keep plugin behavior in dedicated host/core files.
- Avoid editing thread/workspace reducers for plugin-only features.
- Prefer additive UI slots over deep component rewrites.
- Keep app and daemon command names consistent.
