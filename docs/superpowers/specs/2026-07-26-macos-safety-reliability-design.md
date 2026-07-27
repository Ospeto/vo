# macOS Safety and Reliability Patch

**Date:** 2026-07-26  
**Status:** Approved design

## Scope

This patch hardens the macOS recording, transcription, paste, provider, and daemon-control paths without changing the product's user-facing purpose. It covers one global Fn hook, an acknowledged recording state machine, target-aware paste protection, removal of the unsupported local provider while preserving the supported cloud providers (Gemini, OpenAI, and ElevenLabs), and authenticated-by-ownership daemon lifecycle handling.

## Decisions

1. **One FnHook backend.** `FnHook` has one configurable backend and one owner. Electron registers the backend once during startup; no other Electron path may call `globalShortcut.register` for the same key. Registration and teardown are idempotent, and configuration selects the backend rather than creating parallel registrations.
2. **Main-process state is authoritative.** The lifecycle is `idle → starting → recording → stopping → transcribing → idle`, with an `error` exit available from every active phase. Renderer actions are requests; the main process changes state only after the renderer acknowledges the corresponding start/stop command. Toggle requests are accepted only in `idle` or `recording`; all other toggles are ignored and logged at debug level.
3. **Paste is target-bound.** Capture the frontmost application's stable identity (bundle identifier, process identifier, and display name when available) when recording enters `starting`. Revalidate it immediately before paste. Deny sensitive target classes, including password managers, keychain/security prompts, privileged/system authentication surfaces, and explicitly classified secure or private applications. A mismatch produces a visible transcript/no-paste result, never an automatic paste.
4. **Clipboard is non-destructive.** Save clipboard contents and metadata before paste, use the least invasive paste operation, and restore the saved clipboard when feasible after the operation. Remove the destructive `Cmd+A`/Backspace clearing and its undo-dependent behavior entirely.
5. **Cloud providers remain available; local is removed.** Preserve the supported cloud providers—Gemini, OpenAI, and ElevenLabs—in configuration, types, CLI preflight, transcription, text-to-speech, documentation, and tests. Remove the unsupported `local` provider and its model/download paths. A legacy config containing `local` is rejected with a specific migration error; it must not silently fall back to any cloud provider.
6. **Daemon control is verified.** CLI start waits for a readiness probe that validates the expected socket protocol before reporting success. CLI stop validates PID ownership using the process identity and expected runtime metadata before signaling. Socket payloads are schema-validated and return structured error codes/messages. Runtime files are cleaned up only after shutdown and socket/PID ownership checks complete.

## State and data flows

### Recording flow

```text
Fn hook / UI toggle
  → main validates current state
  → idle: capture frontmost target; state=starting; command renderer to start
  → renderer acknowledges start
  → state=recording; begin capture
  → recording toggle: state=stopping; command renderer to stop
  → renderer acknowledges stop; state=transcribing
  → STT result
  → revalidate target and sensitivity
  → matching safe target: paste with clipboard preservation when feasible
  → mismatch/denied target: retain transcript, skip paste, surface reason
  → state=idle
```

Renderer acknowledgement must include the command sequence identifier. A stale or duplicate acknowledgement is ignored. Renderer failure, timeout, capture failure, STT failure, and paste denial transition to `error` with a user-safe message and then reset to `idle` after cleanup; the transcript is retained whenever transcription completed.

### Provider flow

Load and validate configuration before starting the app or daemon. The accepted provider union contains `gemini`, `openai`, and `elevenlabs`; all three cloud providers remain selectable. If the parsed raw value is `local`, return an error that names the removed provider and points to the documented cloud-provider migration. Do not substitute a default provider after this error. Malformed or unknown values receive a separate validation error.

### Daemon flow

```text
CLI start → spawn candidate → poll socket readiness → validate hello/status payload → success
CLI stop  → read runtime metadata → verify PID belongs to expected daemon → request graceful stop
          → verify stopped → remove socket/PID/runtime files last
```

Readiness and control responses use a versioned envelope such as `{ ok, requestId, code, message, data }`. Unknown fields may be ignored, but missing or wrongly typed required fields, wrong protocol versions, invalid request IDs, and malformed JSON are structured protocol errors and never count as readiness.

## Error handling and safety invariants

- Never paste into a target that was not captured at start, no longer matches at paste time, or is sensitive.
- Never transition to `recording` or `stopping` without the matching renderer acknowledgement.
- Never register the Fn shortcut twice, and never report daemon start before a valid readiness response.
- Never signal a PID that fails ownership validation; report “not owned” rather than attempting a kill.
- Shutdown is idempotent: repeated calls, partial startup, hook failure, renderer loss, and already-removed runtime files all converge on one cleanup path. Cleanup is guarded against re-entry and runs runtime-file deletion last.
- Errors are structured for IPC/CLI consumers and concise/actionable for users; no transcript, API key, or clipboard content is written to logs.

## Files expected to change

Implementation is expected in the following existing files, plus focused tests alongside them:

