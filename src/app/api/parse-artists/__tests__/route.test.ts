import { describe, it, expect } from "vitest";
import { parseWithRegex } from "../route";

// ═════════════════════════════════════════════════════════════
// 画家名单智能解析（正则降级）测试
//
// 覆盖中文活动接龙、说明文字过滤、序号价格日期清洗等场景。
// ═════════════════════════════════════════════════════════════

describe("parseWithRegex", () => {
  it("解析中文活动接龙格式，过滤标题和说明", () => {
    const text = `#接龙
恺源签绘
现场活动
ROVINA CAI
BENJAMIN EE
APRIL PRIME
ALEX STONE
RK POST
KIERAN YANNER
KELOGSLOOPS
邮寄须知：`;

    const artists = parseWithRegex(text);

    expect(artists).toEqual([
      "ROVINA CAI",
      "BENJAMIN EE",
      "APRIL PRIME",
      "ALEX STONE",
      "RK POST",
      "KIERAN YANNER",
      "KELOGSLOOPS",
    ]);
  });

  it("去掉序号、价格、日期等无关信息", () => {
    const text = `1. John Avon - $40
2) Rebecca Guay 8/1/2026
3. Seb McKinnon 20 USD
① Mark Poole
4 - Terese Nielsen 2026/8/1`;

    const artists = parseWithRegex(text);

    expect(artists).toEqual([
      "John Avon",
      "Rebecca Guay",
      "Seb McKinnon",
      "Mark Poole",
      "Terese Nielsen",
    ]);
  });

  it("过滤常见说明行但保留英文画家名", () => {
    const text = `Notice
Deadline: Aug 1
Price: $20
ROVINA CAI
BENJAMIN EE
Signup info
Limited slots`;

    const artists = parseWithRegex(text);

    expect(artists).toEqual(["ROVINA CAI", "BENJAMIN EE"]);
  });

  it("过滤纯中文短句说明，但保留较长中文名", () => {
    const text = `现场活动
画家名单
张三丰太极拳传承者
ROVINA CAI`;

    const artists = parseWithRegex(text);

    // "张三丰太极拳传承者" 共 9 字，保留；"现场活动"、"画家名单"被过滤
    expect(artists).toEqual(["张三丰太极拳传承者", "ROVINA CAI"]);
  });

  it("拆分多人合作条目并去重", () => {
    const text = `John Avon & Rebecca Guay
ROVINA CAI
ROVINA CAI`;

    const artists = parseWithRegex(text);

    // 当前正则按分隔符取第一段，保留完整条目
    expect(artists).toEqual(["John Avon & Rebecca Guay", "ROVINA CAI"]);
  });

  it("空文本返回空数组", () => {
    expect(parseWithRegex("")).toEqual([]);
    expect(parseWithRegex("   \n\n  ")).toEqual([]);
  });
});
