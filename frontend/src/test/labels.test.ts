import { describe, expect, it } from "vitest";
import { offerLabel } from "../lib/labels";

describe("offer labels", () => {
  it.each(["123 Offer", "#123 · Offer", "123 - Offer", "123_Offer", "Offer"])(
    "prints the ID once for %s", (name) => expect(offerLabel(123, name)).toBe("#123 · Offer"),
  );
  it("preserves a different ID or a numeric name prefix", () => {
    expect(offerLabel(123, "1234 Offer")).toBe("#123 · 1234 Offer");
    expect(offerLabel(123, "123abc")).toBe("#123 · 123abc");
    expect(offerLabel(123, "#456 Offer")).toBe("#123 · #456 Offer");
    expect(offerLabel(123, "#123")).toBe("#123");
  });
});
