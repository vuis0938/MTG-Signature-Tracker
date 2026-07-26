import { describe, it, expect } from "vitest";
import { parseMoxfieldFormat, detectFormat } from "../moxfield-parser";

// ═════════════════════════════════════════════════════════════
// parseMoxfieldFormat — Moxfield 格式
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — Moxfield", () => {
  it("解析标准格式", () => {
    const result = parseMoxfieldFormat("1 Sol Ring (CMM) 345");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("解析多行", () => {
    const text = `1 Sol Ring (CMM) 345
1 Arcane Signet (SLD) 123
1 Command Tower (CMM) 678`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Sol Ring");
    expect(result[1].name).toBe("Arcane Signet");
    expect(result[2].name).toBe("Command Tower");
  });

  it("跳过空行", () => {
    const text = `

1 Sol Ring (CMM) 345

`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(1);
  });

  it("去除 *F* / *S* 标记", () => {
    const result = parseMoxfieldFormat("1 *F* Sol Ring (CMM) 345");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("去除 *S* 标记", () => {
    const result = parseMoxfieldFormat("1 *S* Sol Ring (CMM) 345");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("去除 #tag 注释", () => {
    const result = parseMoxfieldFormat("1 Sol Ring (CMM) 345 #Card Advantage #Draw");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("双面卡牌带 // 分隔", () => {
    const result = parseMoxfieldFormat(
      "1 Glasspool Mimic // Glasspool Shore (ZNR) 45"
    );
    expect(result).toEqual([
      {
        count: "1",
        name: "Glasspool Mimic // Glasspool Shore",
        setCode: "ZNR",
        collectorNumber: "45",
      },
    ]);
  });

  it("卡名含逗号", () => {
    const result = parseMoxfieldFormat(
      "1 Boromir, Warden of the Tower (LTR) 55"
    );
    expect(result).toEqual([
      {
        count: "1",
        name: "Boromir, Warden of the Tower",
        setCode: "LTR",
        collectorNumber: "55",
      },
    ]);
  });

  it("系列代码为 3 字母小写", () => {
    const result = parseMoxfieldFormat(
      "1 Brainstorm (fca) 1"
    );
    expect(result).toEqual([
      {
        count: "1",
        name: "Brainstorm",
        setCode: "fca",
        collectorNumber: "1",
      },
    ]);
  });

  it("不认识的行跳过", () => {
    const result = parseMoxfieldFormat("not a valid card line");
    expect(result).toEqual([]);
  });

  it("空输入返回空数组", () => {
    const result = parseMoxfieldFormat("");
    expect(result).toEqual([]);
  });

  it("混合有效和无效行", () => {
    const text = `1 Sol Ring (CMM) 345
invalid line
1 Arcane Signet (SLD) 123`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Sol Ring");
    expect(result[1].name).toBe("Arcane Signet");
  });
});

// ═════════════════════════════════════════════════════════════
// parseMoxfieldFormat — Arena 格式
// 实际 Arena 导出格式：无系列/编号，有 About/Commander/Deck/Sideboard 分区头
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — Arena", () => {
  it("跳过 Deck 头，解析简单格式卡牌", () => {
    const text = `Deck
1 Sol Ring
1 Arcane Signet`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ count: "1", name: "Sol Ring" });
    expect(result[1]).toEqual({ count: "1", name: "Arcane Signet" });
  });

  it("跳过 Deck 和 Sideboard 头", () => {
    const text = `Deck
1 Sol Ring

Sideboard
1 Pithing Needle`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Sol Ring");
    expect(result[1].name).toBe("Pithing Needle");
  });

  it("跳过 About 头及其内容行", () => {
    const text = `About
Name (Secrets of Strixhaven Commander) Lorehold Spirit

Deck
1 Sol Ring
1 Arcane Signet`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ count: "1", name: "Sol Ring" });
    expect(result[1]).toEqual({ count: "1", name: "Arcane Signet" });
  });

  it("跳过 Commander 和 Companion 头", () => {
    const text = `Companion
1 Lurrus of the Dream-Den

Commander
1 Quintorius, History Chaser

Deck
1 Sol Ring`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Lurrus of the Dream-Den");
    expect(result[1].name).toBe("Quintorius, History Chaser");
    expect(result[2].name).toBe("Sol Ring");
  });

  it("完整 Arena 格式（含 About/Commander/Deck）", () => {
    const text = `About
Name (Secrets of Strixhaven Commander) Lorehold Spirit

Commander
1 Quintorius, History Chaser

Deck
1 Arcane Signet
1 Arena of Glory
10 Mountain

Sideboard
1 Abrade`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(5);
    // Commander
    expect(result[0]).toEqual({ count: "1", name: "Quintorius, History Chaser" });
    // Deck
    expect(result[1]).toEqual({ count: "1", name: "Arcane Signet" });
    expect(result[2]).toEqual({ count: "1", name: "Arena of Glory" });
    expect(result[3]).toEqual({ count: "10", name: "Mountain" });
    // Sideboard
    expect(result[4]).toEqual({ count: "1", name: "Abrade" });
  });
});

