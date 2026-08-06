import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { loadArtistAliases, resolveAliases } from "@/lib/artist-aliases";

// ─── LLM 清洗（DeepSeek 优先，Anthropic 备选） ─────────────

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const PROMPT = `你是一个文本解析器。以下是万智牌活动的画家出席名单原文。请从中提取所有画家的英文全名，返回纯 JSON 字符串数组。

规则：
1. 只提取画家姓名，去掉序号、价格、时间、摊位号、活动标题、中文说明等无关信息
2. 如果只有中文译名或昵称，保留原文不做翻译
3. 多人合作写成一条的，拆分为独立条目
4. 仅返回 JSON 数组，不要其他任何文字
5. 如果无法识别任何画家，返回空数组 []

示例 1：
原文：
---
#接龙
恺源签绘
现场活动
ROVINA CAI
BENJAMIN EE
APRIL PRIME
ALEX STONE
RK POST
KIERAN YANNER
KELOGSLOOPS
邮寄须知：
---
应返回：["ROVINA CAI", "BENJAMIN EE", "APRIL PRIME", "ALEX STONE", "RK POST", "KIERAN YANNER", "KELOGSLOOPS"]

示例 2：
原文：
---
1. John Avon - $40
2. Rebecca Guay (full art)
---
应返回：["John Avon", "Rebecca Guay"]`;

async function parseWithLLM(rawText: string): Promise<{ artists: string[]; model: string }> {
  // 优先 DeepSeek
  if (DEEPSEEK_KEY) {
    return {
      artists: await callOpenAICompatible("https://api.deepseek.com/v1", DEEPSEEK_KEY, "deepseek-v4-flash", rawText),
      model: "deepseek",
    };
  }
  // 备选 Anthropic
  if (ANTHROPIC_KEY) {
    return {
      artists: await callAnthropic(rawText),
      model: "claude-haiku",
    };
  }
  throw new Error("未配置 LLM API Key");
}

/** DeepSeek / OpenAI 兼容格式 */
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  rawText: string
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "user", content: `${PROMPT}\n\n原文：\n---\n${rawText}\n---` },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[DeepSeek] 错误响应:", errText);
    throw new Error(`API 错误 (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content || "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const artists = JSON.parse(match[0]);
    return Array.isArray(artists) ? artists : [];
  } catch {
    return [];
  }
}

/** Anthropic Messages API */
async function callAnthropic(rawText: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1024,
      messages: [{ role: "user", content: `${PROMPT}\n\n原文：\n---\n${rawText}\n---` }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Anthropic API 错误 (HTTP ${res.status})`);

  const data = await res.json();
  const text: string = data.content?.[0]?.text || "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const artists = JSON.parse(match[0]);
    return Array.isArray(artists) ? artists : [];
  } catch {
    return [];
  }
}

// ─── 正则降级 ─────────────────────────────────────────────

/** 常见非画家说明词/标题词（中英文活动文案） */
const NON_ARTIST_KEYWORDS =
  /接龙|须知|活动|邮寄|地址|截止|deadline|现场|线上|报名|价格|费用|时间|地点|备注|说明|标题|签到|预约|限量|名额|签绘|展会|摊位| booth|table|签名|info|notice|note|address|price|cost|location|remark|title|signup|sign\s*up|limited|slots|instruction|instructions|onsite|mail|shipping|event|activity/i;

/** 判断一行是否明显不是画家名（标题、说明、活动文案等） */
function isLikelyNonArtist(line: string): boolean {
  // 常见说明关键词
  if (NON_ARTIST_KEYWORDS.test(line)) return true;
  // 以冒号/分号结尾的标题，如"邮寄须知："
  if (/[：:；;]\s*$/.test(line)) return true;
  // 纯中文短句（大概率是中文说明文字），保留可能的中文画家名阈值设为 8 字
  if (/^[\u4e00-\u9fa5]+$/.test(line) && line.length <= 8) return true;
  return false;
}

export function parseWithRegex(rawText: string): string[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const artists: string[] = [];

  for (const line of lines) {
    if (line.length < 3 || line.length > 200) continue;
    if (line.startsWith("http") || line.startsWith("#")) continue;

    let name = line;

    // 跳过明显是标题/说明/活动文案的行
    if (isLikelyNonArtist(name)) continue;

    // 去掉序号前缀: "1." "1)" "①" "1 -" "4 - "
    name = name.replace(/^\d+\s*[-–—]\s*/, "");
    name = name.replace(/^[\d①②③④⑤⑥⑦⑧⑨⑩]+[\.\)、\-\：:]\s*/, "");
    name = name.replace(/^[\d①②③④⑤⑥⑦⑧⑨⑩]+\s+/, "");
    name = name.replace(/^[\*\-\+]\s+/, "");

    // 按分隔符拆分，取第一段
    name = name.split(/\s*\|\s*|\s{2,}|\t/)[0].trim();

    // 去掉末尾的日期: 8/1/2026, 2026/8/1, Aug 1 2026 等
    name = name.replace(/\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b.*$/, "");
    name = name.replace(/\s+\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b.*$/, "");

    // 去掉末尾的价格: $8, $16, $8 & $16, 8 USD 等
    name = name.replace(/\s+\$[\d]+(\s*[&\/]\s*\$[\d]+)*\s*$/, "");
    name = name.replace(/\s+[\d]+\s*(USD|EUR|GBP|JPY|元)\s*$/i, "");

    // 去掉末尾残留数字和时间
    name = name.replace(/\s+\d{1,2}:\d{2}.*$/, "");
    name = name.replace(/\s+\d+\s*$/, "");

    // 去掉末尾的标记: *F*, *S*, etc
    name = name.replace(/\s*\*[A-Z]\*\s*$/, "");

    // 去掉末尾残留的分隔符（价格/日期清洗后可能留下，如 "John Avon -"）
    name = name.replace(/\s*[-–—|\\/\\]\s*$/, "");

    name = name.trim();

    // 过滤无效结果
    if (name.length < 3) continue;
    // 纯数字/符号行
    if (/^[\d\s\.\-\+\$€£\/\\:~]+$/.test(name)) continue;
    // 二次过滤：清洗后变成说明文字的情况
    if (isLikelyNonArtist(name)) continue;

    artists.push(name);
  }

  return [...new Set(artists)];
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：防止 LLM API 费用滥用
  const ip = getClientIP(request);
  const limit = rateLimit(`parse-artists:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴活动画家名单" }, { status: 400 });
    }
    if (text.length > 10000) {
      return NextResponse.json({ error: "文本内容过长（最多 10,000 字符）" }, { status: 400 });
    }

    let artists: string[];
    let method: string;

    // 优先 LLM
    if (DEEPSEEK_KEY || ANTHROPIC_KEY) {
      try {
        const result = await parseWithLLM(text);
        artists = result.artists;
        method = result.model;
      } catch (e) {
        console.warn("[Parse] LLM 失败，降级为正则:", e);
        artists = parseWithRegex(text);
        method = "regex (LLM fallback)";
      }
    } else {
      artists = parseWithRegex(text);
      method = "regex";
    }

    // 应用画家别名映射（将别名转换为标准名称）
    const aliasMap = await loadArtistAliases();
    if (aliasMap.size > 0) {
      artists = resolveAliases(artists, aliasMap);
    }

    return NextResponse.json({
      success: true,
      artists,
      count: artists.length,
      method,
    });
  } catch {
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
