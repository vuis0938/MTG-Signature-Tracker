import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall-client";
import { batchSearch, CardIdentifier, RateLimiter } from "@/lib/scryfall-client";
import { parseMoxfieldFormat, detectFormat } from "@/lib/moxfield-parser";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const t0 = Date.now();

  // 鉴权：从签名 token 中提取用户名
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：防止 Scryfall API 滥用
  const ip = getClientIP(request);
  const limit = rateLimit(`import-deck:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴套牌列表内容" }, { status: 400 });
    }
    if (text.length > 50000) {
      return NextResponse.json({ error: "套牌内容过长（最多 50,000 字符）" }, { status: 400 });
    }

    // ── 解析 ──
    const detectedFormat = detectFormat(text);
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到卡牌，请粘贴纯文本套牌内容" },
        { status: 400 }
      );
    }

    const formatLabels: Record<string, string> = {
      moxfield: "Copy for Moxfield",
      arena: "Copy for Arena",
      mtgo: "Copy for MTGO",
      plain: "Copy Plain Text",
      generic: "通用格式",
    };

    // ── 创建套牌 ──
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: formatLabels[detectedFormat] || "Copy for Moxfield", user_name: userName })
      .select("id")
      .single();

    if (deckError || !deck) {
      console.error("[Import] 创建套牌失败:", deckError?.message);
      return NextResponse.json({ error: "创建套牌失败，请重试" }, { status: 500 });
    }

    // ── 统一批量查询 Scryfall ──
    // 所有格式统一使用 /cards/collection 批量接口
    // 有 set+number 的传精确标识符，没的传卡名
    // 100 张牌只需 2 次请求，~3s 完成，彻底消除 429
    const SOFT_DEADLINE_MS = 180 * 1000;
    const tScryfall = Date.now();
    const totalCards = rows.reduce((sum, r) => sum + (parseInt(r.count, 10) || 1), 0);

    const identifiers: CardIdentifier[] = rows.map((r) => ({
      name: r.name,
      set: r.setCode || undefined,
      collector_number: r.collectorNumber || undefined,
    }));

    const scryfallResults = await batchSearch(identifiers, new RateLimiter(1));

    // 组装结果
    const cardResults = rows.map((card, i) => ({
      card,
      data: scryfallResults[i],
      timedOut: Date.now() - t0 > SOFT_DEADLINE_MS,
    }));

    const tScryfallDone = Date.now();

    // ── 批量写入 Supabase ──
    let successCount = 0;
    let failCount = 0;
    const failedCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    const timedOutCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data, timedOut } of cardResults) {
      if (timedOut) {
        const count = parseInt(card.count, 10) || 1;
        failCount += count;
        timedOutCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        continue;
      }
      if (!data) {
        failCount += parseInt(card.count, 10) || 1;
        failedCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        continue;
      }
      const count = parseInt(card.count, 10) || 1;
      for (let i = 0; i < count; i++) {
        cardsToInsert.push({
          deck_id: deck.id,
          scryfall_id: data.id,
          card_name: data.name,
          set_name: data.set_name,
          set_code: data.set,
          collector_number: data.collector_number,
          artist_names: extractArtists(data),
          image_url: extractImageUrl(data),
        });
      }
      successCount += count;
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

    // ── 同步填充模糊匹配缓存 ──
    const uniqueCardNames = [...new Set(cardsToInsert.map((c) => c.card_name as string))];
    if (uniqueCardNames.length > 0) {
      try {
        fetch(`${request.nextUrl.origin}/api/cache-printings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: request.headers.get("cookie") || "",
          },
          body: JSON.stringify({ cardNames: uniqueCardNames }),
        }).catch(() => {});
      } catch {}
    }

    const isTimedOut = timedOutCards.length > 0;
    return NextResponse.json({
      success: true,
      deckId: deck.id,
      total: totalCards,
      successCount,
      failCount,
      failedCards: failedCards.length > 0 ? failedCards : undefined,
      timedOut: isTimedOut,
      timedOutCards: isTimedOut ? timedOutCards : undefined,
      hint: isTimedOut
        ? `成功导入 ${successCount} 张，${timedOutCards.length} 张未查到，可通过「添加卡牌」补充`
        : undefined,
      timing: {
        total: `${tTotal}s`,
        scryfall: `${tS}s (${rows.length} batch, ${totalCards} cards)`,
        db: `${(tDB / 1000).toFixed(1)}s`,
      },
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}