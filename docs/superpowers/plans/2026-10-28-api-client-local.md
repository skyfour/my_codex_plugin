# Local API Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved local API client, encrypted portable workspace recovery and protocol debugging without cloud collaboration.
**Architecture:** Extend existing ApiService, Postman runtime and MCP Apps React UI. Keep HTTP runs separate from bounded long-lived protocol sessions. Use versioned encrypted migration with staged files and Keychain compensation.
**Tech Stack:** Node24, React19, TypeScript, SQLite, macOS Keychain, postman-runtime; established format/protocol libraries when needed.
**Spec:** docs/superpowers/specs/2026-10-28-api-client-local-design.md

## Global Constraints

- Only API Client and associated docs; no release/version bump, no pushes, no installed cache replacement. Worktree `/Users/skyfour/work/business/exports/api-client-local-implementation`.
- User approved approach A, no Mock/scheduler/docs platform. HTTP/GraphQL support scripts/runner; other protocols interactive only. MCP remote HTTP/SSE only, no arbitrary stdio startup.
- Secrets remain in Keychain. Encrypted full backups include secrets, Cookie, referenced attachments and certificates; sanitized ordinary export remains available.
- Import never executes scripts/connects; preserve v1 import and current user data. Preview conflicts; default preserve local singleton values, explicit restore creates recoverable snapshot.
- UI tools carrying passwords/raw secrets must have MCP Apps visibility=[app], never model-visible. Mask credentials/errors/events in model surfaces.
- No actual user network/credentials for tests. Synthetic fixtures only. No .codegraph index; ordinary source tools allowed.
- Every task follows RED→GREEN with focused tests first; plugin npm test before commit. Shared code evolves sequentially; never concurrent implementers.

## Review Focus

- Wrong password/tampered archive must not partially modify files, SQLite or Keychain (Task1).
- Nested/disabled/foreign file references must not grant arbitrary file access or survive as stale machine paths (Task1).
- Imported unknown request fields/auth must not silently disappear or execute without auth (Task2/3).
- Cancellation/service exit while a stream waits must release socket/listener and stop event growth (Task4/5).
- HTML/visualizer responses must not access host tokens or make implicit external requests (Task6).

### Task 1: Complete portable backup and recovery

**Files:** Create src/backup.mjs, src/backup-transfer.mjs, web/WorkspaceBackup.tsx, tests/backup.test.mjs and tests/backup-ui.spec.ts; modify src/service.mjs, tools.mjs, server.mjs, workspace-transfer.mjs, store.mjs as necessary, web/main.tsx and existing import UI/bridge.
**Interfaces:** App-only `api_backup_start({operation:'export'|'import',password?,includeHistory?,mode?,text?})`, `api_backup_chunk({transferId,offset?,base64?})`, `api_backup_finish({transferId,decisions?})`, `api_backup_cancel({transferId})`; choose exact schemas and document in report. Existing api_workspace_export and v1 api_import remain valid. BackupService owned by ApiService, close clears staged sessions. Export/import preview only masked metadata.
- [ ] Write failing roundtrip tests: two isolated stores+fake Keychain, secret auth/env/Cookie+settings+referenced file restored with new paths; no connection. Wrong password/tamper/unsafe path/failed transaction leave target unchanged. Ordinary export excludes auth secrets and secretRef. Preview conflict defaults local singleton values; explicit restoration snapshot can restore original. Limits and chunk offset validation.
- [ ] Run new tests under Node24 and retain RED output.
- [ ] Implement scrypt+AES256GCM authenticated envelope with bounded parameters (scrypt N=32768,r=8,p=1,maxmem=64MiB, salt16, nonce12), complete archive max256MiB, file max20MiB, count1000, chunks<=1MiB, inactivity15min. Reject dangerous paths and unreferenced machine files, use private staging, atomic DB and compensated Keychain/files. Read only owned uploads or explicitly allowed referenced paths. Restart cleanup for uncommitted staging. Capture only whitelisted UI preferences and selected environment mapping. Add UI for ordinary/full export, password, preview, conflicts and import confirmation. Never send plaintext archive/password to model.
- [ ] Run plugin tests and targeted browser test; build. Commit only task changes. Report UI/API contracts and evidence.

### Task 2: Compatibility, OpenAPI/HAR/cURL and GraphQL

**Files:** Create src/spec-import.mjs, web/GraphqlEditor.tsx, tests/spec-import.test.mjs; modify formats.mjs, collections.mjs, worker.mjs, service.mjs, tools.mjs, web/main.tsx, ImportPreview.tsx and relevant tests.
**Interfaces:** Existing api_import(_preview) accepts OpenAPI3/Swagger2 JSON/YAML and HAR; returns clear unsupported warnings. Collection extension `x-codex-api-client` stores compatibility mode; preserve unknown fields. GraphQL uses HTTP body graphql and existing runner. Inspector explicitly triggers introspection via user send action.
- [ ] RED tests for OpenAPI JSON/YAML conversion, HAR body/header import, remote ref blocked, unsupported cURL flags reject, graphQL body edit/roundtrip. Variable data outranks folder in strict mode; legacy extension behavior preserved for existing folder collections. Send isolated request cannot jump to another.
- [ ] Use maintained official Postman converters where appropriate, verify primary docs before adding pinned deps. No remote schema fetch. Preserve auth/request/IDs unknown fields. Add strict/extended mode control and warning, GraphQL query/variables/operation editor and explicit schema introspection+field completion.
- [ ] Focused RED/GREEN, plugin suite, build and UI smoke. Commit and report.

