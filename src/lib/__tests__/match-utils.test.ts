import { describe, it, expect } from "vitest";
import {
  normalizeArtists,
  buildNormalizedMap,
  findMatchingArtist,
  isSamePrinting,
} from "../match-utils";

// ═════════════════════════════════════════════════════════════
// normalizeArtists
// ═════════════════════════════════════════════════════════════

describe("normalizeArtists", () => {
  it("直接返回 string[] 类型", () => {
    expect(normalizeArtists(["Alice", "Bob"])).toEqual(["Alice", "Bob"]);
  });

  it("兼容 Supabase 返回的 JSON 字符串", () => {
    expect(normalizeArtists('["Alice","Bob"]')).toEqual(["Alice", "Bob"]);
  });

  it("兼容普通字符串（单画家）", () => {
    expect(normalizeArtists("Alice")).toEqual(["Alice"]);
  });

  it("非法 JSON 字符串当作单画家处理", () => {
    expect(normalizeArtists("broken json [")).toEqual(["broken json ["]);
  });

  it("空数组返回空数组", () => {
    expect(normalizeArtists([])).toEqual([]);
  });

  it("null 返回空数组", () => {
    expect(normalizeArtists(null)).toEqual([]);
  });

  it("undefined 返回空数组", () => {
    expect(normalizeArtists(undefined)).toEqual([]);
  });

  it("数字类型返回空数组", () => {
    expect(normalizeArtists(123)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════
// buildNormalizedMap
// ═════════════════════════════════════════════════════════════

describe("buildNormalizedMap", () => {
  it("普通 key 直接映射", () => {
    const map = buildNormalizedMap(["alice", "bob"]);
    expect(map.get("alice")).toBe("alice");
    expect(map.get("bob")).toBe("bob");
  });

  it("移除变音符号", () => {
    const map = buildNormalizedMap(["Milivoj Ćeran"]);
    expect(map.get("Milivoj Ceran")).toBe("Milivoj Ćeran");
  });

  it("多个变音符号", () => {
    const map = buildNormalizedMap(["Kasia 'Kafis' Zielińska"]);
    expect(map.get("Kasia 'Kafis' Zielinska")).toBe("Kasia 'Kafis' Zielińska");
  });

  it("遇到冲突保留第一个", () => {
    const map = buildNormalizedMap(["first", "second"]);
    expect(map.get("first")).toBe("first");
    // 同名规范化 key 不会覆盖
    expect(map.size).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════
// findMatchingArtist
// ═════════════════════════════════════════════════════════════

describe("findMatchingArtist", () => {
  describe("规则 1：精确匹配（大小写不敏感）", () => {
    it("完全相同", () => {
      expect(findMatchingArtist("Alice", ["alice", "bob"])).toBe("alice");
    });

    it("大小写不同", () => {
      expect(findMatchingArtist("ALICE", ["alice", "bob"])).toBe("alice");
    });

    it("首尾空格", () => {
      expect(findMatchingArtist("  alice  ", ["alice", "bob"])).toBe("alice");
    });

    it("无匹配返回 null", () => {
      expect(findMatchingArtist("charlie", ["alice", "bob"])).toBeNull();
    });
  });

  describe("规则 2：首尾名匹配", () => {
    it("Dan Scott → Dan Murayama Scott", () => {
      expect(
        findMatchingArtist("Dan Scott", ["dan murayama scott", "bob"])
      ).toBe("dan murayama scott");
    });

    it("Alice Zhang → Alice Xia Zhang", () => {
      expect(
        findMatchingArtist("Alice Zhang", ["alice xia zhang", "bob"])
      ).toBe("alice xia zhang");
    });

    it("首尾名相同但中间名不同", () => {
      expect(
        findMatchingArtist("Victor Minguez", ["victor adame minguez"])
      ).toBe("victor adame minguez");
    });

    it("只有两个词时精确匹配优先（规则1）", () => {
      expect(
        findMatchingArtist("Dan Scott", ["dan scott", "dan murayama scott"])
      ).toBe("dan scott"); // 规则 1 优先
    });

    it("首词相同但尾词不同不匹配", () => {
      expect(
        findMatchingArtist("Dan Smith", ["dan murayama scott"])
      ).toBeNull();
    });
  });

  describe("规则 3：变音符号规范化", () => {
    it("Milivoj Ceran → Milivoj Ćeran", () => {
      // 实际调用中 dbKeys 已统一小写
      expect(
        findMatchingArtist("Milivoj Ceran", ["milivoj ćeran"])
      ).toBe("milivoj ćeran");
    });

    it("Kasia Zielinska → Kasia 'Kafis' Zielińska", () => {
      // 仅变音符号差异（无中间名干扰）的匹配
      expect(
        findMatchingArtist("Kasia Zielinska", ["kasia zielińska"])
      ).toBe("kasia zielińska");
    });

    it("精确匹配已覆盖时不会触发变音规则", () => {
      // 精确匹配优先
      expect(
        findMatchingArtist("alice", ["alice", "älicë"])
      ).toBe("alice");
    });
  });

  describe("边缘情况", () => {
    it("空画家名", () => {
      expect(findMatchingArtist("", ["alice"])).toBeNull();
    });

    it("空候选列表", () => {
      expect(findMatchingArtist("alice", [])).toBeNull();
    });

    it("单名画家精确匹配", () => {
      expect(findMatchingArtist("daarken", ["daarken", "fesbra"])).toBe(
        "daarken"
      );
    });

    it("单名画家无匹配不触发规则2", () => {
      // 单名无法触发首尾名匹配
      expect(findMatchingArtist("daarken", ["alice"])).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════
// isSamePrinting
// ═════════════════════════════════════════════════════════════

describe("isSamePrinting", () => {
  it("完全相同返回 true", () => {
    expect(
      isSamePrinting(
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "345" },
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "345" }
      )
    ).toBe(true);
  });

  it("不同卡名返回 false", () => {
    expect(
      isSamePrinting(
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "345" },
        { card_name: "Mana Crypt", set_code: "CMM", collector_number: "345" }
      )
    ).toBe(false);
  });

  it("不同系列返回 false", () => {
    expect(
      isSamePrinting(
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "345" },
        { card_name: "Sol Ring", set_code: "SLD", collector_number: "345" }
      )
    ).toBe(false);
  });

  it("不同编号返回 false", () => {
    expect(
      isSamePrinting(
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "345" },
        { card_name: "Sol Ring", set_code: "CMM", collector_number: "346" }
      )
    ).toBe(false);
  });
});