// ═════════════════════════════════════════════════════════════
// parseMoxfieldFormat — MTGO / Plain Text 格式
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — MTGO / Plain Text", () => {
  it("解析无系列/编号的格式", () => {
    const result = parseMoxfieldFormat("1 Sol Ring");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring" },
    ]);
  });

  it("多张卡牌无系列/编号", () => {
    const text = `3 Birds of Paradise
2 Sol Ring
1 Arcane Signet`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ count: "3", name: "Birds of Paradise" });
    expect(result[1]).toEqual({ count: "2", name: "Sol Ring" });
    expect(result[2]).toEqual({ count: "1", name: "Arcane Signet" });
  });

  it("卡名含逗号", () => {
    const result = parseMoxfieldFormat("1 Atraxa, Praetors' Voice");
    expect(result).toEqual([
      { count: "1", name: "Atraxa, Praetors' Voice" },
    ]);
  });

  it("混合完整格式和简单格式", () => {
    const text = `1 Sol Ring (CMM) 345
3 Birds of Paradise
1 Arcane Signet (SLD) 123`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(3);
    expect(result[0].setCode).toBe("CMM");
    expect(result[1].setCode).toBeUndefined();
    expect(result[2].setCode).toBe("SLD");
  });
});

// ═════════════════════════════════════════════════════════════
// detectFormat
// ═════════════════════════════════════════════════════════════

describe("detectFormat", () => {
  it("检测 Moxfield 格式", () => {
    expect(detectFormat("1 Sol Ring (CMM) 345")).toBe("moxfield");
  });

  it("检测 Arena 格式（有 Deck 头）", () => {
    const text = `Deck
1 Sol Ring`;
    expect(detectFormat(text)).toBe("arena");
  });

  it("检测 Arena 格式（有 About 头）", () => {
    const text = `About
Name My Deck

Deck
1 Sol Ring`;
    expect(detectFormat(text)).toBe("arena");
  });

  it("检测 Arena 格式（有 Sideboard 头）", () => {
    const text = `1 Sol Ring

Sideboard
1 Pithing Needle`;
    expect(detectFormat(text)).toBe("arena");
  });

  it("检测 Arena 格式（有 Commander 头）", () => {
    const text = `Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring`;
    expect(detectFormat(text)).toBe("arena");
  });

  it("检测 MTGO 格式（无系列/编号）", () => {
    expect(detectFormat("1 Sol Ring")).toBe("mtgo");
  });

  it("检测 Plain Text 格式", () => {
    const text = `3 Birds of Paradise
2 Sol Ring`;
    expect(detectFormat(text)).toBe("mtgo");
  });

  it("空输入默认返回 moxfield", () => {
    expect(detectFormat("")).toBe("moxfield");
  });
});