# Broad Paste Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make normal macOS application/window targets broadly paste-eligible while retaining one lightweight target recheck, fail-closed native injection, clipboard restoration, and existing lifecycle semantics.

**Architecture:** `SafePasteService` will capture one app/PID/window identity at recording start, then perform one matching conditional native recheck immediately before clipboard mutation and Command-V. The native helper will exchange only bounded, validated window-target fields and injection status; `PasteCoordinator` and renderer lifecycle behavior remain authoritative, with recording sequence validity carried through orchestration and paste stages, and privacy-preserving stage diagnostics added around the existing flow.

**Tech Stack:** TypeScript, Bun tests/scripts, Objective-C/AppKit/ApplicationServices native helper, Electron clipboard, Pino logger, macOS arm64 build and packaging smoke tests.

---

## Task 1: Replace focused-target protocol with a lightweight window target

**Files:**

- `src/native/pi-paste.c`
- `src/services/safe-paste.ts`
- `src/__tests__/services/safe-paste.test.ts`

### Test-first steps

1. In `src/__tests__/services/safe-paste.test.ts`, change the fixture target to contain only `bundleId`, `appName`, `pid`, and `windowTitle`; add parsing/equality cases for exact valid targets, case normalization where currently intended, missing fields, invalid/non-positive PIDs, tabs/newlines, and ambiguous extra fields.
2. Add tests proving Terminal, Telegram, Myanso, and an ordinary editor fixture are eligible regardless of focused field, role, subrole, or secure-looking fixture metadata. Remove tests whose expected behavior is denylisting, secure-field blocking, or same-window focused-element switching; replace them with app/PID/window mismatch tests.
3. Add tests asserting stable internal outcomes/messages for `target-unavailable`, malformed target output, and app/PID/window mismatch, and asserting that malformed native output does not reach clipboard or injection.
4. Run the focused suite and confirm the new tests fail against the current seven-field protocol and policy gates:

   ```sh
   bun test src/__tests__/services/safe-paste.test.ts
   ```

   Expected outcome: the new protocol and broad-eligibility assertions fail before implementation, while unrelated existing clipboard tests identify any accidental fixture breakage.

### Implementation steps

1. Define a minimal `TargetIdentity` with only bundle ID, app name, positive PID, and window title; implement strict parsing that requires exactly the documented fields, rejects empty/ambiguous values and unsafe delimiters, and maps unavailable/timeout/malformed helper results to stable reason codes and concise user-facing messages.
2. Remove `SENSITIVE_BUNDLE_IDS`, `SENSITIVE_APP_NAMES`, `SENSITIVE_ROLES`, `isSensitiveTarget`, and all focused-element/role/subrole comparisons. `sameTarget` must compare only normalized app identity, PID, and window identity/title.
3. Change `createMacSafePasteService` to invoke `--target` once for capture and `--conditional-paste` with only the lightweight fields. Use bounded helper timeouts for capture and conditional paste; distinguish timeout, unavailable, mismatch, blocked/rejected injection, and malformed protocol failures without treating any failure as success.
4. In `src/native/pi-paste.c`, remove all focused UI element and strict AX discovery. Capture the frontmost app identity, PID, and window identity/title only; validate argument count and fields, return stable machine-readable status/reason output, perform one current-target comparison, and report `CGEvent` creation/posting failure rather than returning success. Keep native operations bounded and avoid logging or emitting transcript data.
5. Run the focused tests again:

   ```sh
   bun test src/__tests__/services/safe-paste.test.ts
   ```

   Expected outcome: target parsing, broad eligibility, mismatch, unavailable, timeout, and blocked-injection tests pass; clipboard tests remain green.

### Commit checkpoint

```sh
git add src/native/pi-paste.c src/services/safe-paste.ts src/__tests__/services/safe-paste.test.ts && git commit -m "Broaden paste target compatibility"
```

**DO NOT RUN unless the user asks.**

## Task 2: Preserve and test clipboard ordering and restoration on every path

**Files:**

- `src/services/safe-paste.ts`
- `src/__tests__/services/safe-paste.test.ts`

### Test-first steps

