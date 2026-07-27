# macOS Safety and Reliability Implementation Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

Implement the approved macOS safety and reliability design in `docs/superpowers/specs/2026-07-26-macos-safety-reliability-design.md` without changing pi-voice's user-facing purpose. The result must have one configured `FnHook`, an acknowledged main-process recording lifecycle, fail-closed target-aware paste, only the supported Gemini/OpenAI/ElevenLabs providers, and ownership-verified daemon startup/shutdown.

### Baseline to preserve in the implementation record

`bun test` was run before this plan and currently reports **105 passing, 16 failing, 121 total**. The failures are pre-existing and include Gemini client expectation drift, sanitizer capitalization expectations, legacy local-provider tests, and several config-message/number-key expectations. This is not a clean baseline; implementation should replace obsolete expectations with design-aligned tests and separately avoid unrelated regressions.

## Architecture

- `src/main.ts` remains the Electron orchestration boundary. It owns the authoritative state machine, captures/revalidates the frontmost target, sends sequence-numbered renderer commands, and funnels all exits through idempotent shutdown/cleanup.
- `src/services/fn-hook.ts` owns exactly one configurable hook backend. Remove the parallel Electron `globalShortcut` registration path; the configured `FnHook` is the sole trigger.
- `src/shared/types.ts` defines lifecycle states, command/ack envelopes, target metadata, and IPC channels. `src/renderer/renderer.ts` acknowledges start/stop commands with the received sequence number and reports failures through the same protocol.
- `src/native/pi-paste.c` and a small testable integration boundary provide least-invasive paste plus target/clipboard safety. Native APIs fail closed; transcript retention is independent of paste success.
- `src/services/config.ts`, `stt.ts`, `tts.ts`, and `whisper-model.ts` expose only cloud providers and contain no local provider/model path. `src/cli.ts` validates config before launch and no longer prepares Whisper models.
- `src/services/daemon-ipc.ts` owns a versioned, schema-validated newline protocol and readiness probe. `src/services/runtime-state.ts` records runtime identity and performs ownership-aware final cleanup; `src/cli.ts` uses those checks before reporting start or signaling stop.

## Tech Stack

- TypeScript, Electron, Bun, `bun:test`, Zod, Unix domain sockets, and macOS ApplicationServices/Accessibility APIs.
- Validation commands: `bun test`, `bunx tsc --noEmit`, and `bun run build`.
- Native and macOS smoke validation uses mocked native boundaries in tests, plus a manual/macOS CI check with no secrets or transcript contents recorded.

---

## TDD Tasks

### 1. Lock the lifecycle and sequence-number contract

**Files:**
- **Create:**
  - `src/services/recording-lifecycle.ts`
  - `src/__tests__/services/recording-lifecycle.test.ts`
- **Modify:**
  - `src/shared/types.ts` (lines 1-30)
  - `src/services/runtime-state.ts` (lines 11-98)
- **Test:**
  - `src/__tests__/services/recording-lifecycle.test.ts`
  - `src/__tests__/shared/types.test.ts` (existing type assertions)

- **Failing test:** Add transition-table tests for `idle → starting → recording → stopping → transcribing → idle`, permitted `error` exits, ignored toggles outside `idle`/`recording`, matching start/stop acknowledgements, stale/duplicate sequence numbers, timeout, renderer failure, and repeated shutdown.
- **Command to prove failure:** `bun test src/__tests__/services/recording-lifecycle.test.ts src/__tests__/shared/types.test.ts`
- **Minimal implementation:** Replace obsolete states/contracts with the approved states and a small pure lifecycle coordinator. Allocate monotonically increasing command sequence IDs, commit state only after the matching ack, retain completed transcripts on paste/error, and expose a guarded cleanup transition.
- **Passing test:** `bun test src/__tests__/services/recording-lifecycle.test.ts src/__tests__/shared/types.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/shared/types.ts src/services/recording-lifecycle.ts src/__tests__/services/recording-lifecycle.test.ts src/__tests__/shared/types.test.ts && git commit -m "Add acknowledged recording lifecycle"`

### 2. Make `FnHook` the only shortcut backend and wire acknowledgements

**Files:**
- **Create:**
  - `src/__tests__/integration/recording-ipc.test.ts`
- **Modify:**
  - `src/services/fn-hook.ts` (lines 39-109)
  - `src/main.ts` (lines 1, 31-40, 258-298, 322-328, 341-370)
  - `src/renderer/renderer.ts` (lines 89-111)
  - `src/preload.ts`
- **Test:**
  - `src/__tests__/services/fn-hook.test.ts` (lines 81-265)
  - `src/__tests__/integration/recording-ipc.test.ts`