### Task 3: Advanced auth, OAuth and network configuration

**Files:** Create src/oauth.mjs, src/auth.mjs, web/OAuthPanel.tsx, tests/oauth.test.mjs; modify web/components.tsx, SettingsPanel.tsx, main.tsx, worker.mjs, service.mjs, tools.mjs, server.mjs, formats.mjs, secrets helpers if needed.
**Interfaces:** Runtime-supported auth fields exposed in AuthEditor; `api_oauth_start/poll/cancel/refresh` app-only return masked session/token metadata and persist token into selected secret variable. OAuth sessions are owned by ApiService and close on cancel/expiry. Request network overrides under extension inherited over global. Proxy credentials stored in secret variable document rather than plaintext settings.
- [ ] RED tests real local OAuth fixture: PKCE authorization code/state failure/cancel/expiry, client credentials, refresh; no leaked token/code in errors. Runtime auth fixtures for representative advanced signers, request network overrides and credentialed proxy/noProxy. Invalid auth blocks HTTP.
- [ ] Implement system-browser authorization with short-lived loopback callback, bounded lifetime, no arbitrary callback redirects; no credentials in model tools. Only explicit user OAuth action opens browser. Map installed authorizer schemas for Digest, OAuth1/2, AWS, Hawk, NTLM, EdgeGrid, JWT/ASAP; secrets stored/revealed internally via Keychain. OAuth public UI communicates authorizer field requirements.
- [ ] Run tests/build/browser auth flows fixture; commit and report.

### Task 4: Interactive SSE/WebSocket/Socket.IO

**Files:** Create src/protocol-sessions.mjs, src/protocol-web.mjs, web/ProtocolClient.tsx, tests/protocol-web.test.mjs, tests/protocol-ui.spec.ts; modify service.mjs, tools.mjs, server.mjs, main.tsx and style.css.
**Interfaces:** ProtocolSessions handles `connect(config) -> {sessionId,state}`, `action({sessionId,action,payload})`, `events({sessionId,after,limit})`, `disconnect({sessionId})`, `close()`. MCP names `api_protocol_connect/action/events/disconnect`, credentials resolved from stored collection item, no plaintext secrets returned. Config resides request `x-codex-api-client.protocol={type,...}`. Event records `{seq,time,type,data}`, states connecting/open/closing/closed/failed; limits 4 sessions,1000events,10MiB event bytes,1MiB individual event; event eviction reports cursor gap. Never auto-connect restored configs.
- [ ] RED local real SSE, WS, Socket.IO fixture tests for event ordering, binary, action, cancel, timeout, bounded buffer and close; cross-user invalid session rejects. UI connect/send/disconnect with test fixture.
- [ ] Implement mature ws/socket.io-client libs, fetch SSE parser multiline/id/retry; reconnection only explicit/bounded config. Protocol editor selected per saved item, tabs retain connections and closing owning tab disconnects. Global app close ends all.
- [ ] Focused and full plugin tests, build/UI; commit/report exact adapter interface for Task5.

### Task 5: gRPC/MQTT/remote MCP adapters

**Files:** Create src/protocol-grpc.mjs, protocol-mqtt.mjs, protocol-mcp.mjs, tests/protocol-native.test.mjs and owned fixtures; extend protocol-sessions.mjs/ProtocolClient.tsx/tools schemas; deps+lock.
**Interfaces:** Same ProtocolSessions interface from Task4; adapter functions register and own cleanup. gRPC proto dependencies from explicit permitted files or user-requested reflection. MQTT TLS/auth and metadata; MCP HTTP/legacy SSE via installed SDK only. Saved protocol configs roundtrip through backup.
- [ ] RED real local gRPC fixture (unary/client/server/bidi streams, metadata,TLS/cancel), MQTT fixture (subscribe/publish/unsubscribe/QoS/retained/close), MCP fixture (list tools/resources/prompts, call/read/get, errors/timeout). File allowlist/no arbitrary proto reads, no connection after import.
- [ ] Verify official library docs; use @grpc/grpc-js + @grpc/proto-loader + reflection client, mqtt and SDK. Expose usable protocol-specific UI (method/topic/tool selection, payload editors, schema/results) with no direct browser target network.
- [ ] Full tests/build and protocol UI checks; commit and report. Do not substitute status-only stubs for actual adapters.

### Task 6: Cookie/response UX, runRequest and final integration

**Files:** Create web/ResponsePreview.tsx, web/CookieManager.tsx, tests/response-preview.spec.ts, tests/run-request.test.mjs; modify UI, worker/service runtime as needed, README and skills/api-client/SKILL.md.
**Interfaces:** Existing response bytes feed bounded isolated previews. App-only cookie reveal/edit tool; model state remains masked. runRequest resolves saved request in current workspace with explicit depth4/call20/run deadline and cancellation, same variable semantics.
- [ ] RED tests Cookie edit/domain filters, JSON/XML/text/image/HTML/PDF/visualizer preview sandbox/no network/no host token, runRequest variable/result/error/recursion/cancel, full cross-protocol backup through public APIs.
- [ ] Implement UX without rewriting main state machine; isolated sandbox previews and fallback downloads when host cannot embed. Update documented capabilities and limits. Existing UI controls stay accessible and responsive.
- [ ] Run plugin npm test, build, check, all configured API Playwright suites; root npm test with isolated dependency setup. Record any baseline blockers separately. Start preview with separate synthetic data directory and provide screenshot/report. Commit, package whole-branch review, address Important/Critical findings and rerun covering/full tests. No release/install.
