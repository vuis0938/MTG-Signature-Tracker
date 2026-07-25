import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  ScryfallCard,
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}

// ─── Scryfall 查询（带自动重试） ───

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const MAX_RETRIES = 2;

async function quickFetchCard(
  setCode: string,
  cn: string,
  attempt = 0
): Promise<ScryfallCard | null> {
  const url = `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(cn)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    // 可重试的错误（含 404，Scryfall 偶尔瞬时返回）
    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        const wait = res.status === 429 ? 2000 : 1000 * (attempt + 1);
        console.warn(`[Scryfall] ${setCode}/${cn} HTTP ${res.status}, ${wait}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        return quickFetchCard(setCode, cn, attempt + 1);
      }
      console.error(`[Scryfall] ${setCode}/${cn} 重试 ${MAX_RETRIES} 次后仍失败`);
      return null;
    }

    return await res.json();
  } catch (err) {
    // 网络错误也重试
    if (attempt < MAX_RETRIES) {
      const wait = 1000 * (attempt + 1);
      console.warn(`[Scryfall] ${setCode}/${cn} 网络错误, ${wait}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await delay(wait);
      return quickFetchCard(setCode, cn, attempt + 1);
    }
    console.error(`[Scryfall] ${setCode}/${cn} 网络错误，重试耗尽:`, err);
    return null;
  }
}

// ─── Moxfield 格式解析 ────────────────────────────────────

function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];
  const re = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)/i;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/\s*\*[FS]\*\s*/g, "");
    const m = cleaned.match(re);
    if (!m) continue;
    rows.push({ count: m[1], name: m[2].trim(), setCode: m[3], collectorNumber: m[4] });
  }
  return rows;
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const t0 = Date.now();

  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴 Copy for Moxfield 的内容" }, { status: 400 });
    }

    // ── 解析 ──
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到有效卡牌。请使用 Moxfield 的「Copy for Moxfield」格式" },
        { status: 400 }
      );
    }

    // ── 创建套牌 ──
    const userName = request.cookies.get("user_name")?.value || "默认用户";
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: "Copy for Moxfield", user_name: userName })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: `创建套牌失败: ${deckError?.message}` }, { status: 500 });
    }

    // ── 8 路并行查询 Scryfall ──
    const CONCURRENCY = 8;
    const BATCH_DELAY = 100; // 批次间隔 ms，8 req/s 稳定不触发限速
    const cardResults: Array<{ card: CardRow; data: ScryfallCard | null }> = [];
    const tScryfall = Date.now();

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (card) => ({
          card,
          data: await quickFetchCard(card.setCode, card.collectorNumber),
        }))
      );
      cardResults.push(...batchResults);
      if (i + CONCURRENCY < rows.length) await delay(BATCH_DELAY);
    }

    const tScryfallDone = Date.now();

    // ── 批量写入 Supabase ──
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    const failedCards: Array<{ name: string; setCode: string; collectorNumber: string }> = [];
    let successCount = 0;
    let failCount = 0;
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data } of cardResults) {
      if (!data) {
        failCount++;
        failedCards.push({
          name: card.name || `${card.setCode}/${card.collectorNumber}`,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        results.push({ success: false, name: card.name, error: "未找到" });
        continue;
      }
      cardsToInsert.push({
        deck_id: deck.id,
        scryfall_id: data.id,
        card_name: data.name,
        set_name: data.set_name,
        set_code: card.setCode,
        collector_number: card.collectorNumber,
        artist_names: extractArtists(data),
        image_url: extractImageUrl(data),
      });
      successCount++;
      results.push({ success: true, name: data.name });
    }

    const tBeforeDB = Date.now();
    if (cardsToInsert.length > 0) {
      const { error: batchError } = await supabase.from("cards").insert(cardsToInsert);
      if (batchError) {
        console.warn("[Import] 批量写入失败，降级:", batchError.message);
        for (const c of cardsToInsert) {
          await supabase.from("cards").insert(c);
        }
      }
    }
    const tDB = Date.now() - tBeforeDB;
    const tTotal = ((Date.now() - t0) / 1000).toFixed(1);
    const tS = ((tScryfallDone - tScryfall) / 1000).toFixed(1);

    // ── 后台异步填充模糊匹配缓存（fire-and-forget，不阻塞响应） ──
    const uniqueCardNames = [...new Set(cardsToInsert.map((c) => c.card_name as string))];
    if (uniqueCardNames.length > 0) {
      fetch(`${request.nextUrl.origin}/api/cache-printings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardNames: uniqueCardNames }),
      }).catch(() => {}); // 静默失败，不影响主流程
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      total: rows.length,
      successCount,
      failCount,
      failedCards,
      timing: {
        total: `${tTotal}s`,
        scryfall: `${tS}s (${rows.length} cards × ${CONCURRENCY} concurrent)`,
        db: `${(tDB / 1000).toFixed(1)}s`,
      },
      results,
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