- **Failing test:** Assert one configured backend registration, idempotent start/stop, no `globalShortcut.register`/`unregisterAll` path, start/stop sequence IDs, illegal-toggle debug logging, acknowledgement gating, timeout/error reset, and cleanup after `SIGTERM`, `before-quit`, partial startup, or renderer loss.
- **Command to prove failure:** `bun test src/__tests__/services/fn-hook.test.ts src/__tests__/services/recording-lifecycle.test.ts`
- **Minimal implementation:** Keep registration ownership inside `FnHook`, remove duplicate Electron shortcut registration, route Fn/UI requests through the lifecycle coordinator, send command envelopes from main, and have preload/renderer return the exact sequence ID with success/failure. Make shutdown idempotent and stop the hook once.
- **Passing test:** `bun test src/__tests__/services/fn-hook.test.ts src/__tests__/services/recording-lifecycle.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/services/fn-hook.ts src/main.ts src/renderer/renderer.ts src/preload.ts src/__tests__/services/fn-hook.test.ts src/__tests__/services/recording-lifecycle.test.ts && git commit -m "Enforce single acknowledged recording trigger"`

### 3. Add target capture, sensitivity denial, and non-destructive clipboard paste

**Files:**
- **Create:**
  - `src/services/mac-target.ts`
  - `src/services/paste-safety.ts`
  - `src/__tests__/services/paste-safety.test.ts`
  - `src/__tests__/integration/paste-native-boundary.test.ts`
- **Modify:**
  - `src/main.ts` (lines 62-177, 204-244)
  - `src/native/pi-paste.c` (lines 1-32)
- **Test:**
  - `src/__tests__/services/paste-safety.test.ts`
  - `src/__tests__/integration/paste-native-boundary.test.ts`

- **Failing test:** Cover atomic capture of bundle ID/PID/display name at `starting`, immediate revalidation before paste, mismatch denial with transcript retained and visible no-paste reason, password manager/keychain/security/privileged/private classification denial, clipboard data plus metadata save/restore success and best-effort failure, least-invasive paste, and absence of `Cmd+A`, Backspace, destructive clear, or undo-dependent behavior.
- **Command to prove failure:** `bun test src/__tests__/services/paste-safety.test.ts`
- **Minimal implementation:** Introduce injectable macOS target and clipboard/native adapters; fail closed on unavailable identity or sensitive classification; preserve transcript and user-safe status; remove `executeUndoCommand`, voice undo, fix-last destructive clearing, undo chime, and related documentation. Keep logs free of transcript/clipboard content.
- **Passing test:** `bun test src/__tests__/services/paste-safety.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/main.ts src/native/pi-paste.c src/services/mac-target.ts src/services/paste-safety.ts src/__tests__/services/paste-safety.test.ts && git commit -m "Make macOS paste target-safe and non-destructive"`

### 4. Remove only the local provider/model flow

**Files:**
- **Create:** None.
- **Modify:**
  - `src/services/config.ts` (lines 17, 194-280)
  - `src/shared/types.ts` (lines 10-15)
  - `src/services/stt.ts` (lines 327-353)
  - `src/services/tts.ts` (lines 198-268)
  - `src/services/whisper-model.ts` (lines 1-144)
  - `src/services/gemini-client.ts`
  - `src/cli.ts` (lines 17-18, 189-209)
- **Test:**
  - `src/__tests__/services/config.test.ts` (lines 160-230)
  - `src/__tests__/services/stt.test.ts` (lines 100-180)
  - `src/__tests__/services/tts.test.ts` (lines 125-175)
  - `src/__tests__/services/whisper-model.test.ts`
  - `src/__tests__/shared/types.test.ts`

- **Failing test:** Assert Gemini/OpenAI/ElevenLabs are accepted and selectable; `local` is rejected with a specific migration message; unknown/missing malformed values receive distinct validation errors; no local model resolution/download or cloud fallback occurs; cloud STT/TTS behavior remains covered. Update obsolete baseline tests rather than preserving local behavior.
- **Command to prove failure:** `bun test src/__tests__/services/config.test.ts src/__tests__/services/stt.test.ts src/__tests__/services/tts.test.ts src/__tests__/services/whisper-model.test.ts src/__tests__/shared/types.test.ts`
- **Minimal implementation:** Narrow `SpeechProvider` and Zod enum, detect raw legacy `local` before generic enum failure, remove local STT/TTS/model imports and branches, default cloud behavior to Gemini, and delete the CLI Whisper preflight. Do not remove or rename Gemini/OpenAI/ElevenLabs paths.
- **Passing test:** `bun test src/__tests__/services/config.test.ts src/__tests__/services/stt.test.ts src/__tests__/services/tts.test.ts src/__tests__/services/whisper-model.test.ts src/__tests__/shared/types.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/services/config.ts src/shared/types.ts src/services/stt.ts src/services/tts.ts src/services/whisper-model.ts src/services/gemini-client.ts src/cli.ts src/__tests__ && git commit -m "Remove unsupported local provider flow"`

