import { describe, it, expect } from "vitest";

/**
 * 用真实 Google Docs 文本片段验证解析器
 *
 * 样本来源：https://docs.google.com/document/d/1Z695_k0Cvc458BsM540keBfV2B0Han-JKQIZC6DaCfY/export?format=txt
 * 取自用户提供的 debug 输出，截取包含 Q3、DragonCon、Commander Sealed 三个章节的片段
 */

// 直接测试 parseDocContent 内部逻辑的最佳方式：用真实文本跑一遍
// 由于 parseDocContent 不是导出的，我们通过 fetch 后得到的 sections 间接验证。
// 但为了单元测试的独立性，这里直接构造一个最小可复现的文本片段。

const FIXTURE = `
Upcoming Signings, Status on In-Progress Signings, & Info/Rules
Please use the following address to ship your cards to me:
Matthew Schneider
5527 SW 39th Street
Ocala, FL
34474
UPCOMING SIGNINGS: Artist Name

Q3 2026 signings (deadline August 28th)
* Adi Granov ($13/$23)
* Ann-Sophie de Steur ($8, no shadows currently but may be added later)
* Ernanda Souza ($6/$9)
* Evan Shipard ($6/$9)
* Flavio Girón ($6/$9)
* Paul Scott Canavan ($10 single, $17 shadow, $135000 for anything more annoying than shadow)
* Princess Hidir ($13 single, $18 shadow, $43 fancy)

DragonCon 2026 (hard deadline of August 31st due to travel)
* Alessandra Pisano
* Alexis Ziritt
* Allen Morris
* Allen Panakal
* Andrea Sipl
* Andrew Lee Griffith
* Andrew Robinson
* Andy Brase
* Annie Stegg Gerard
* Ashly Lovett
* Audrey Benjaminsen
* Babs Webb
* Bob Eggleton
* Bruce Brenneise
* Carly Milligan
* Charles Urbach
* Cory Godbey
* Crystal Fae
* Crystal Sully
* Dan Dos Santos
* Daneen Wilkerson
* Daria Aksenova
* Dave Johnson
* Deb JJ Lee
* Devin Elle Kurtz
* Dexter Vines
* Eric Fortune
* Eric Talbot
* Gregg Schigiel ($8)
* Jacob Walker
* Jason A. Engle
* Jed Henry ($13/$23)
* Josiah "Jo" Cameron
* Justin Gerard
* Karen Hallion
* Keith Williams
* Lauren Brown
* Marc Fishman
* Marko Manev ($8 single, $13 shadow, $33 gothic, $43 gothic shadow)
* Michael C. Hayes
* Miranda Meeks ($8 single, $13 shadow, $13 Vampire Kiss, $13 Nocturnal Bats, $43 Rainbow)
* Natalie Andrewson
* Paolo Rivera
* Rhonda Libbey ($8 single, $13 shadow, $33 chameleon)
* Romas Kukalis
* Sarah Finnigan
* SchmandrewART
* Scott M. Fischer
* Steve Argyle
* Tim Jacobus
* Tom Fleming
* Tran Nguyen
* Tyler Walpole

Commander Sealed 2026 (hard deadline of September 15th)
* Artist One
* Artist Two
`;

// ═════════════════════════════════════════════════════════════
// 章节解析
// ═════════════════════════════════════════════════════════════