1. Add order-recording clipboard fixtures covering snapshot, transcript write, injection, and restore. Assert that target recheck completes before snapshot, and that restore follows both successful and failed injection.
2. Add failures for snapshot, write, injection rejection, injection timeout, and restore; assert the transcript is retained, no failure is reported as pasted, and restore is attempted whenever a snapshot exists. Preserve the existing custom-format, empty clipboard, standard representations, and additive custom-buffer assertions.
3. Add diagnostic assertions that stage records contain operation ID, monotonic duration, outcome, timeout status, and reason code but never transcript text, clipboard contents, or protected field values.
4. Run:

   ```sh
   bun test src/__tests__/services/safe-paste.test.ts
   ```

   Expected outcome: the new ordering/failure/diagnostic tests fail until the service is instrumented and its error paths are made explicit.

### Implementation steps

1. Keep the existing clipboard port abstraction and exact snapshot/restore behavior; move all clipboard work after the successful native conditional recheck.
2. Ensure snapshot, write, injection, and restore each have explicit failure handling and stable reason mapping. Always attempt restore after a snapshot and expose restore failure in the result/diagnostics without replacing the original failure reason.
3. Add a small injectable diagnostic sink/clock or equivalent test seam. Emit only structured stage metadata for `target_capture`, `target_recheck`, `clipboard_snapshot`, `clipboard_write`, `injection`, `clipboard_restore`, and total duration, with target mode `window` and correlation/operation ID.
4. Use bounded asynchronous helper execution and ensure a timed-out child cannot later cause a successful result. Do not log transcript text or clipboard payloads.
5. Run the focused service test:

   ```sh
   bun test src/__tests__/services/safe-paste.test.ts
   ```

   Expected outcome: all clipboard ordering, restoration, custom-format, failure-reason, and privacy assertions pass.

### Commit checkpoint

```sh
git add src/services/safe-paste.ts src/__tests__/services/safe-paste.test.ts && git commit -m "Harden clipboard paste failure handling"
```

**DO NOT RUN unless the user asks.**

## Task 3: Add privacy-safe paste diagnostics without changing lifecycle behavior

**Files:**

- `src/services/paste-flow.ts` (only if reason/diagnostic propagation requires it)
- `src/main.ts` (only if existing logging/state reporting must connect the diagnostic sink)
- `src/__tests__/services/paste-flow.test.ts`
- `src/__tests__/services/macos-safety-integration-smoke.test.ts`

### Test-first steps

1. Extend `paste-flow.test.ts` with pending, duplicate, generation invalidation, stale completion, and late injection cases that assert existing mutex, duplicate window, generation, and `pending`/transcript-retention semantics are unchanged while structured failure reasons propagate.
2. Extend the integration smoke fixture to cover app change, PID change, window change, target disappearance, native injection rejection, and every timeout as retained-transcript failures. Assert an ordinary secure-looking field fixture is still eligible when app/PID/window identity matches.
3. Assert diagnostics include all required stage names, durations, total duration, outcome, reason code, timeout status, operation ID, and `target_mode: "window"`; assert serialized diagnostics do not contain test transcript or clipboard values.
4. Run:

   ```sh
   bun test src/__tests__/services/paste-flow.test.ts src/__tests__/services/macos-safety-integration-smoke.test.ts
   ```

   Expected outcome: new diagnostics and broad-compatibility assertions fail initially, while the pre-existing lifecycle and stale-result assertions define the behavior that must remain green.

### Implementation steps

1. Keep `PasteCoordinator`’s mutex, duplicate suppression, generation invalidation, stale-result handling, and pending-paste semantics intact. Carry the recording sequence and current-transcription predicate through the coordinator and service barriers; commit dedupe state only after successful submission. Only pass through the exact `SafePasteService` reason and diagnostic outcome needed by existing state reporting.
2. Connect diagnostics to the existing logger only at the service boundary if needed. Log structured stage completion/failure, timeout, mode, duration, operation ID, total duration, outcome, and reason code; never include `text`, clipboard data, or protected field values.
3. Keep `src/main.ts` unchanged unless a minimal logger/state hook is required; preserve current renderer shutdown invalidation and failure UI transcript-retention behavior while rechecking lifecycle validity after asynchronous app lookup and before coordinator submission.
4. Run the focused flow and integration tests:

   ```sh
   bun test src/__tests__/services/paste-flow.test.ts src/__tests__/services/macos-safety-integration-smoke.test.ts
   ```

   Expected outcome: lifecycle, pending, stale, duplicate, exact failure-message, and privacy diagnostics tests pass.