### 5. Validate daemon envelopes and readiness

**Files:**
- **Create:**
  - `src/__tests__/services/daemon-protocol.test.ts`
- **Modify:**
  - `src/services/daemon-ipc.ts` (lines 7-147)
  - `src/main.ts` (lines 300-320, 360-363)
  - `src/cli.ts` (lines 147-242)
- **Test:**
  - `src/__tests__/services/daemon-ipc.test.ts` (lines 1-180)
  - `src/__tests__/services/daemon-protocol.test.ts`

- **Failing test:** Cover versioned `{ ok, requestId, code, message, data }` envelopes, request ID/type validation, malformed JSON, missing/wrong fields, wrong protocol version, structured errors, framing, and a readiness probe that cannot succeed from a socket-only existence check.
- **Command to prove failure:** `bun test src/__tests__/services/daemon-ipc.test.ts`
- **Minimal implementation:** Add Zod schemas and protocol constants, validate every request/response, return stable error codes/messages, expose `waitForReady`/status hello, ensure server listen readiness is observable, and make CLI start poll and validate the response before printing success.
- **Passing test:** `bun test src/__tests__/services/daemon-ipc.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/services/daemon-ipc.ts src/main.ts src/cli.ts src/__tests__/services/daemon-ipc.test.ts && git commit -m "Require validated daemon readiness"`

### 6. Verify PID ownership and last-step cleanup

**Files:**
- **Create:**
  - `src/__tests__/services/daemon-ownership.test.ts`
- **Modify:**
  - `src/services/runtime-state.ts` (lines 11-98)
  - `src/services/daemon-ipc.ts` (server stop lines 85-102)
  - `src/main.ts` (lines 322-370)
  - `src/cli.ts` (lines 62-65, 147-175)
- **Test:**
  - `src/__tests__/services/runtime-state.test.ts` (lines 41-133)
  - `src/__tests__/services/daemon-ownership.test.ts`

- **Failing test:** Cover runtime metadata with process identity/start token, PID reuse or unrelated-process mismatch, “not owned” refusal without signaling, graceful stop verification, stale socket/PID handling, partial startup, repeated shutdown, and deletion ordering where socket/PID files are removed only last after ownership and stopped-state checks.
- **Command to prove failure:** `bun test src/__tests__/services/runtime-state.test.ts src/__tests__/services/daemon-ipc.test.ts`
- **Minimal implementation:** Extend runtime metadata and injectable process probes, validate owner identity before `SIGTERM`, separate stale cleanup from owned cleanup, wait for verified stopped state, and funnel Electron/CLI cleanup through one re-entry-safe path.
- **Passing test:** `bun test src/__tests__/services/runtime-state.test.ts src/__tests__/services/daemon-ipc.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/services/runtime-state.ts src/services/daemon-ipc.ts src/main.ts src/cli.ts src/__tests__/services/runtime-state.test.ts src/__tests__/services/daemon-ipc.test.ts && git commit -m "Harden daemon ownership and cleanup"`

### 7. Add end-to-end mocked smoke coverage

**Files:**
- **Create:**
  - `src/__tests__/integration/macos-safety-smoke.test.ts`
  - `src/__tests__/integration/daemon-smoke.test.ts`
- **Modify:** None.
- **Test:**
  - `src/__tests__/integration/macos-safety-smoke.test.ts`
  - `src/__tests__/integration/daemon-smoke.test.ts`

- **Failing test:** Exercise mocked start → acknowledged record → acknowledged stop → transcription → matching safe target → clipboard-preserving paste, and daemon spawn/readiness/status/stop/verified cleanup. Include mismatch and sensitive-target no-paste paths.
- **Command to prove failure:** `bun test src/__tests__/integration/macos-safety-smoke.test.ts src/__tests__/integration/daemon-smoke.test.ts`
- **Minimal implementation:** Add only test seams needed to compose existing coordinators; do not introduce production integration frameworks or unrelated cancellation/telemetry work.
- **Passing test:** `bun test src/__tests__/integration/macos-safety-smoke.test.ts src/__tests__/integration/daemon-smoke.test.ts`
- **Optional commit (NOT TO RUN unless the user asks):** `git add src/__tests__/integration && git commit -m "Add macOS and daemon smoke coverage"`

### 8. Update documentation and release gates

**Files:**
- **Create:**
  - `src/__tests__/documentation/release-gates.test.ts`
- **Modify:**
  - `README.md` (lines 33-41, 48-74, 79-95, 110-131)
  - `CONTRIBUTING.md`
  - `.github/workflows/publish-release.yml`
  - `.github/workflows/draft-release.yml`