describe("Mountain Mage 章节解析", () => {
  // 这里我们测试一个轻量级的解析函数，避免依赖网络请求
  // 测试逻辑直接复用 parseDocContent 的核心正则

  const SECTION_WITH_DEADLINE = /deadline/i;
  const SUBSECTION = /^(Tokyo\s+MTG|Kazuki)/i;
  const IN_PROGRESS_SECTION = /^IN[\s-]PROGRESS/i;

  it("识别 Q3 2026 章节标题", () => {
    expect(SECTION_WITH_DEADLINE.test("Q3 2026 signings (deadline August 28th)")).toBe(true);
  });

  it("识别 DragonCon 2026 章节标题", () => {
    expect(SECTION_WITH_DEADLINE.test("DragonCon 2026 (hard deadline of August 31st due to travel)")).toBe(true);
  });

  it("识别 Commander Sealed 2026 章节标题", () => {
    expect(SECTION_WITH_DEADLINE.test("Commander Sealed 2026 (hard deadline of September 15th)")).toBe(true);
  });

  it("识别 Illuxcon 2026 章节标题", () => {
    expect(SECTION_WITH_DEADLINE.test("Illuxcon 2026 (hard deadline of October 16th due to travel)")).toBe(true);
  });

  it("识别 CoolStuffCon Orlando 2026 章节标题", () => {
    expect(SECTION_WITH_DEADLINE.test("CoolStuffCon Orlando 2026 (hard deadline of October 26th due to travel, a little leeway since I will be driving home each night)")).toBe(true);
  });

  it("识别 MagicCon Atlanta 章节标题（无年份）", () => {
    expect(SECTION_WITH_DEADLINE.test("MagicCon Atlanta (hard deadline of November 6th due to travel)")).toBe(true);
  });

  it("识别 Tokyo MTG 子章节", () => {
    expect(SUBSECTION.test("Tokyo MTG/Kazuki signings")).toBe(true);
  });

  it("识别 IN-PROGRESS 章节", () => {
    expect(IN_PROGRESS_SECTION.test("IN-PROGRESS SIGNINGS")).toBe(true);
  });

  it("不误识别普通文本为章节", () => {
    expect(SECTION_WITH_DEADLINE.test("Q3 results are great")).toBe(false);
    expect(SECTION_WITH_DEADLINE.test("DragonCon is fun")).toBe(false);
  });

  it("识别 Q1 2026 为过期章节", () => {
    const EXPIRED = /^Q[1-2]\s+\d{4}/i;
    expect(EXPIRED.test("Q1 2026 signings")).toBe(true);
    expect(EXPIRED.test("Q2 2026 signings")).toBe(true);
  });

  it("Q3/Q4 不是过期章节", () => {
    const EXPIRED = /^Q[1-2]\s+\d{4}/i;
    expect(EXPIRED.test("Q3 2026 signings")).toBe(false);
    expect(EXPIRED.test("Q4 2026 signings")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// 截止日期解析
// ═════════════════════════════════════════════════════════════

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseDeadline(line: string, defaultYear: number): string | null {
  // 先尝试匹配带具体日期的格式
  const withDay = line.match(/deadline\s+(?:of\s+)?([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (withDay) {
    const month = MONTH_MAP[withDay[1].toLowerCase()];
    if (month) return `${defaultYear}-${String(month).padStart(2, "0")}-${String(parseInt(withDay[2], 10)).padStart(2, "0")}`;
  }

  // 再尝试匹配模糊日期 "sometime in Month"
  const vague = line.match(/deadline\s+sometime\s+in\s+([A-Z][a-z]+)/i);
  if (vague) {
    const month = MONTH_MAP[vague[1].toLowerCase()];
    if (month) return `${defaultYear}-${String(month).padStart(2, "0")}`;
  }

  return null;
}

describe("截止日期解析", () => {
  it("解析 Q3 2026 的 deadline August 28th", () => {
    expect(parseDeadline("Q3 2026 signings (deadline August 28th)", 2026)).toBe("2026-08-28");
  });

  it("解析 DragonCon 的 hard deadline of August 31st", () => {
    expect(parseDeadline("DragonCon 2026 (hard deadline of August 31st due to travel)", 2026)).toBe("2026-08-31");
  });

  it("解析 Commander Sealed 的 deadline September 15th", () => {
    expect(parseDeadline("Commander Sealed 2026 (hard deadline of September 15th)", 2026)).toBe("2026-09-15");
  });

  it("无 deadline 的行返回 null", () => {
    expect(parseDeadline("Some event without date", 2026)).toBeNull();
  });

  it("解析模糊日期 deadline sometime in November", () => {
    expect(parseDeadline("MagicCon Atlanta (hard deadline sometime in November due to travel)", 2026)).toBe("2026-11");
  });

  it("解析模糊日期 deadline sometime in December", () => {
    expect(parseDeadline("Some event (deadline sometime in December)", 2026)).toBe("2026-12");
  });
});

// ═════════════════════════════════════════════════════════════
// 艺术家行解析
// ═════════════════════════════════════════════════════════════

describe("艺术家行解析", () => {
  const artistLinePattern = /^\s*\*\s+(.+)$/;

  it("匹配 * 开头的艺术家行", () => {
    const m = "* Adi Granov ($13/$23)".match(artistLinePattern);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("Adi Granov ($13/$23)");
  });

  it("匹配带缩进的 * 艺术家行", () => {
    const m = "   * Ikeda_cpt ($9.50 single, $16 shadow)".match(artistLinePattern);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("Ikeda_cpt ($9.50 single, $16 shadow)");
  });

  it("不匹配普通文本", () => {
    expect(artistLinePattern.test("Matthew Schneider")).toBe(false);
    expect(artistLinePattern.test("Please use the following address")).toBe(false);
  });

  it("提取括号前的纯名称", () => {
    const raw = "Adi Granov ($13/$23)";
    const parenIdx = raw.indexOf("(");
    const name = raw.slice(0, parenIdx).trim();
    expect(name).toBe("Adi Granov");
  });

  it("复杂价格信息也能正确提取名称", () => {
    const raw = "Paul Scott Canavan ($10 single, $17 shadow, $135000 for anything more annoying than shadow)";
    const parenIdx = raw.indexOf("(");
    const name = raw.slice(0, parenIdx).trim();
    expect(name).toBe("Paul Scott Canavan");
  });

  it("无括号的艺术家名保持不变", () => {
    const raw = "Alessandra Pisano";
    const parenIdx = raw.indexOf("(");
    const name = parenIdx > 0 ? raw.slice(0, parenIdx).trim() : raw;
    expect(name).toBe("Alessandra Pisano");
  });
});

// ═════════════════════════════════════════════════════════════
// 排除词测试
// ═════════════════════════════════════════════════════════════

describe("排除词过滤", () => {
  const excludePatterns = [
    "shipping", "please use the following", "please note",
    "signing schedule", "signing in", "signing window",
    "next date", "thank you", "return", "contact", "email",
    "cards must", "all cards", "the following", "artists will",
    "mountainmage", "important", "upcoming signings",
    "and info/rules", "info/rules",
  ];

  it("寄件人地址不应被当作艺术家", () => {
    const lower = "Matthew Schneider".toLowerCase();
    expect(excludePatterns.some((w) => lower.includes(w))).toBe(false);
    // Matthew Schneider 本身不是排除词，但它是地址行，不是以 * 开头的
    // 所以不会被解析为艺术家——这个测试确认排除词不误伤真实人名
  });

  it("upcoming signings 行被排除", () => {
    const lower = "Upcoming Signings, Status on In-Progress Signings".toLowerCase();
    expect(excludePatterns.some((w) => lower.includes(w))).toBe(true);
  });
});