import { describe, expect, it } from "vitest";
import { fingerprint, isLookalikeOf } from "./fingerprint";

// Expected values are independent of implementation: top16 ++ low16.
describe("fingerprint", () => {
  it("matches the Solidity bit-slice", () => {
    // 0x7a3F…9c21 -> (0x7a3f << 16) | 0x9c21 = 0x7a3f9c21
    expect(fingerprint("0x7a3F000000000000000000000000000000009C21")).toBe(0x7a3f9c21);
    expect(fingerprint("0x70997970C51812dc3A010C7b01b50e0d17dc79C8")).toBe(0x709979c8);
  });

  it("is case-insensitive", () => {
    expect(fingerprint("0x70997970C51812DC3A010C7B01B50E0D17DC79C8")).toBe(0x709979c8);
  });

  it("same fp iff same first/last 4 hex", () => {
    const payee = "0x7a3F000000000000000000000000000000009C21";
    const look = "0x7a3F111111111111111111111111111111119c21";
    expect(fingerprint(payee)).toBe(fingerprint(look));
    expect(isLookalikeOf(payee, look)).toBe(true);
    expect(isLookalikeOf(payee, payee)).toBe(false);
  });

  it("rejects non-addresses", () => {
    expect(() => fingerprint("0x123")).toThrow();
    expect(() => fingerprint("hello")).toThrow();
  });
});
