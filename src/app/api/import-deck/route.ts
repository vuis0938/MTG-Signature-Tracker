import { NextRequest, NextResponse } from "next/server";
import { parse } from "papaparse";
import https from "node:https";
import http from "node:http";
import { supabase } from "@/lib/supabase";
import {
  fetchCardBySetAndNumber,
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";

interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}

// ─── HTTP 请求辅助 ────────────────────────────────────────

/** 用原生 https 模块发请求（绕过 Cloudflare TLS 指纹检测） */
function nativeFetch(url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.moxfield.com/",
          Origin: "https://www.moxfield.com",
        },
        // 关键：禁用 ALPN 协商中的 HTTP/2 通告，贴近 curl 行为
        // @ts-expect-error Node typings may miss ALPNProtocols on get options
        ALPNProtocols: ["http/1.1"],
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: body })
        );
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });
  });
}

// ─── Moxfield URL 解析 ────────────────────────────────────

/** 从 Moxfield 链接提取套牌 ID，如 abc123-def456 */
function extractDeckId(url: string): string | null {
  const match = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/** 从 Moxfield API 获取套牌数据 */
async function fetchMoxfieldDeck(deckId: string): Promise<CardRow[]> {
  const apiUrl = `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(deckId)}`;
  console.log(`[Moxfield] GET ${apiUrl}`);

  const { status, text } = await nativeFetch(apiUrl);

  if (status !== 200) {
    // 如果返回的是 Cloudflare 拦截页面
    if (text.includes("Cloudflare") || text.includes("Attention Required")) {
      throw new Error("Moxfield 的防护系统拦截了请求，请改用 CSV 方式导入");
    }
    throw new Error(`获取 Moxfield 套牌失败 (HTTP ${status})`);
  }

  const data = JSON.parse(text);
  const rows: CardRow[] = [];

  // Moxfield 结构: { boards: { mainboard: { cards: [...] }, sideboard: {...} } }
  // 也兼容: { mainboard: {...}, sideboard: {...} }
  const boards = data.boards || data;

  for (const boardName of ["mainboard", "sideboard", "commanders", "companions"]) {
    const board = boards[boardName];
    if (!board?.cards) continue;

    for (const [key, entry] of Object.entries(board.cards) as [string, any][]) {
      const card = entry.card;
      if (!card) continue;

      const setCode = card.set || "";
      const collectorNumber = card.cn || "";

      // tokens / emblems 往往没有 set + cn，跳过
      if (!setCode || !collectorNumber) continue;

      rows.push({
        count: String(entry.quantity || 1),
        name: card.name || "",
        setCode,
        collectorNumber: String(collectorNumber),
      });
    }
  }

  if (rows.length === 0) {
    throw new Error("Moxfield 返回的套牌数据中没有卡牌信息");
  }

  return rows;
}

// ─── CSV 解析 ─────────────────────────────────────────────

function parseMoxfieldCSV(csvText: string): CardRow[] {
  const result = parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = result.meta.fields ?? [];
  const countCol = headers.find((h) => h.includes("count") || h.includes("quantity")) ?? "";
  const editionCol = headers.find((h) => h.includes("edition") || h.includes("set")) ?? "";
  const numberCol = headers.find((h) => h.includes("collector") || h.includes("number")) ?? "";
  const nameCol = headers.find((h) => h === "name" || h.includes("card")) ?? "";

  if (!editionCol || !numberCol) {
    throw new Error(
      `CSV 列名不匹配。需要 Edition(系列代码) 和 Collector Number(编号) 列。\n找到: ${headers.join(", ")}`
    );
  }

  return result.data
    .filter((row) => row[numberCol]?.trim() && row[editionCol]?.trim())
    .map((row) => ({
      count: (row[countCol] || "1").trim(),
      name: (row[nameCol] || "").trim(),
      setCode: row[editionCol].trim(),
      collectorNumber: row[numberCol].trim(),
    }));
}

// ─── 去重 ─────────────────────────────────────────────────

function dedupeCards(rows: CardRow[]): CardRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.setCode}|${row.collectorNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, csv, url } = body as { name?: string; csv?: string; url?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }

    // ── 1. 确定数据来源 ──
    let rows: CardRow[];
    let source: string;

    // 优先尝试 Moxfield URL
    const deckId = url ? extractDeckId(url) : null;
    if (deckId) {
      try {
        rows = await fetchMoxfieldDeck(deckId);
        source = "Moxfield URL";
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "获取 Moxfield 数据失败" },
          { status: 400 }
        );
      }
    } else if (csv?.trim()) {
      // CSV 作为备选
      try {
        rows = parseMoxfieldCSV(csv);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "CSV 解析失败" },
          { status: 400 }
        );
      }
      source = "Moxfield CSV";
    } else {
      return NextResponse.json(
        { error: "请粘贴 Moxfield 套牌链接或 CSV 数据" },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "没有找到有效卡牌数据" }, { status: 400 });
    }

    // ── 2. 去重 ──
    const uniqueCards = dedupeCards(rows);
    console.log(`[Import] 共 ${rows.length} 行，去重后 ${uniqueCards.length} 张`);

    // ── 3. 创建套牌 ──
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json(
        { error: `创建套牌失败: ${deckError?.message}` },
        { status: 500 }
      );
    }

    // ── 4. 逐张查询 Scryfall ──
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const card of uniqueCards) {
      const scryfallCard = await fetchCardBySetAndNumber(
        card.setCode,
        card.collectorNumber
      );

      if (!scryfallCard) {
        failCount++;
        results.push({
          success: false,
          name: card.name || `${card.setCode}/${card.collectorNumber}`,
          error: "Scryfall 未找到",
        });
        continue;
      }

      const artists = extractArtists(scryfallCard);
      const imageUrl = extractImageUrl(scryfallCard);

      const { error: insertError } = await supabase.from("cards").insert({
        deck_id: deck.id,
        scryfall_id: scryfallCard.id,
        card_name: scryfallCard.name,
        set_name: scryfallCard.set_name,
        set_code: card.setCode,
        collector_number: card.collectorNumber,
        artist_names: artists,
        image_url: imageUrl,
      });

      if (insertError) {
        failCount++;
        results.push({
          success: false,
          name: scryfallCard.name,
          error: `写入失败: ${insertError.message}`,
        });
      } else {
        successCount++;
        results.push({ success: true, name: scryfallCard.name });
      }
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      source,
      total: uniqueCards.length,
      successCount,
      failCount,
      results,
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json(
      { error: "服务器内部错误，请重试" },
      { status: 500 }
    );
  }
}
