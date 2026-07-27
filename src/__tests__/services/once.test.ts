import { describe, expect, test } from "bun:test";
import { once } from "../../services/once.js";

describe("once", () => {
  test("accepts only the first terminal event", () => {
    const values: string[] = [];
    const emit = once((value: string) => values.push(value));
    expect(emit("first")).toBe(true);
    expect(emit("duplicate")).toBe(false);
    expect(values).toEqual(["first"]);
  });
});
