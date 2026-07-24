import { NextRequest, NextResponse } from "next/server";

// ─── LLM 清洗（DeepSeek 优先，Anthropic 备选） ─────────────

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const PROMPT = `你是一个文本解析器。以下是万智牌活动的画家出席名单原文。请从中提取所有画家的英文全名，返回纯 JSON 字符串数组。

规则：
1. 只提取画家姓名，去掉序号、价格、时间、摊位号等无关信息
2. 如果只有中文译名或昵称，保留原文不做翻译
3. 多人合作写成一条的，拆分为独立条目
4. 仅返回 JSON 数组，不要其他任何文字
5. 如果无法识别任何画家，返回空数组 []`;

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

function parseWithRegex(rawText: string): string[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const artists: string[] = [];

  for (const line of lines) {
    if (line.length < 3 || line.length > 200) continue;
    if (line.startsWith("http") || line.startsWith("#")) continue;

    let name = line;

    // 去掉序号前缀: "1." "1)" "①" "1 -"
    name = name.replace(/^[\d]+[\.\)、\-]\s*/, "");
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

    name = name.trim();

    // 过滤无效结果
    if (name.length < 3) continue;
    // 纯数字/符号行
    if (/^[\d\s\.\-\+\$€£\/\\:~]+$/.test(name)) continue;

    artists.push(name);
  }

  return [...new Set(artists)];
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴活动画家名单" }, { status: 400 });
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

    return NextResponse.json({
      success: true,
      artists,
      count: artists.length,
      method,
    });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
