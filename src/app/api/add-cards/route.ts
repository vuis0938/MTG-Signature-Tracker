import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl, ScryfallCard } from "@/lib/scryfall";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
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
    rows.push({
      count: m[1],
      name: m[2].trim(),
      setCode: m[3],
      collectorNumber: m[4],
    });
  }
  return rows;
}

// ─── Scryfall 查询（带自动重试） ───

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

    if (!res.ok) {
      if (attempt < 2) {
        const wait = res.status === 429 ? 2000 : 1000 * (attempt + 1);
        await delay(wait);
        return quickFetchCard(setCode, cn, attempt + 1);
      }
      return null;
    }

    return await res.json();
  } catch {
    if (attempt < 2) {
      await delay(1000 * (attempt + 1));
      return quickFetchCard(setCode, cn, attempt + 1);
    }
    return null;
  }
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deckId, text } = body as { deckId?: string; text?: string };

    if (!deckId?.trim()) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴 Copy for Moxfield 的内容" }, { status: 400 });
    }

    // 验证套牌存在
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("id")
      .eq("id", deckId)
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: "套牌不存在" }, { status: 404 });
    }

    // 解析
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到有效卡牌。请使用 Moxfield 的「Copy for Moxfield」格式" },
        { status: 400 }
      );
    }

    // 并行查询 Scryfall
    const CONCURRENCY = 8;
    const cardResults: Array<{ card: CardRow; data: ScryfallCard | null }> = [];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (card) => ({
          card,
          data: await quickFetchCard(card.setCode, card.collectorNumber),
        }))
      );
      cardResults.push(...batchResults);
      if (i + CONCURRENCY < rows.length) await delay(100);
    }

    // 批量写入
    let successCount = 0;
    let failCount = 0;
    const failedCards: Array<{ name: string; setCode: string; collectorNumber: string }> = [];
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data } of cardResults) {
      if (!data) {
        failCount++;
        failedCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        continue;
      }

      cardsToInsert.push({
        deck_id: deckId,
        scryfall_id: data.id,
        card_name: data.name,
        set_name: data.set_name,
        set_code: card.setCode,
        collector_number: card.collectorNumber,
        artist_names: extractArtists(data),
        image_url: extractImageUrl(data),
        status: 0,
        is_signed: false,
      });
      successCount++;
    }

    if (cardsToInsert.length > 0) {
      const { error: batchError } = await supabase.from("cards").insert(cardsToInsert);
      if (batchError) {
        // 逐条降级
        for (const c of cardsToInsert) {
          await supabase.from("cards").insert(c);
        }
      }
    }

    // ── 同步填充模糊匹配缓存（等缓存写完再返回响应） ──
    const uniqueCardNames = [...new Set(cardsToInsert.map((c) => c.card_name as string))];
    if (uniqueCardNames.length > 0) {
      try {
        await fetch(`${request.nextUrl.origin}/api/cache-printings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardNames: uniqueCardNames }),
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      deckId,
      total: rows.length,
      successCount,
      failCount,
      failedCards,
    });
  } catch (error) {
    console.error("[AddCards]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}