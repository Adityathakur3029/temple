---
name: release
description: Deploy Sannidhi to staging or production (versioned assets to R2, realtime Worker, web app to Cloudflare Pages) and smoke-test it. Run only when the user explicitly asks to deploy or release.
disable-model-invocation: true
---

# Release

Deploys are outward-facing, so confirm the target (`staging` or `production`) with the user before step 3. Every deploy command is in the `ask` list in `.claude/settings.json`. Stop at the first failure and report it. Don't retry with different flags.

## 1. Pre-flight (no changes made)
- `git status` is clean, and the user has named the commit or tag to release.
- `npm run check`, `npm test` and `npm run test:e2e` pass. Report the summary lines.
- Check the protocol version. If `PROTOCOL_VERSION` changed since the last release, the realtime Worker must deploy **before** the web app, and the old web app must show "Please refresh" on close code 4002 (spec 04). Tell the user this release forces a refresh.
- Confirm the asset manifest's `version` folder (for example `/v/<hash>/`) is new if any asset changed.

## 2. Build
- `npm run build`. Note the bundle sizes from the output and compare them with spec 10.

## 3. Deploy, in this order
1. **Assets:** upload only new versioned folders to R2 (`npm run deploy:assets -- --env <target>`). Never overwrite an existing version folder. Old versions stay for visitors with cached pages. Until the asset pipeline and asset Worker exist (no asset manifest yet, as in M0), skip this step and say so in the report.
2. **Realtime Worker:** `npm run deploy:realtime -- --env <target>`.
3. **Web app:** `npm run deploy:web -- --env <target>`.

## 4. Smoke test
- Open the deployed URL. The loader appears and the temple becomes interactive.
- `GET /api/rooms` returns 20 halls with counts.
- Two browser windows in the same hall see each other move and see a namaste.
- If the release touched aarti: the next aarti time shows correctly in IST.

## 5. Report
- Tell the user what was deployed (commit, asset version, protocol version), the smoke-test results, and how to roll back: redeploy the previous Pages build and Worker version. Assets don't need rolling back because versions are immutable.
