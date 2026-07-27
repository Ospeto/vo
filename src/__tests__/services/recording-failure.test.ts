import { describe, expect, test } from "bun:test";
import { sendRecordingFailure } from "../../services/recording-failure.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

describe("sendRecordingFailure", () => {
  test("uses the error channel for runtime recorder failures", () => {
    const calls: string[] = [];
    const sender = {
      sendRecordingError: (sequenceId: number, error: string) => calls.push(`error:${sequenceId}:${error}`),
      sendRecordingStopResult: () => calls.push("stop"),
    };
    sendRecordingFailure(sender, 7, "MediaRecorder error", true);
    expect(calls).toEqual(["error:7:MediaRecorder error"]);
  });

  test("uses the stop-result channel for stop failures", () => {
    const calls: string[] = [];
    sendRecordingFailure({
      sendRecordingError: () => calls.push("error"),
      sendRecordingStopResult: (_id, success, error) => calls.push(`${success}:${error}`),
    }, 7, "stop failed", false);
    expect(calls).toEqual(["false:stop failed"]);
  });

  test("runtime failure follows recording to stopping to error", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);
    expect(lifecycle.requestStop()).toMatchObject({ state: "stopping", sequenceId: start.sequenceId });
    expect(lifecycle.acknowledgeStop(start.sequenceId, false)).toMatchObject({ state: "error", accepted: true });
  });
});
