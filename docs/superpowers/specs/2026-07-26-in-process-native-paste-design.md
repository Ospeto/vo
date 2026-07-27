# In-Process Native Paste Design

**Date:** 2026-07-26
**Status:** Approved design

## Goal

Replace the external `pi-paste` child executable injection path with an
Electron-main-process native Node-API addon. Loading the addon in the app's
Electron main process makes native Accessibility operations use the app's
existing macOS Accessibility permission rather than requiring a separately
authorized helper process.

## Architecture

The addon exposes three main-process-only operations:

1. **Capture target:** return the frontmost application's identity, PID, and
   window identity (including the window title or other stable native window
   identifier required by the matching protocol).
2. **Authorize and match:** verify that Accessibility authorization is
   available and conditionally re-check that the current app/PID/window still
   matches the captured target. Missing, malformed, unavailable, or changed
   identity fails closed.
3. **Submit Command-V:** request native Command-V event injection after a
   successful match.

`safe-paste.ts` remains the owner of clipboard sequencing and paste lifecycle:
it captures the target at recording start, performs the immediate pre-injection
authorization/match, snapshots the clipboard, writes the transcript, requests
Command-V through the addon, and restores the exact clipboard snapshot on both
success and failure. It retains existing mutex, duplicate, generation,
stale-result, pending-paste, and transcript-retention behavior.

The service also retains privacy-preserving structured diagnostics with
correlation/operation IDs, monotonic stage durations, outcomes, and stable
reason codes for target capture, authorization/match, clipboard snapshot,
clipboard write, injection, and clipboard restore. Diagnostics must never
contain transcript text, clipboard contents, or protected field values.

The addon is loaded and called only from Electron main-process code. It is
built against the app's Electron ABI, shipped as an unpacked native module in
the application resources, and loaded using the packaged resource path. The
native build and packaging configuration must ensure the module is not
bytecode-packed or otherwise transformed in a way that prevents Node-API
loading.

After migration, remove the external `pi-paste` executable invocation,
executable build, helper resource packaging, and helper-only runtime/resource
plumbing. Do not retain a fallback that launches the external helper; failures
must be reported through the in-process addon path.

## Behavior and limitations

There is no focused-field policy or application denylist. This broad behavior
is intentional and explicitly user-approved: after app/PID/window authorization
and matching, any ordinary field in the matched target may receive Command-V.

CGEvent submission can request event injection, but it cannot prove that the
receiving application accepted or processed the paste. A successful native
submission must therefore not be presented as proof that text was inserted.
Authorization failure, target mismatch/unavailability, injection rejection,
and timeout remain observable failures; the transcript is retained and
clipboard restoration is still attempted.

## Tests

Add or update focused tests to verify:

* addon response parsing, malformed target data, app/PID/window capture, and
  exact target matching;
* Accessibility authorization success, denial, and timeout handling;
* Command-V submission success, rejection, and timeout handling without
  claiming that the receiving app accepted the paste;
* clipboard snapshot/write/injection/restore ordering, custom formats, and
  restoration on every failure path;
* privacy diagnostics containing stage durations and reason codes but no
  transcript or clipboard content;
* mutex, duplicate, generation invalidation, stale results, pending-paste
  behavior, and transcript retention;
* absence of external-helper execution and absence of focused-field/denylist
  gating.

## Packaging smoke requirements

On a macOS packaged build with Accessibility permission configured, verify that
the Electron main process loads the unpacked Electron-ABI-built addon from the
packaged resource path, captures and matches a target, and requests Command-V.
Verify that the packaged app contains no external `pi-paste` executable or
helper resource and that no runtime path attempts to launch one. Also smoke
test addon-load failure, authorization denial, and injection failure: each
must produce the existing concise failure state, retain the transcript, and
attempt clipboard restoration.

## Self-review

The design names the addon boundary, all required exports, main-process-only
loading, Electron ABI and unpacked packaging, `safe-paste.ts` sequencing and
privacy responsibilities, and removal of the external helper. It explicitly
records the CGEvent acceptance limitation and the intentional absence of
focused-field and denylist policy. Test and packaging requirements are
actionable and contain no placeholders or unresolved implementation choices.
