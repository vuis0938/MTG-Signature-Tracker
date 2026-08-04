import { describe, it, expect } from "vitest";
import { resolveAlias, resolveAliases } from "../artist-aliases";

// ═════════════════════════════════════════════════════════════
// resolveAlias
// ═════════════════════════════════════════════════════════════

describe("resolveAlias", () => {
  it("别名映射存在时返回标准名称", () => {
    const map = new Map([["john avon", "John Avon"]]);
    expect(resolveAlias("john avon", map)).toBe("John Avon");
  });

  it("别名映射不存在时返回原始名称", () => {
    const map = new Map([["john avon", "John Avon"]]);
    expect(resolveAlias("Rebecca Guay", map)).toBe("Rebecca Guay");
  });

  it("大小写不敏感匹配", () => {
    const map = new Map([["john avon", "John Avon"]]);
    expect(resolveAlias("JOHN AVON", map)).toBe("John Avon");
    expect(resolveAlias("John Avon", map)).toBe("John Avon");
  });

  it("前后空格自动 trim", () => {
    const map = new Map([["john avon", "John Avon"]]);
    expect(resolveAlias("  john avon  ", map)).toBe("John Avon");
  });

  it("空 Map 时返回原始名称", () => {
    const map = new Map<string, string>();
    expect(resolveAlias("John Avon", map)).toBe("John Avon");
  });
});

// ═════════════════════════════════════════════════════════════
// resolveAliases
// ═════════════════════════════════════════════════════════════

describe("resolveAliases", () => {
  it("批量转换多个画家名", () => {
    const map = new Map([
      ["john avon", "John Avon"],
      ["rebecca guay", "Rebecca Guay"],
    ]);
    const input = ["john avon", "rebecca guay", "Unknown Artist"];
    expect(resolveAliases(input, map)).toEqual([
      "John Avon",
      "Rebecca Guay",
      "Unknown Artist",
    ]);
  });

  it("空数组返回空数组", () => {
    const map = new Map<string, string>();
    expect(resolveAliases([], map)).toEqual([]);
  });

  it("保留重复项", () => {
    const map = new Map([["john avon", "John Avon"]]);
    const input = ["john avon", "john avon"];
    expect(resolveAliases(input, map)).toEqual(["John Avon", "John Avon"]);
  });
});
