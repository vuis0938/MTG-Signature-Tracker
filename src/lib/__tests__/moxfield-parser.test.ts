import { describe, it, expect } from "vitest";
import { parseMoxfieldFormat } from "../moxfield-parser";

describe("parseMoxfieldFormat", () => {
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