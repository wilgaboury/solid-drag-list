import { describe, expect, it } from "vitest";

import { move } from "../src/util";

describe("move", () => {
  it("move items within a list", () => {
    expect(move([0, 1, 2], 0, 0)).toStrictEqual([0, 1, 2]);
    expect(move([0, 1, 2], 0, 0, 2)).toStrictEqual([0, 1, 2]);
    expect(move([1, 0, 2], 0, 1)).toStrictEqual([0, 1, 2]);
    expect(move([2, 0, 1], 0, 2)).toStrictEqual([0, 1, 2]);
    expect(move([1, 2, 0], 2, 0)).toStrictEqual([0, 1, 2]);
    expect(move([1, 2, 0], 0, 1, 2)).toStrictEqual([0, 1, 2]);
    expect(move([2, 0, 1], 1, 0, 2)).toStrictEqual([0, 1, 2]);
  });
});