- `src/services/fn-hook.ts`, `src/main.ts`, and `src/renderer/renderer.ts`: single backend, registration ownership, lifecycle commands, acknowledgements, and idempotent shutdown.
- `src/services/runtime-state.ts`, `src/services/daemon-ipc.ts`, and `src/cli.ts`: state transitions, target metadata, readiness/ownership checks, validated envelopes, structured errors, and last-step cleanup.
- `src/services/config.ts`, `src/shared/types.ts`, `src/services/stt.ts`, `src/services/tts.ts`, and `src/services/whisper-model.ts`: preserve Gemini/OpenAI/ElevenLabs cloud-provider handling while removing local-provider and local-model paths.
- `src/native/pi-paste.c` and its integration boundary: safe target/clipboard behavior without destructive selection/deletion.
- `README.md` and provider/model-related documentation: document Gemini, OpenAI, and ElevenLabs as supported cloud providers, remove local setup/download instructions, and add explicit legacy-config migration.
- `src/__tests__/services/{fn-hook,runtime-state,daemon-ipc,config,stt,tts,whisper-model}.test.ts`, `src/__tests__/shared/types.test.ts`, and new focused tests where needed: regression coverage for each invariant.

No generated output under `out/` is edited manually. Build output is regenerated only by the build process.

## Test strategy

- Unit-test the lifecycle transition table, illegal-toggle handling, sequence-numbered acknowledgement handling, timeout/error paths, and repeated shutdown.
- Unit-test FnHook registration/teardown with mocked backends and assert exactly one registration.
- Unit-test frontmost-target capture, revalidation, sensitive-class denial, mismatch transcript retention, clipboard restoration success/failure, and absence of Cmd+A/Backspace behavior.
- Unit-test provider parsing for Gemini, OpenAI, and ElevenLabs as accepted cloud providers, plus removed `local`, unknown values, missing values, and legacy migration messages; assert no local model download or fallback is invoked and no cloud-provider substitution occurs for legacy local config.
- Unit-test malformed/version-mismatched socket payloads, structured errors, readiness polling, PID mismatch/ownership failure, graceful stop, and cleanup ordering.
- Add an integration smoke test with mocked native boundaries for start → record → transcribe → safe paste and for daemon start/stop. On macOS CI or a manual release machine, run a real accessibility-permission and sensitive-target smoke check without recording secrets.

## Build, typecheck, and release gates

Before merge: `bun test`, `bun run build`, and a strict TypeScript check using the repository's `tsconfig.json` (for example `bunx tsc --noEmit` when TypeScript is available). Confirm the generated Electron and CLI artifacts preserve Gemini, OpenAI, and ElevenLabs support and contain no local-provider code or unsupported model path. Confirm documentation and migration errors match the shipped provider behavior.

Before release: repeat all checks on the supported macOS versions, verify Fn-hook permission failure is actionable, verify daemon readiness and PID ownership against an unrelated process, exercise upgrade from a legacy local config, and inspect the packaged app/CLI for duplicate shortcut registration and accidental secrets or transcript logging. A release is blocked by any lifecycle invariant failure, unsafe paste possibility, unowned-process signal, malformed-protocol acceptance, failed typecheck/build/test, or stale local-provider reference in shipped documentation.

## Acceptance criteria

1. Exactly one configurable FnHook backend exists and duplicate Electron global-shortcut registration is impossible under normal startup, reload, and shutdown paths.
2. The documented lifecycle and renderer acknowledgements are enforced; toggles outside `idle`/`recording` cannot start or stop work; shutdown can be called repeatedly without throwing or leaking runtime files.
3. Paste occurs only when the target identity remains unchanged and is not sensitive. Mismatch and denial preserve the transcript and visibly explain that no paste occurred; clipboard contents are preserved when the platform permits.
4. Gemini, OpenAI, and ElevenLabs remain accepted and selectable cloud providers. `local` is absent from accepted types/configuration, preflight, downloads, docs, and tests, and legacy local configuration fails clearly without fallback to any cloud provider.
5. CLI start proves daemon readiness; CLI stop proves PID ownership; malformed socket data is rejected with structured errors; cleanup occurs last.
6. All required tests, typecheck, build, macOS smoke checks, and release inspections pass.

## Risks and mitigations

- macOS accessibility and frontmost-app APIs can be unavailable or race with focus changes. Fail closed, capture identity atomically where possible, revalidate immediately before paste, and provide permission guidance.
- Clipboard restoration can be limited by platform timing or ownership. Treat restoration as best effort, never overwrite the transcript, and report only a non-sensitive status.
- Renderer crashes or delayed acknowledgements can strand a capture. Use bounded acknowledgements, abort capture on timeout, and funnel every path through idempotent cleanup.
- PID reuse can make a numeric PID unsafe. Require runtime metadata and process identity validation, and refuse ambiguous ownership.
- Removing local STT/TTS may invalidate existing setups. Make the migration error explicit, document all supported cloud providers, and do not provide a compatibility fallback for legacy local configuration.

## Explicit non-goals

The following are deferred and are not part of this patch: code signing or notarization, login-item installation, a full telemetry redesign, a full cancellation redesign, and offline speech-to-text. Reducing, renaming, or otherwise changing the supported cloud providers is also out of scope.
