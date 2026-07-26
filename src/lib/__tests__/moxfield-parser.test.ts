import { describe, it, expect } from "vitest";
import { parseMoxfieldFormat, detectFormat } from "../moxfield-parser";

// ═════════════════════════════════════════════════════════════
// 1. 完整格式 — Moxfield: COUNT NAME (SET) NUMBER
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 完整格式", () => {
  it("1 Sol Ring (CMM) 345", () => {
    const result = parseMoxfieldFormat("1 Sol Ring (CMM) 345");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("多行", () => {
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
    const text = `\n\n1 Sol Ring (CMM) 345\n\n`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(1);
  });

  it("去除 *F* / *S* 标记", () => {
    expect(parseMoxfieldFormat("1 *F* Sol Ring (CMM) 345")).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
    expect(parseMoxfieldFormat("1 *S* Sol Ring (CMM) 345")).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("去除 #tag 注释", () => {
    const result = parseMoxfieldFormat("1 Sol Ring (CMM) 345 #Card Advantage #Draw");
    expect(result).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });

  it("双面卡牌 // 分隔", () => {
    const result = parseMoxfieldFormat("1 Glasspool Mimic // Glasspool Shore (ZNR) 45");
    expect(result).toEqual([
      { count: "1", name: "Glasspool Mimic // Glasspool Shore", setCode: "ZNR", collectorNumber: "45" },
    ]);
  });

  it("卡名含逗号", () => {
    expect(parseMoxfieldFormat("1 Boromir, Warden of the Tower (LTR) 55")).toEqual([
      { count: "1", name: "Boromir, Warden of the Tower", setCode: "LTR", collectorNumber: "55" },
    ]);
  });

  it("系列代码为 3 字母小写", () => {
    expect(parseMoxfieldFormat("1 Brainstorm (fca) 1")).toEqual([
      { count: "1", name: "Brainstorm", setCode: "fca", collectorNumber: "1" },
    ]);
  });

  it("不认识的行跳过", () => {
    expect(parseMoxfieldFormat("not a valid card line")).toEqual([]);
  });

  it("空输入返回空数组", () => {
    expect(parseMoxfieldFormat("")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════
// 2. 4x 格式: COUNTx NAME
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 4x 格式", () => {
  it("4x Lightning Bolt", () => {
    expect(parseMoxfieldFormat("4x Lightning Bolt")).toEqual([
      { count: "4", name: "Lightning Bolt" },
    ]);
  });

  it("4 x Lightning Bolt（带空格）", () => {
    expect(parseMoxfieldFormat("4 x Lightning Bolt")).toEqual([
      { count: "4", name: "Lightning Bolt" },
    ]);
  });

  it("多行 4x 格式", () => {
    const text = `4x Brainstorm
2x Ponder
1x Jace, the Mind Sculptor`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "4", name: "Brainstorm" },
      { count: "2", name: "Ponder" },
      { count: "1", name: "Jace, the Mind Sculptor" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 3. 方括号格式: COUNT [SET:NUMBER] NAME
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 方括号格式", () => {
  it("4 [ZNR:45] Glasspool Mimic", () => {
    expect(parseMoxfieldFormat("4 [ZNR:45] Glasspool Mimic")).toEqual([
      { count: "4", name: "Glasspool Mimic", setCode: "ZNR", collectorNumber: "45" },
    ]);
  });

  it("1 [MH3:215] Arena of Glory", () => {
    expect(parseMoxfieldFormat("1 [MH3:215] Arena of Glory")).toEqual([
      { count: "1", name: "Arena of Glory", setCode: "MH3", collectorNumber: "215" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 4. 括号 SET-only: COUNT NAME (SET)
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 括号 SET-only", () => {
  it("4 Lightning Bolt (MM2)", () => {
    expect(parseMoxfieldFormat("4 Lightning Bolt (MM2)")).toEqual([
      { count: "4", name: "Lightning Bolt", setCode: "MM2" },
    ]);
  });

  it("不与完整格式冲突 — 完整格式优先", () => {
    expect(parseMoxfieldFormat("1 Sol Ring (CMM) 345")).toEqual([
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 5. 斜杠格式: COUNT NAME / SET
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 斜杠格式", () => {
  it("4 Lightning Bolt / MM2", () => {
    expect(parseMoxfieldFormat("4 Lightning Bolt / MM2")).toEqual([
      { count: "4", name: "Lightning Bolt", setCode: "MM2" },
    ]);
  });

  it("1 Vendilion Clique / MM2", () => {
    expect(parseMoxfieldFormat("1 Vendilion Clique / MM2")).toEqual([
      { count: "1", name: "Vendilion Clique", setCode: "MM2" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 6. Cockatrice 备牌: SB: COUNT NAME
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — Cockatrice", () => {
  it("SB: 1 Pithing Needle", () => {
    expect(parseMoxfieldFormat("SB: 1 Pithing Needle")).toEqual([
      { count: "1", name: "Pithing Needle" },
    ]);
  });

  it("SB: 2 Grafdigger's Cage", () => {
    expect(parseMoxfieldFormat("SB: 2 Grafdigger's Cage")).toEqual([
      { count: "2", name: "Grafdigger's Cage" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 7. 简单格式: COUNT NAME
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 简单格式", () => {
  it("1 Sol Ring", () => {
    expect(parseMoxfieldFormat("1 Sol Ring")).toEqual([
      { count: "1", name: "Sol Ring" },
    ]);
  });

  it("多张卡牌", () => {
    const text = `3 Birds of Paradise\n2 Sol Ring\n1 Arcane Signet`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "3", name: "Birds of Paradise" },
      { count: "2", name: "Sol Ring" },
      { count: "1", name: "Arcane Signet" },
    ]);
  });

  it("卡名含逗号", () => {
    expect(parseMoxfieldFormat("1 Atraxa, Praetors' Voice")).toEqual([
      { count: "1", name: "Atraxa, Praetors' Voice" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 8. Arena 格式 — 分区头
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — Arena", () => {
  it("跳过 Deck 头", () => {
    const text = `Deck\n1 Sol Ring\n1 Arcane Signet`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "1", name: "Sol Ring" },
      { count: "1", name: "Arcane Signet" },
    ]);
  });

  it("跳过 About 头", () => {
    const text = `About\nName My Deck\n\nDeck\n1 Sol Ring`;
    expect(parseMoxfieldFormat(text)).toEqual([{ count: "1", name: "Sol Ring" }]);
  });

  it("完整 Arena 格式", () => {
    const text = `About\nName My Deck\n\nCommander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Arcane Signet\n10 Mountain\n\nSideboard\n1 Abrade`;
    const result = parseMoxfieldFormat(text);
    expect(result).toEqual([
      { count: "1", name: "Atraxa, Praetors' Voice" },
      { count: "1", name: "Arcane Signet" },
      { count: "10", name: "Mountain" },
      { count: "1", name: "Abrade" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 9. 注释和分类头
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 注释和分类头", () => {
  it("跳过 // 注释行", () => {
    const text = `// This is my deck\n1 Sol Ring\n// Sideboard below\n1 Pithing Needle`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "1", name: "Sol Ring" },
      { count: "1", name: "Pithing Needle" },
    ]);
  });

  it("跳过 # 注释行", () => {
    const text = `# My Commander Deck\n1 Sol Ring\n# 备牌\n1 Pithing Needle`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "1", name: "Sol Ring" },
      { count: "1", name: "Pithing Needle" },
    ]);
  });

  it("跳过 Creatures (20): 分类头", () => {
    const text = `Creatures (20):\n4 Lightning Bolt\nLands (24)\n10 Mountain`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "4", name: "Lightning Bolt" },
      { count: "10", name: "Mountain" },
    ]);
  });

  it("跳过 //Creatures 分类头", () => {
    const text = `//Creatures\n4 Delver of Secrets\n//Spells\n4 Lightning Bolt`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "4", name: "Delver of Secrets" },
      { count: "4", name: "Lightning Bolt" },
    ]);
  });

  it("跳过 DECK: 头", () => {
    expect(parseMoxfieldFormat("DECK:\n4 Lightning Bolt")).toEqual([
      { count: "4", name: "Lightning Bolt" },
    ]);
  });

  it("跳过 SIDEBOARD: 头", () => {
    expect(parseMoxfieldFormat("SIDEBOARD:\n2 Grafdigger's Cage")).toEqual([
      { count: "2", name: "Grafdigger's Cage" },
    ]);
  });

  it("跳过单行独立分类关键词", () => {
    const text = `Creatures\n4 Delver\nInstants\n4 Brainstorm\nLands\n10 Island`;
    expect(parseMoxfieldFormat(text)).toEqual([
      { count: "4", name: "Delver" },
      { count: "4", name: "Brainstorm" },
      { count: "10", name: "Island" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// 10. 混合格式
// ═════════════════════════════════════════════════════════════

describe("parseMoxfieldFormat — 混合格式", () => {
  it("完整格式 + 简单格式混合", () => {
    const text = `1 Sol Ring (CMM) 345\n3 Birds of Paradise\n1 Arcane Signet (SLD) 123`;
    const result = parseMoxfieldFormat(text);
    expect(result).toHaveLength(3);
    expect(result[0].setCode).toBe("CMM");
    expect(result[1].setCode).toBeUndefined();
    expect(result[2].setCode).toBe("SLD");
  });

  it("4x + 完整格式混合", () => {
    const text = `4x Lightning Bolt\n1 Sol Ring (CMM) 345\n2 Counterspell`;
    const result = parseMoxfieldFormat(text);
    expect(result).toEqual([
      { count: "4", name: "Lightning Bolt" },
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
      { count: "2", name: "Counterspell" },
    ]);
  });

  it("MTGGoldfish 风格（DECK 头 + 简单格式）", () => {
    const text = `DECK\n4 Burst Lightning\n2 Dispel\n4 Ponder\n\nSIDEBOARD\n2 Grafdigger's Cage`;
    const result = parseMoxfieldFormat(text);
    expect(result).toEqual([
      { count: "4", name: "Burst Lightning" },
      { count: "2", name: "Dispel" },
      { count: "4", name: "Ponder" },
      { count: "2", name: "Grafdigger's Cage" },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════
// detectFormat
// ═════════════════════════════════════════════════════════════

describe("detectFormat", () => {
  it("检测 Moxfield 格式", () => {
    expect(detectFormat("1 Sol Ring (CMM) 345")).toBe("moxfield");
  });

  it("检测 Arena 格式（有 About 头）", () => {
    expect(detectFormat("About\nName My Deck\n\nDeck\n1 Sol Ring")).toBe("arena");
  });

  it("检测 Arena 格式（有 Commander 头）", () => {
    expect(detectFormat("Commander\n1 Atraxa\n\nDeck\n1 Sol Ring")).toBe("arena");
  });

  it("检测 Cockatrice 格式", () => {
    expect(detectFormat("SB: 2 Grafdigger's Cage")).toBe("generic");
  });

  it("检测 MTGO 格式（无系列/编号）", () => {
    expect(detectFormat("1 Sol Ring")).toBe("mtgo");
  });

  it("空输入默认返回 moxfield", () => {
    expect(detectFormat("")).toBe("moxfield");
  });
});