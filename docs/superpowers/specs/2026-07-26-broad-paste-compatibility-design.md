# Broad Paste Compatibility Design

**Date:** 2026-07-26
**Status:** Approved design

## Goal and behavior

Optimize Pi Voice for fast, reliable broad paste in normal macOS applications,
including Terminal, Telegram, and Myanso. Every normal field in the captured
application/window is eligible. This intentionally removes focused-element
checks, secure-field blocks, and app/security/password-manager denylist blocks
because the user explicitly chose compatibility over protected-target
restrictions.

Pi Voice performs exactly one lightweight native target capture at recording
start. The target contains the frontmost app identity, PID, and window
identity (including the window title as needed by the native protocol). It
performs one matching conditional recheck immediately before Command-V. No
focused AX element discovery or strict AX mode is used at capture or recheck.

The recheck rejects only when the app/PID/window target is unavailable or does
not match, or when native event injection fails or times out. Pi Voice must not
claim literal success in applications where macOS blocks event injection.
Those failures fail closed, retain the transcript, and surface the exact
reason. Clipboard operation failures are also handled safely and retain the
transcript; they are not target-policy restrictions.

## Architecture and data flow

1. At recording start, `SafePasteService` invokes the native helper once to
   capture the lightweight frontmost app/PID/window target. The helper must
   return a complete, unambiguous target or `target-unavailable`; it must not
   query or discover a focused AX element.
2. The service stores that target for the active recording/paste lifecycle.
   There is no denylist or secure-field policy, so any normal field in that
   captured app/window is eligible.
3. After transcription, `PasteCoordinator` preserves its existing duplicate,
   mutex, generation invalidation, stale-result, and pending-paste semantics.
4. Immediately before injection, the native helper performs the matching
   conditional app/PID/window recheck. A missing or changed app, PID, or
   window returns a stable reason code and user-facing reason. No AX focused
   element query is attempted as a fallback or additional gate.
5. Only after the conditional recheck succeeds does the service snapshot the
   clipboard, write the transcript, inject Command-V, and restore the exact
   snapshot. Restore is attempted after both successful and failed injection.

The native protocol should contain only the lightweight target fields and
should reject malformed or ambiguous arguments. Capture, recheck, and
injection use fast bounded native helper operations; timeouts fail closed
instead of permitting an unverified paste.

## Timing and diagnostics

Add privacy-preserving structured paste-stage diagnostics with a
correlation/operation ID and monotonic durations for:

`target_capture`, `target_recheck`, `clipboard_snapshot`, `clipboard_write`,
`injection`, and `clipboard_restore`, plus total paste duration, outcome, and
reason code. Log stage completion/failure, timeout status, and target mode
(`window`), but never log transcript text, clipboard contents, or protected
field values. `src/main.ts` should only change if needed to connect these
diagnostics to existing logging/state reporting.

The native helper must use a small documented timeout budget for target
capture, target recheck, and event injection. Compatibility capture and
recheck must avoid all focused-element AX discovery and remain fast enough to
identify latency regressions. Diagnostics should report budget overruns
without turning timing into a permission or safety bypass.

## Error handling and user-visible behavior

Use stable internal reason codes mapped to exact concise messages for:

* target unavailable or timed out;
* active app, PID, or window changed or became unavailable;
* native event injection blocked, rejected, or timed out;
* clipboard snapshot, write, or restore failure.

There are deliberately no sensitive-application, password-manager,
security-app, login-window, secure-field, or focused-element denial reasons.
All denied or failed operations retain the transcript. Clipboard restoration
must be attempted on every path and a restore failure must be observable in
diagnostics. Existing lifecycle transitions and pending-paste invalidation
remain authoritative; renderer shutdown or generation change must prevent a
late paste from being reported as successful.

## Likely implementation files

* `src/native/pi-paste.c` — lightweight app/PID/window capture, matching
  conditional recheck, fast bounded native operations, and native reason/
  status reporting; remove focused-element discovery from this path.
* `src/services/safe-paste.ts` — lightweight target types, protocol parsing,
  clipboard-stage diagnostics, and bounded helper invocation; remove
  denylist and secure-field policy from paste eligibility.
* `src/services/paste-flow.ts` — only if diagnostics or reason propagation
  requires changes; preserve mutex, duplicate, generation, stale, and pending
  behavior.
* `src/main.ts` — only logging/state integration if needed; do not alter
  lifecycle semantics or log transcript text as part of diagnostics.
* Focused safe-paste, native-helper, and paste-flow tests — cover lightweight
  capture/recheck, mismatch and timeout failures, injection failures,
  clipboard restoration, diagnostics, and pending/stale operations.
* `README.md` — only if the user-facing broad-paste behavior or failure
  behavior is documented there.

No source or packaging/build change is in scope unless required to compile or
ship the native helper change. Do not modify generated `out/` artifacts.

## Test plan

1. Unit-test lightweight target parsing, equality, malformed responses, and
   the exact unavailable/mismatch reason codes. Assert that no focused AX
   element fields are required.
2. Test that Terminal, Telegram, Myanso, and other ordinary app fixtures are
   eligible when app/PID/window identity is available, regardless of the
   focused field or role.
3. Test rejection when the app, PID, or window changes or becomes unavailable
   between capture and the immediate pre-injection recheck.
4. Test native-helper event-injection rejection/blocking and all timeout
   paths, including a bounded-duration assertion for capture and recheck.
   Do not treat a blocked native injection as successful.
5. Test clipboard snapshot/write/injection/restore ordering, restoration on
   every failure path, custom formats, and diagnostics containing durations
   and no transcript contents.
6. Run focused safe-paste and paste-flow suites plus lifecycle/integration
   smoke tests on macOS with event-injection permissions configured. Verify
   failure UI retains the exact reason and transcript and that generation
   invalidation prevents late success.

## Non-goals and safety invariants

This design intentionally does not provide protected-target restrictions: it
removes focused-element checks, secure-field blocks, and the sensitive
app/security/password-manager denylist. It does not guarantee support in every
application; macOS-level event-injection blocks remain failures. It does not
change transcription, clipboard ownership policy, recording lifecycle,
pending-paste semantics, or packaging unless a native-helper build adjustment
is strictly necessary.

The remaining safety invariant is narrow and explicit: every injection is
preceded by exactly one captured app/PID/window target and a successful
matching conditional recheck immediately before Command-V. Unknown or
unavailable target identity and native injection failure always fail closed;
the transcript is retained.

## Self-review

The specification consistently describes one lightweight window target, no
focused-element AX discovery, and no denylist or secure-field blocking. It
does not promise success where macOS blocks injection, preserves clipboard
and lifecycle semantics, and requires diagnostics without transcript content.
The reduced protection is explicit and intentional, matching the user’s final
compatibility-over-protection decision; no contradictory strict-mode or
protected-target language remains.
