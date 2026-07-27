import { describe, expect, test } from "bun:test";
import { RendererSession } from "../../services/renderer-session.js";

describe("RendererSession", () => {
  test("requires readiness again after teardown and rejects stale senders", () => {
    const session = new RendererSession<object>();
    const oldSender = {};
    const newSender = {};
    const firstGeneration = session.attach(oldSender);
    expect(session.acknowledgeReady(oldSender, firstGeneration)).toBe(true);
    expect(session.isAvailable(oldSender)).toBe(true);
    expect(session.teardown(oldSender)).toBe(true);
    expect(session.isAvailable(oldSender)).toBe(false);
    expect(session.acknowledgeReady(oldSender, firstGeneration)).toBe(false);
    const secondGeneration = session.attach(newSender);
    expect(session.acknowledgeReady(oldSender, secondGeneration)).toBe(false);
    expect(session.isAvailable(oldSender)).toBe(false);
    expect(session.acknowledgeReady(newSender, secondGeneration)).toBe(true);
    expect(session.isAvailable(newSender)).toBe(true);
  });

  test("detachment rejects later readiness from the old sender", () => {
    const session = new RendererSession<object>();
    const sender = {};
    const generation = session.attach(sender);
    expect(session.detach(sender)).toBe(true);
    expect(session.acknowledgeReady(sender, generation)).toBe(false);
    expect(session.isAvailable(sender)).toBe(false);
  });
});
