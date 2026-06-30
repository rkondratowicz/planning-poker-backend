import { describe, expect, it } from "vitest";
import { validateName, validateRoomId } from "../src/validation.js";

describe("validateRoomId", () => {
  const max = 128;

  it("accepts a single-segment slug", () => {
    expect(validateRoomId("xk29", max)).toBeNull();
    expect(validateRoomId("abcd1234", max)).toBeNull();
  });

  it("accepts dash-separated segments", () => {
    expect(validateRoomId("xk29-4plm", max)).toBeNull();
    expect(validateRoomId("aaaa-bbbb-cccc", max)).toBeNull();
  });

  it("rejects the empty string", () => {
    expect(validateRoomId("", max)).toBe("room is required");
  });

  it("rejects strings exceeding the total length cap", () => {
    const long = "a".repeat(max + 1);
    expect(validateRoomId(long, max)).toBe("room is too long");
  });

  it("accepts exactly at the total length cap (multi-segment so each segment ≤ 32)", () => {
    // 32 + 1 + 31 + 1 + 31 + 1 + 31 = 128
    const exact = `${"a".repeat(32)}-${"a".repeat(31)}-${"a".repeat(31)}-${"a".repeat(31)}`;
    expect(exact.length).toBe(max);
    expect(validateRoomId(exact, max)).toBeNull();
  });

  it("rejects uppercase", () => {
    expect(validateRoomId("Abcd", max)).toBe("Invalid room id");
    expect(validateRoomId("ABCD-EFGH", max)).toBe("Invalid room id");
  });

  it("rejects symbols and slashes", () => {
    expect(validateRoomId("ab cd", max)).toBe("Invalid room id");
    expect(validateRoomId("ab/cd", max)).toBe("Invalid room id");
    expect(validateRoomId("ab_cd", max)).toBe("Invalid room id");
    expect(validateRoomId("ab.cd", max)).toBe("Invalid room id");
  });

  it("rejects segments shorter than 4 chars", () => {
    expect(validateRoomId("abc", max)).toBe("Invalid room id");
    expect(validateRoomId("abcd-ef", max)).toBe("Invalid room id");
    expect(validateRoomId("a-bcd-efgh", max)).toBe("Invalid room id");
  });

  it("rejects segments longer than 32 chars", () => {
    const seg33 = "a".repeat(33);
    expect(validateRoomId(seg33, max)).toBe("Invalid room id");
  });

  it("rejects leading or trailing dashes", () => {
    expect(validateRoomId("-abcd", max)).toBe("Invalid room id");
    expect(validateRoomId("abcd-", max)).toBe("Invalid room id");
    expect(validateRoomId("abcd--efgh", max)).toBe("Invalid room id");
  });

  it("rejects a segment of exactly 4 chars (boundary) and accepts 4-32", () => {
    expect(validateRoomId("abcd", max)).toBeNull();
    expect(validateRoomId("a".repeat(32), max)).toBeNull();
    expect(validateRoomId(`${"a".repeat(31)}-b`, max)).toBe("Invalid room id"); // 31-char segment then 1-char
  });
});

describe("validateName", () => {
  const max = 32;

  it("accepts a normal name", () => {
    expect(validateName("Alice", max)).toBeNull();
    expect(validateName("Bob the Builder", max)).toBeNull();
  });

  it("trims before length checks", () => {
    expect(validateName("   Alice   ", max)).toBeNull();
  });

  it("rejects an empty/whitespace-only name after trim", () => {
    expect(validateName("", max)).toBe("name is required");
    expect(validateName("   ", max)).toBe("name is required");
    expect(validateName("\t\n", max)).toBe("name is required");
  });

  it("rejects a name longer than max after trim", () => {
    expect(validateName("a".repeat(max + 1), max)).toBe("name is too long");
  });

  it("accepts a name exactly at max after trim", () => {
    expect(validateName("a".repeat(max), max)).toBeNull();
    expect(validateName(`  ${"a".repeat(max)}  `, max)).toBeNull();
  });

  it("accepts unicode names", () => {
    expect(validateName("☕ drinker", max)).toBeNull();
    expect(validateName("名前", max)).toBeNull();
  });
});
