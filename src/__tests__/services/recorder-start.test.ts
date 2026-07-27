import { describe, expect, test } from "bun:test";
import { createAndStartRecorder } from "../../services/recorder-start.js";

describe("createAndStartRecorder", () => {
  test("awaits cleanup before propagating start failure", async () => {
    const events: string[] = [];
    await expect(createAndStartRecorder(
      () => ({}),
      () => { events.push("start"); throw new Error("start failed"); },
      async () => { events.push("cleanup"); await Promise.resolve(); events.push("closed"); },
    )).rejects.toThrow("start failed");
    expect(events).toEqual(["start", "cleanup", "closed"]);
  });
});