### Commit checkpoint

```sh
git add src/services/paste-flow.ts src/main.ts src/__tests__/services/paste-flow.test.ts src/__tests__/services/macos-safety-integration-smoke.test.ts && git commit -m "Add paste stage diagnostics"
```

**DO NOT RUN unless the user asks.**

## Task 4: Validate native rebuild, baseline-aware checks, focused suites, and package smoke

**Files:**

- `scripts/build-native-paste.ts` (inspect and change only if strictly required to compile or ship the helper; otherwise leave unchanged)
- `package.json` (do not change unless a required build/package command is missing)
- `src/__tests__/services/native-paste-path.test.ts`
- `src/__tests__/services/safe-paste.test.ts`
- `src/__tests__/services/paste-flow.test.ts`
- `src/__tests__/services/macos-safety-integration-smoke.test.ts`

### Test-first and validation steps

1. If native protocol coverage needs a fixture or helper harness, add it to the existing focused tests without modifying generated `out/`; test malformed arguments, unavailable target, changed app/PID/window, bounded capture/recheck, blocked injection, and successful injection status.
2. Run the focused test script exactly as currently defined:

   ```sh
   bun run test:focused
   ```

   Expected outcome: all focused service, lifecycle, native-path, and integration tests pass.
3. Run the blocking baseline-aware verification:

   ```sh
   bun run check:known-baseline
   ```

   Expected outcome: the approved existing baseline diagnostics are accepted and the check passes without new regressions. This is the required blocking verification for the known full-suite/typecheck baseline.
4. Run type validation diagnostically:

   ```sh
   bun run typecheck
   ```

   Expected outcome: known baseline failures may remain and must be recorded for diagnosis; do not require zero errors and do not treat this command alone as a new-regression gate.
5. Rebuild and self-check the arm64 helper:

   ```sh
   bun run native:smoke
   ```

   Expected outcome: Apple clang builds `bin/pi-paste` from `src/native/pi-paste.c`, verifies arm64, and the helper self-check succeeds. Do not edit generated `out/` artifacts.
6. Run the macOS package/build smoke command with permissions configured:

   ```sh
   bun run package:mac:smoke
   ```

   Expected outcome: arm64 directory packaging includes the rebuilt native helper and the macOS smoke test completes; macOS event-injection permission failures must be reported as failures, never success.
7. Inspect the final diff for scope and privacy, then run:

   ```sh
   git diff --check
   ```

   Expected outcome: no whitespace errors. Confirm the blocking `check:known-baseline` passed with no new regressions, only the planned source/tests/optional build-source changes exist, no `out/` changes are included, and no diagnostic contains transcript or clipboard content.

### Commit checkpoint

```sh
git add scripts/build-native-paste.ts package.json src/__tests__/services/native-paste-path.test.ts && git commit -m "Validate broad paste packaging"
```

**DO NOT RUN unless the user asks.**

## Final self-review checklist

- Exactly one lightweight app/PID/window capture occurs at recording start, with one matching conditional recheck immediately before Command-V.
- No focused-element AX discovery, secure-field gate, sensitive-app/security/password-manager denylist, or fallback focused-element query remains in the paste path.
- Unknown target, mismatch, helper timeout, blocked/rejected injection, and clipboard failures fail closed, retain the transcript, and surface stable exact reasons.
- Clipboard snapshot/write/injection/restore ordering and exact restoration semantics remain intact, including custom formats and restore observability.
- `PasteCoordinator` mutex, duplicate, generation, stale-result, pending-paste, and renderer-shutdown semantics remain authoritative.
- Diagnostics are structured, correlated, monotonic, bounded-aware, and privacy-preserving: no transcript text, clipboard contents, or protected field values.
- `src/main.ts`, `scripts/build-native-paste.ts`, `package.json`, and `README.md` are changed only when strictly required; generated `out/` is not modified.
- `bun run check:known-baseline` passes with the existing approved baseline and no new regressions; `bun run typecheck` is diagnostic only because known baseline failures are expected.
- `git diff --check` passes and the plan’s validation commands have documented outcomes.