- **Test:**
  - `src/__tests__/documentation/release-gates.test.ts`

- **Failing test/check:** Add a documentation/release assertion or review script that fails on shipped `local` provider/model references, duplicate shortcut claims, destructive undo instructions, or missing Gemini/OpenAI/ElevenLabs migration guidance.
- **Command to prove failure:** `bun test` (the focused documentation assertion) and `bunx tsc --noEmit` if the assertion is TypeScript-based.
- **Minimal implementation:** Document one configurable FnHook, acknowledgement and fail-closed paste behavior, supported cloud providers, explicit legacy-local migration, accessibility and daemon ownership diagnostics, and release checks. Replace the README's `npm link` command with a Bun command and ensure workflows run Bun-native test/typecheck/build gates.
- **Passing test:** `bun test && bunx tsc --noEmit && bun run build`
- **Optional commit (NOT TO RUN unless the user asks):** `git add README.md CONTRIBUTING.md .github/workflows && git commit -m "Document safety and release gates"`

### 9. Final validation and macOS release smoke checks

**Files:**
- **Create:** None.
- **Modify:**
  - `src/services/recording-lifecycle.ts`
  - `src/shared/types.ts`
  - `src/services/runtime-state.ts`
  - `src/services/fn-hook.ts`
  - `src/main.ts`
  - `src/renderer/renderer.ts`
  - `src/preload.ts`
  - `src/services/mac-target.ts`
  - `src/services/paste-safety.ts`
  - `src/native/pi-paste.c`
  - `src/services/config.ts`
  - `src/services/stt.ts`
  - `src/services/tts.ts`
  - `src/services/whisper-model.ts`
  - `src/services/gemini-client.ts`
  - `src/cli.ts`
  - `src/services/daemon-ipc.ts`
  - `README.md`
  - `CONTRIBUTING.md`
  - `.github/workflows/publish-release.yml`
  - `.github/workflows/draft-release.yml`
- **Test:**
  - `src/__tests__/services/recording-lifecycle.test.ts`
  - `src/__tests__/shared/types.test.ts`
  - `src/__tests__/services/fn-hook.test.ts`
  - `src/__tests__/integration/recording-ipc.test.ts`
  - `src/__tests__/services/paste-safety.test.ts`
  - `src/__tests__/integration/paste-native-boundary.test.ts`
  - `src/__tests__/services/config.test.ts`
  - `src/__tests__/services/stt.test.ts`
  - `src/__tests__/services/tts.test.ts`
  - `src/__tests__/services/whisper-model.test.ts`
  - `src/__tests__/services/daemon-ipc.test.ts`
  - `src/__tests__/services/daemon-protocol.test.ts`
  - `src/__tests__/services/runtime-state.test.ts`
  - `src/__tests__/services/daemon-ownership.test.ts`
  - `src/__tests__/integration/macos-safety-smoke.test.ts`
  - `src/__tests__/integration/daemon-smoke.test.ts`
  - `src/__tests__/documentation/release-gates.test.ts`
  - `out/main/index.js`
  - `out/cli/cli.js`

- **Failing test/check:** Run the complete gates and inspect generated Electron/CLI artifacts for duplicate shortcut registration, local-provider code, unsupported model paths, transcript/API-key/clipboard logging, and stale documentation. On macOS CI or a manual release machine, test accessibility permission denial, safe target capture/revalidation, sensitive target denial, unrelated PID refusal, and legacy local-config upgrade.
- **Command to prove failure:** `bun test; bunx tsc --noEmit; bun run build` (record each exit status; do not mask an earlier failure).
- **Minimal implementation:** Fix only issues exposed by the approved acceptance criteria and assumptions below; regenerate build output through the build command, never by hand.
- **Passing test:** `bun test && bunx tsc --noEmit && bun run build`
- **Optional commit (NOT TO RUN unless the user asks):** `git add <reviewed-intended-files> && git commit -m "Harden macOS safety and reliability"`

## Assumptions requiring validation during implementation

- `uiohook-napi` remains the configured global FnHook backend on supported macOS versions; no second Electron shortcut is needed for fallback.
- The project can obtain stable bundle ID/PID/display-name data through an injectable macOS boundary and can classify sensitive applications conservatively without logging target contents.
- Clipboard metadata restoration is best effort under macOS ownership/timing rules; inability to restore must never cause a destructive clear or lose the transcript.
- Runtime metadata can provide sufficient process identity to reject PID reuse; ambiguous identity always fails closed.
- Existing renderer/preload IPC is the only required recording control surface; no broad cancellation redesign, offline STT, code signing, notarization, login item, or telemetry work is included.
- The current 16 failing baseline tests are stale or unrelated where noted; any failure outside the listed scope must be investigated rather than suppressed.
