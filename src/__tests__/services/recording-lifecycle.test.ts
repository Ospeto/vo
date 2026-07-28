import { describe, expect, test } from "bun:test";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

describe("RecordingLifecycle", () => {
  test("runs the accepted lifecycle with one sequence ID", () => {
    const lifecycle = new RecordingLifecycle();

    const start = lifecycle.requestToggle();
    expect(start).toMatchObject({ accepted: true, state: "starting", sequenceId: 1 });
    expect(lifecycle.acknowledgeStart(start.sequenceId, true)).toMatchObject({
      accepted: true,
      state: "recording",
      sequenceId: 1,
    });

    const stop = lifecycle.requestToggle();
    expect(stop).toMatchObject({ accepted: true, state: "stopping", sequenceId: start.sequenceId });
    expect(lifecycle.acknowledgeStop(stop.sequenceId, true)).toMatchObject({
      accepted: true,
      state: "transcribing",
      sequenceId: start.sequenceId,
    });
    expect(lifecycle.finishTranscription(stop.sequenceId, true)).toMatchObject({
      accepted: true,
      state: "idle",
      sequenceId: start.sequenceId,
    });
  });

  test("accepts recorder data as an implicit stop", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);

    expect(lifecycle.acknowledgeStop(start.sequenceId, true)).toMatchObject({
      accepted: true,
      state: "transcribing",
      sequenceId: start.sequenceId,
    });
  });

  test("rejects requests in transient and error states", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();

    expect(lifecycle.requestToggle()).toMatchObject({ accepted: false, state: "starting" });
    lifecycle.acknowledgeStart(start.sequenceId, false);
    expect(lifecycle.requestToggle()).toMatchObject({ accepted: false, state: "error" });
  });

  test("ignores stale acknowledgements and events", () => {
    const lifecycle = new RecordingLifecycle();
    const first = lifecycle.requestStart();
    lifecycle.reset();
    const second = lifecycle.requestStart();

    expect(lifecycle.acknowledgeStart(first.sequenceId, true).accepted).toBe(false);
    expect(lifecycle.snapshot().state).toBe("starting");
    expect(lifecycle.acknowledgeStart(second.sequenceId, true).accepted).toBe(true);

    const stop = lifecycle.requestStop();
    expect(lifecycle.acknowledgeStop(first.sequenceId, true).accepted).toBe(false);
    expect(lifecycle.finishTranscription(stop.sequenceId, true).accepted).toBe(false);
    expect(lifecycle.snapshot().state).toBe("stopping");
  });

  test("finishes transcription only for the matching stop", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);
    const stop = lifecycle.requestStop();

    lifecycle.acknowledgeStop(stop.sequenceId, true);
    expect(lifecycle.finishTranscription(stop.sequenceId + 1, true).accepted).toBe(false);
    expect(lifecycle.finishTranscription(stop.sequenceId, false)).toMatchObject({
      accepted: true,
      state: "error",
    });
  });

  test("rejects toggles while stopping or transcribing without changing state", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);
    lifecycle.requestStop();

    const stopping = lifecycle.snapshot();
    expect(lifecycle.requestToggle()).toMatchObject({ accepted: false, state: "stopping" });
    expect(lifecycle.snapshot()).toEqual(stopping);

    lifecycle.acknowledgeStop(start.sequenceId, true);
    const transcribing = lifecycle.snapshot();
    expect(lifecycle.requestToggle()).toMatchObject({ accepted: false, state: "transcribing" });
    expect(lifecycle.snapshot()).toEqual(transcribing);
  });

  test("moves a matching stop failure to recoverable error", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);
    const stop = lifecycle.requestStop();

    expect(lifecycle.acknowledgeStop(stop.sequenceId, false)).toMatchObject({
      accepted: true,
      state: "error",
      sequenceId: stop.sequenceId,
    });
    expect(lifecycle.settle()).toMatchObject({ accepted: true, state: "idle" });
  });

  test("shutdown is idempotent and invalidates late events", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();

    expect(lifecycle.shutdown()).toMatchObject({ accepted: true, state: "idle" });
    expect(lifecycle.shutdown()).toMatchObject({ accepted: false, state: "idle" });
    expect(lifecycle.acknowledgeStart(start.sequenceId, true).accepted).toBe(false);
    expect(lifecycle.snapshot()).toMatchObject({ state: "idle", sequenceId: start.sequenceId + 1 });
  });

  test("shutdown preserves error until explicit reset and rejects late acknowledgements", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, false);

    expect(lifecycle.shutdown()).toMatchObject({
      accepted: true,
      state: "error",
      sequenceId: start.sequenceId + 1,
    });
    expect(lifecycle.shutdown()).toMatchObject({ accepted: false, state: "error" });
    expect(lifecycle.acknowledgeStart(start.sequenceId, true).accepted).toBe(false);
    expect(lifecycle.reset()).toMatchObject({ accepted: true, state: "idle" });
  });
});
