import { NextRequest, NextResponse } from "next/server";

// ─── LLM 清洗 ────────────────────────────────────────────

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function parseWithLLM(rawText: string): Promise<string[]> {
  const prompt = `你是一个文本解析器。以下是万智牌活动的画家出席名单原文。
请从中提取所有画家的英文全名，返回纯 JSON 字符串数组。

规则：
1. 只提取画家姓名，去掉序号、价格、时间、摊位号等无关信息
2. 如果只有中文译名或昵称，保留原文不做翻译
3. 多人合作写成一条的，拆分为独立条目
4. 返回格式：["Name One", "Name Two", ...]
5. 如果无法识别任何画家，返回空数组 []

原文：
---
${rawText}
---`;

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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM API 错误 (HTTP ${res.status})`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  // 提取 JSON 数组
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
    // 跳过太短/太长的行
    if (line.length < 3 || line.length > 120) continue;

    let name = line;

    // 去掉序号: "1." "1)" "①"
    name = name.replace(/^[\d]+[\.\)、]\s*/, "");
    // 去掉 Markdown 序号
    name = name.replace(/^[\*\-\+]\s*/, "");

    // 按常见分隔符拆分，取第一段（去掉摊位号、价格等）
    name = name.split(/\s*\|\s*|\s{2,}|\t/)[0].trim();

    // 去掉纯数字和特殊字符结尾
    name = name.replace(/\s*[\d\$€£]+\s*$/, "").trim();

    // 过滤：太短、纯数字、URL
    if (name.length < 3) continue;
    if (/^[\d\s\.\-\+\$€£]*$/.test(name)) continue;
    if (name.startsWith("http")) continue;

    artists.push(name);
  }

  // 去重
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
    if (ANTHROPIC_KEY) {
      try {
        artists = await parseWithLLM(text);
        method = "llm";
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
