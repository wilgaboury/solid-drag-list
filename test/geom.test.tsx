import { describe, expect, it } from "vitest";

import { intersects } from "../src/geom";

describe("intersects", () => {
  it("checks rectangle intersection", () => {
    expect(
      intersects(
        {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        {
          x: 2,
          y: 2,
          width: 1,
          height: 1,
        },
      ),
    ).toBe(false);
  });
});
