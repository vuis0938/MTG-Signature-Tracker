"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/user";
import { Upload, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
import type { CardRow, Deck, CardEntry, DeckStats, Printing } from "@/types";

// ─── 纯工具函数 ──────────────────────────────────────────

/** 按画家分组 */
function groupCardsByArtist(cardList: CardEntry[]): Map<string, CardEntry[]> {
  const map = new Map<string, CardEntry[]>();
  for (const card of cardList) {
    for (const artist of card.artist_names) {
      const existing = map.get(artist) || [];
      existing.push(card);
      map.set(artist, existing);
    }
  }
  return map;
}

// ─── 页面组件 ──────────────────────────────────────────────

export default function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckStats, setDeckStats] = useState<Record<string, DeckStats>>({});
  const [loading, setLoading] = useState(true);

  // 导入表单状态
  const [showImport, setShowImport] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckText, setDeckText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null); // 分批导入进度

  // Toast 通知
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // 导入失败卡牌的手动重试
  const [failedCards, setFailedCards] = useState<
    Array<{ name: string; setCode: string; collectorNumber: string }>
  >([]);
  const [retryingDeckId, setRetryingDeckId] = useState<string | null>(null);
  const [retryingCard, setRetryingCard] = useState<string | null>(null);

  // 展开的套牌 + 卡牌数据
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardEntry[]>>({});
  const [cardsLoading, setCardsLoading] = useState(false);

  // 添加卡牌弹窗
  const [addCardsOpen, setAddCardsOpen] = useState<string | null>(null);
  const [addCardsText, setAddCardsText] = useState("");
  const [addCardsLoading, setAddCardsLoading] = useState(false);

  // 切换印刷版本弹窗
  const [switchCard, setSwitchCard] = useState<CardEntry | null>(null);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [switchPrintingLoading, setSwitchPrintingLoading] = useState<string | null>(null);
  const [deletingCard, setDeletingCard] = useState<string | null>(null);

  // ─── 加载套牌列表 ──────────────────────────────────────

  const loadDecks = useCallback(async () => {
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .eq("user_name", getCurrentUser())
      .order("created_at", { ascending: false });

    if (!error && data) {
      setDecks(data);

      const statsMap: Record<string, DeckStats> = {};
      await Promise.all(
        data.map(async (deck) => {
          const [{ count: total }, { count: unsigned }, { count: pending }] =
            await Promise.all([
              supabase
                .from("cards")
                .select("*", { count: "exact", head: true })
                .eq("deck_id", deck.id),
              supabase
                .from("cards")
                .select("*", { count: "exact", head: true })
                .eq("deck_id", deck.id)
                .in("status", [0, 3]),
              supabase
                .from("cards")
                .select("*", { count: "exact", head: true })
                .eq("deck_id", deck.id)
                .eq("status", 1),
            ]);
          statsMap[deck.id] = {
            total: total ?? 0,
            unsigned: unsigned ?? 0,
            pending: pending ?? 0,
          };
        })
      );
      setDeckStats(statsMap);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  // ─── 展开/收起套牌 ──────────────────────────────────────

  async function toggleDeck(deckId: string) {
    if (expandedDeck === deckId) {
      setExpandedDeck(null);
      return;
    }

    setExpandedDeck(deckId);

    if (!cards[deckId]) {
      setCardsLoading(true);
      const { data } = await supabase
        .from("cards")
        .select("*")
        .eq("deck_id", deckId)
        .order("artist_names");

      if (data) {
        setCards((prev) => ({ ...prev, [deckId]: data }));
      }
      setCardsLoading(false);
    }
  }

  // ─── 删除套牌 ──────────────────────────────────────────

  const deleteDeck = useCallback(async (deckId: string) => {
    if (!confirm("确定要删除这套牌吗？所有卡牌数据将被永久删除。")) return;

    await supabase.from("decks").delete().eq("id", deckId);
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setCards((prev) => {
      const next = { ...prev };
      delete next[deckId];
      return next;
    });
    if (expandedDeck === deckId) setExpandedDeck(null);
  }, [expandedDeck]);

  // ─── 导入套牌 ──────────────────────────────────────────

// ─── 分批导入套牌 ──────────────────────────────────────────
//
// 流程：
//  1. 解析套牌并创建空套牌 → 1 秒内完成
//  2. 把所有卡牌分成每批 20-30 张，分批调用 add-cards
//  3. 每批请求都不超过 10 秒，全程可以看到进度
//  4. 全部导入完成后通知结果
//
// 优势：不管多少张卡牌，不会被 Vercel 一刀切断，能等到全部完成
//
  const handleImport = useCallback(async () => {
    if (!deckName.trim()) {
      setToast({ message: "请输入套牌名称", type: "error" });
      return;
    }
    if (!deckText.trim()) {
      setToast({ message: "请粘贴套牌列表内容", type: "error" });
      return;
    }

    setImporting(true);
    let totalSuccess = 0;
    let totalFail = 0;
    let allFailedCards: typeof failedCards = [];

    try {
      // 第一步：创建套牌并解析
      setImportProgress("正在解析...");
      const createRes = await fetch("/api/import-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deckName, text: deckText }),
      });
      const createData = await createRes.json();

      if (!createData.success) {
        setToast({ message: createData.error, type: "error" });
        return;
      }

      const deckId = createData.deckId;
      const allRows = createData.rows;
      const total = createData.total;

      // 第二步：分批查询 Scryfall，每批 25 张
      const BATCH_SIZE = 25; // 每批 25 张 ≈ 3 秒，远小于 10 秒限制
      let processed = 0;

      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        processed += batch.length;
        setImportProgress(`导入中... ${processed}/${total}`);

        const addRes = await fetch("/api/add-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId, rows: batch }),
        });
        const addData = await addRes.json();

        if (addData.success) {
          totalSuccess += addData.successCount;
          totalFail += addData.failCount;
          if (addData.failedCards) {
            allFailedCards.push(...addData.failedCards);
          }
        } else {
          // 单批失败，把这一批全部标记为失败
          batch.forEach(row => {
            totalFail += parseInt(row.count, 10) || 1;
            allFailedCards.push({
              name: row.name,
              setCode: row.setCode,
              collectorNumber: row.collectorNumber,
            });
          });
        }

        // 批之间短等待，避免连续请求冲击
        if (i + BATCH_SIZE < allRows.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // 全部完成
      const hasFailures = totalFail > 0;
      const msg =
        `✅ 「${deckName}」${totalSuccess}/${total} 张成功` +
        (hasFailures ? `，${totalFail} 张未找到` : "");

      setToast({ message: msg, type: hasFailures ? "error" : "success" });

      if (hasFailures && allFailedCards.length > 0) {
        setFailedCards(allFailedCards);
        setRetryingDeckId(deckId);
      } else {
        setFailedCards([]);
        setRetryingDeckId(null);
      }

      setDeckName("");
      setDeckText("");
      setShowImport(false);
      await loadDecks();
    } catch {
      setToast({ message: "网络错误，请重试", type: "error" });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }, [deckName, deckText, loadDecks]);

  // ─── 手动重试单张卡牌 ──────────────────────────────────

  const retryCard = useCallback(async (cardName: string, setCode: string, collectorNumber: string) => {
    if (!retryingDeckId) return;
    setRetryingCard(cardName);

    try {
      const res = await fetch("/api/retry-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckId: retryingDeckId, cardName, setCode, collectorNumber }),
      });
      const data = await res.json();

      if (data.success) {
        setFailedCards((prev) => prev.filter((c) => c.name !== cardName));
        setToast({
          message: `✅ 「${cardName}」通过模糊搜索成功录入`,
          type: "success",
        });
        await loadDecks();
        if (expandedDeck === retryingDeckId) {
          const { data: freshCards } = await supabase
            .from("cards")
            .select("*")
            .eq("deck_id", retryingDeckId)
            .order("artist_names");
          if (freshCards) {
            setCards((prev) => ({ ...prev, [retryingDeckId]: freshCards }));
          }
        }
      } else {
        setToast({ message: `❌ ${cardName}: ${data.error}`, type: "error" });
      }
    } catch {
      setToast({ message: `❌ ${cardName}: 网络错误`, type: "error" });
    } finally {
      setRetryingCard(null);
    }
  }, [retryingDeckId, expandedDeck, loadDecks]);

  // ─── 三态切换 ──────────────────────────────────────────

  async function toggleStatus(cardId: string, currentStatus: number, deckId: string) {
    const newStatus = (currentStatus + 1) % 3;

    setCards((prev) => {
      const updated = { ...prev };
      if (updated[deckId]) {
        updated[deckId] = updated[deckId].map((c) =>
          c.id === cardId ? { ...c, status: newStatus, is_signed: newStatus === 2 } : c
        );
      }
      return updated;
    });

    setDeckStats((prev) => {
      const stats = { ...prev };
      if (stats[deckId]) {
        const delta: Record<number, { u: number; p: number }> = {
          0: { u: 1, p: 0 },
          1: { u: 0, p: 1 },
          2: { u: 0, p: 0 },
          3: { u: 1, p: 0 },
        };
        const old = delta[currentStatus] ?? { u: 0, p: 0 };
        const now = delta[newStatus] ?? { u: 0, p: 0 };
        stats[deckId] = {
          ...stats[deckId],
          unsigned: stats[deckId].unsigned - old.u + now.u,
          pending: stats[deckId].pending - old.p + now.p,
        };
      }
      return stats;
    });

    await supabase
      .from("cards")
      .update({ status: newStatus, is_signed: newStatus === 2 })
      .eq("id", cardId);
  }

  // ─── 添加卡牌到套牌 ──────────────────────────────────

  const handleAddCards = useCallback(async () => {
    if (!addCardsOpen || !addCardsText.trim()) {
      setToast({ message: "请粘贴套牌列表内容", type: "error" });
      return;
    }

    setAddCardsLoading(true);
    try {
      const res = await fetch("/api/add-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckId: addCardsOpen, text: addCardsText }),
      });

      const data = await res.json();

      if (data.success) {
        const hasFailures = data.failCount > 0;
        const timeoutHint = data.timedOut ? "（超时保护，剩余卡牌可重新添加）" : "";
        setToast({
          message: `✅ 添加 ${data.successCount}/${data.total} 张成功` +
            (hasFailures ? `，${data.failCount} 张未找到${timeoutHint}` : ""),
          type: hasFailures ? "error" : "success",
        });
        setAddCardsOpen(null);
        setAddCardsText("");
        await loadDecks();
        if (expandedDeck === addCardsOpen) {
          const { data: freshCards } = await supabase
            .from("cards")
            .select("*")
            .eq("deck_id", addCardsOpen)
            .order("artist_names");
          if (freshCards) {
            setCards((prev) => ({ ...prev, [addCardsOpen]: freshCards }));
          }
        }
      } else {
        setToast({ message: data.error, type: "error" });
      }
    } catch {
      setToast({ message: "网络错误，请重试", type: "error" });
    } finally {
      setAddCardsLoading(false);
    }
  }, [addCardsOpen, addCardsText, expandedDeck, loadDecks]);

  // ─── 加载卡牌所有印刷版本 ──────────────────────────────

  async function loadPrintings(card: CardEntry) {
    setSwitchCard(card);
    setPrintings([]);
    setPrintingsLoading(true);

    try {
      const res = await fetch(`/api/card-printings?name=${encodeURIComponent(card.card_name)}`);
      const data = await res.json();

      if (data.success) {
        setPrintings(data.printings);
      } else {
        setToast({ message: `加载印刷版本失败: ${data.error}`, type: "error" });
        setSwitchCard(null);
      }
    } catch {
      setToast({ message: "网络错误", type: "error" });
      setSwitchCard(null);
    } finally {
      setPrintingsLoading(false);
    }
  }

  // ─── 切换印刷版本 ──────────────────────────────────────

  async function handleSwitchPrinting(cardId: string, setCode: string, collectorNumber: string) {
    setSwitchPrintingLoading(cardId);
    try {
      const res = await fetch("/api/switch-printing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, setCode, collectorNumber }),
      });

      const data = await res.json();

      if (data.success) {
        setToast({
          message: `✅ 已切换为 ${data.newSet} #${data.newCollectorNumber}`,
          type: "success",
        });

        const deckId = switchCard?.deck_id;
        if (deckId) {
          setCards((prev) => {
            const updated = { ...prev };
            if (updated[deckId]) {
              updated[deckId] = updated[deckId].map((c) =>
                c.id === cardId
                  ? {
                      ...c,
                      set_code: data.newSetCode,
                      collector_number: data.newCollectorNumber,
                      artist_names: data.newArtistNames,
                      image_url: data.newImageUrl,
                    }
                  : c
              );
            }
            return updated;
          });
        }
        setSwitchCard(null);
        setPrintings([]);
      } else {
        setToast({ message: `切换失败: ${data.error}`, type: "error" });
      }
    } catch {
      setToast({ message: "网络错误", type: "error" });
    } finally {
      setSwitchPrintingLoading(null);
    }
  }

  // ─── 删除卡牌 ──────────────────────────────────────────

  async function handleDeleteCard(cardId: string) {
    setDeletingCard(cardId);
    try {
      const { error } = await supabase.from("cards").delete().eq("id", cardId);

      if (error) {
        setToast({ message: `删除失败: ${error.message}`, type: "error" });
        return;
      }

      setToast({ message: "✅ 卡牌已删除", type: "success" });

      const deckId = switchCard?.deck_id;
      if (deckId) {
        setCards((prev) => {
          const updated = { ...prev };
          if (updated[deckId]) {
            updated[deckId] = updated[deckId].filter((c) => c.id !== cardId);
          }
          return updated;
        });
      }

      setSwitchCard(null);
      setPrintings([]);
      await loadDecks();
    } catch {
      setToast({ message: "网络错误", type: "error" });
    } finally {
      setDeletingCard(null);
    }
  }

  // ─── 渲染 ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Toast 通知 */}
      {toast && (
        <div
          className={`p-3 rounded-lg text-sm ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-3 text-current opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">管理套牌</h1>
          <p className="text-muted-foreground">管理你的套牌和签绘清单</p>
        </div>
        <Button
          onClick={() => {
            setShowImport(!showImport);
            if (!showImport) { setDeckName(""); setDeckText(""); }
          }}
          disabled={importing}
        >
          <Upload className="h-4 w-4 mr-2" />
          导入套牌
        </Button>
      </div>

      {/* 导入表单 */}
      {showImport && (
        <Card>
          <CardHeader>
            <CardTitle>导入套牌</CardTitle>
            <CardDescription>
              从 Moxfield 导入套牌数据，自动匹配每张卡牌的画家信息。支持 Copy for Moxfield / Arena / MTGO / Plain Text 四种格式
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deckName">套牌名称</Label>
              <Input
                id="deckName"
                placeholder="例如: Edgar Markov EDH"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">牌表内容</Label>
              <Textarea
                id="text"
                placeholder={`粘贴套牌列表内容，自动识别以下格式：
◆ 1 Sol Ring (CMM) 345   — Moxfield 完整格式
◆ 4x Lightning Bolt    — 4x 格式
◆ 4 [ZNR:45] Card      — 方括号格式
◆ 4 Card (MM2)         — 括号 SET-only
◆ 4 Card / MM2         — 斜杠格式
◆ SB: 1 Card           — Cockatrice 备牌
◆ Deck\\n1 Card          — Arena 分区头
◆ 1 Card               — 简单格式
◆ // 注释、# 注释、分类头 — 自动跳过`}
                rows={8}
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                💡 操作步骤：<br />
                1. 在 Moxfield 牌表页面，点击每张卡牌 → <b>Switch Printing</b> 切换为实际持有的印刷版本<br />
                2. 点击 <b>Export</b> → 选择 <b>Copy for Moxfield</b>（推荐）等格式<br />
                3. 粘贴到上方文本框 → 点击「开始导入」<br />
                注意：无系列/编号信息的格式，导入时会自动按卡名匹配最接近的印刷版本。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {importProgress || "导入中..."}
                  </span>
                ) : "开始导入"}
              </Button>
              <Button variant="outline" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 导入失败的卡牌 — 手动重试 */}
      {failedCards.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base">
              ⚠️ {failedCards.length} 张卡牌未找到
            </CardTitle>
            <CardDescription>
              精确定位失败，可手动触发模糊搜索。注意：模糊搜索可能返回不同版本，请确认画家是否正确。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {failedCards.map((card) => (
                <div
                  key={card.name}
                  className="flex items-center justify-between gap-3 py-2 border-b border-amber-100 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{card.name}</p>
                    {(card.setCode || card.collectorNumber) && (
                      <p className="text-xs text-muted-foreground">
                        {card.setCode || "?"} / {card.collectorNumber || "?"}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryingCard === card.name}
                    onClick={() => retryCard(card.name, card.setCode, card.collectorNumber)}
                  >
                    {retryingCard === card.name ? "搜索中..." : "模糊搜索"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 套牌列表 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">暂无套牌数据，点击"导入套牌"开始</p>
        </div>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <DeckListItem
              key={deck.id}
              deck={deck}
              stats={deckStats[deck.id]}
              isExpanded={expandedDeck === deck.id}
              cards={cards[deck.id]}
              cardsLoading={cardsLoading}
              onToggle={toggleDeck}
              onAddCards={(deckId) => { setAddCardsOpen(deckId); setAddCardsText(""); }}
              onDelete={deleteDeck}
              onToggleStatus={toggleStatus}
              onLoadPrintings={loadPrintings}
            />
          ))}
        </div>
      )}

      {/* ─── 添加卡牌弹窗 ─── */}
      <Dialog open={addCardsOpen !== null} onOpenChange={() => setAddCardsOpen(null)}>
        <DialogHeader>
          <DialogTitle>添加卡牌到套牌</DialogTitle>
          <DialogDescription>
            粘贴套牌列表内容，支持 Moxfield / Arena / MTGO / Plain Text 四种格式，将卡牌添加到当前套牌
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addCardsText">牌表内容</Label>
            <Textarea
              id="addCardsText"
              placeholder={`粘贴套牌列表内容，自动识别以下格式：
◆ 1 Sol Ring (CMM) 345   — Moxfield 完整格式
◆ 4x Lightning Bolt    — 4x 格式
◆ 4 [ZNR:45] Card      — 方括号格式
◆ 4 Card (MM2)         — 括号 SET-only
◆ 4 Card / MM2         — 斜杠格式
◆ SB: 1 Card           — Cockatrice 备牌
◆ Deck\\n1 Card          — Arena 分区头
◆ 1 Card               — 简单格式
◆ // 注释、# 注释、分类头 — 自动跳过`}
              rows={6}
              value={addCardsText}
              onChange={(e) => setAddCardsText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleAddCards} disabled={addCardsLoading}>
              {addCardsLoading ? "添加中..." : "添加卡牌"}
            </Button>
            <Button variant="outline" onClick={() => setAddCardsOpen(null)}>
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── 切换印刷版本弹窗 ─── */}
      <VersionSwitchDialog
        switchCard={switchCard}
        printings={printings}
        printingsLoading={printingsLoading}
        switchPrintingLoading={switchPrintingLoading}
        deletingCard={deletingCard}
        onClose={() => { setSwitchCard(null); setPrintings([]); }}
        onSwitchPrinting={handleSwitchPrinting}
        onDeleteCard={handleDeleteCard}
      />
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────

interface DeckListItemProps {
  deck: Deck;
  stats: DeckStats | undefined;
  isExpanded: boolean;
  cards: CardEntry[] | undefined;
  cardsLoading: boolean;
  onToggle: (deckId: string) => void;
  onAddCards: (deckId: string) => void;
  onDelete: (deckId: string) => void;
  onToggleStatus: (cardId: string, currentStatus: number, deckId: string) => void;
  onLoadPrintings: (card: CardEntry) => void;
}

function DeckListItem({
  deck, stats, isExpanded, cards, cardsLoading,
  onToggle, onAddCards, onDelete, onToggleStatus, onLoadPrintings,
}: DeckListItemProps) {
  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-accent/50 rounded-t-lg"
        onClick={() => onToggle(deck.id)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <div>
              <CardTitle className="text-base">{deck.name}</CardTitle>
              <CardDescription>
                {stats && (
                  <>
                    共 {stats.total} 张
                    {stats.unsigned > 0 && ` · ${stats.unsigned} 待签`}
                    {stats.pending > 0 && ` · ${stats.pending} 送签中`}
                    {stats.total - stats.unsigned - stats.pending > 0 &&
                      ` · ${stats.total - stats.unsigned - stats.pending} 已签`}
                    <br />
                    上次更新时间：{new Date(deck.created_at!).toLocaleDateString("zh-CN")}
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <Button
              variant="ghost"
              size="icon"
              title="添加卡牌"
              onClick={(e) => { e.stopPropagation(); onAddCards(deck.id); }}
            >
              <Plus className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDelete(deck.id); }}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          {cardsLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">加载卡牌...</span>
            </div>
          ) : cards?.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无卡牌</p>
          ) : (
            <div className="space-y-4">
              {Array.from(groupCardsByArtist(cards || [])).map(([artist, artistCards]) => (
                <div key={artist}>
                  <h4 className="text-sm font-medium mb-2">
                    🎨 {artist} ({artistCards.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {artistCards.map((card) => (
                      <CardThumbnail
                        key={card.id}
                        card={card}
                        deckId={deck.id}
                        onToggleStatus={onToggleStatus}
                        onLoadPrintings={onLoadPrintings}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── 卡牌缩略图 ──────────────────────────────────────────

interface CardThumbnailProps {
  card: CardEntry;
  deckId: string;
  onToggleStatus: (cardId: string, currentStatus: number, deckId: string) => void;
  onLoadPrintings: (card: CardEntry) => void;
}

function CardThumbnail({ card, deckId, onToggleStatus, onLoadPrintings }: CardThumbnailProps) {
  const status = card.status ?? (card.is_signed ? 2 : 0);
  const statusLabels: Record<number, string> = {
    0: "未签（点击切换为送签中）",
    1: "送签中（点击切换为已签）",
    2: "已签（点击切换为未签）",
    3: "心动",
  };
  const hasOverlay = status >= 1;
  const overlayColor: Record<number, string> = { 1: "bg-blue-500", 2: "bg-green-500", 3: "bg-pink-500" };
  const overlayIcon: Record<number, string> = { 1: "…", 2: "✓", 3: "♥" };

  return (
    <div className="group relative w-24">
      <div
        onClick={() => onToggleStatus(card.id, status, deckId)}
        className={`relative rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 ${
          hasOverlay
            ? status === 3 ? "border-pink-400" : status === 1 ? "border-blue-400" : "border-green-500"
            : "border-border hover:shadow-md"
        }`}
        title={statusLabels[status]}
      >
        {/* 心动活动标签 */}
        {status === 3 && card.event_name && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-pink-500/90 text-white text-[9px] px-1 py-0.5 text-center leading-tight">
            ♥ {card.event_name}
            {card.event_date && ` · ${card.event_date}`}
          </div>
        )}

        <div className={hasOverlay ? "opacity-75" : ""}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} className="w-full" loading="lazy" />
          ) : (
            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {card.card_name}
            </div>
          )}
        </div>

        {hasOverlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${overlayColor[status] || "bg-blue-500"}`}>
              {overlayIcon[status] || "…"}
            </div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
          {card.card_name}
        </div>
      </div>

      {/* 切换版本按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onLoadPrintings(card); }}
        className="absolute top-0.5 right-0.5 z-20 w-6 h-6 rounded-full bg-background/80 border shadow-sm flex items-center justify-center hover:bg-accent hover:scale-110 transition-all"
        title="切换印刷版本"
      >
        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

// ─── 切换印刷版本弹窗 ────────────────────────────────────

interface VersionSwitchDialogProps {
  switchCard: CardEntry | null;
  printings: Printing[];
  printingsLoading: boolean;
  switchPrintingLoading: string | null;
  deletingCard: string | null;
  onClose: () => void;
  onSwitchPrinting: (cardId: string, setCode: string, collectorNumber: string) => void;
  onDeleteCard: (cardId: string) => void;
}

function VersionSwitchDialog({
  switchCard, printings, printingsLoading, switchPrintingLoading, deletingCard,
  onClose, onSwitchPrinting, onDeleteCard,
}: VersionSwitchDialogProps) {
  return (
    <Dialog open={switchCard !== null} onOpenChange={onClose}>
      <DialogHeader>
        <DialogTitle>切换印刷版本 — {switchCard?.card_name}</DialogTitle>
        <DialogDescription>
          当前版本：{switchCard?.set_code?.toUpperCase()} #{switchCard?.collector_number}
          {switchCard?.artist_names && ` · 画家：${switchCard.artist_names.join(", ")}`}
        </DialogDescription>
      </DialogHeader>
      {printingsLoading ? (
        <DialogContent>
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        </DialogContent>
      ) : (
        <DialogContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-2">
            {printings.map((printing) => {
              const isCurrent =
                printing.set === switchCard?.set_code &&
                printing.collector_number === switchCard?.collector_number;
              const isSwitching = switchPrintingLoading === switchCard?.id;

              return (
                <button
                  key={`${printing.set}-${printing.collector_number}`}
                  onClick={() => {
                    if (switchCard && !isCurrent && !isSwitching) {
                      onSwitchPrinting(switchCard.id, printing.set, printing.collector_number);
                    }
                  }}
                  disabled={isCurrent || isSwitching}
                  className={`text-left rounded-lg border overflow-hidden transition-all ${
                    isCurrent
                      ? "border-primary ring-2 ring-primary/30 cursor-default"
                      : "border-border hover:border-primary/50 hover:shadow cursor-pointer"
                  } ${isSwitching ? "opacity-50" : ""}`}
                  title={printing.artist}
                >
                  {printing.image_url ? (
                    <img
                      src={printing.image_url}
                      alt={`${printing.set_name} #${printing.collector_number}`}
                      className="w-full"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center text-xs text-muted-foreground">
                      {printing.set_name}
                    </div>
                  )}
                  <div className="p-1.5 text-[10px]">
                    <p className="font-medium truncate">{printing.set_name}</p>
                    <p className="text-muted-foreground truncate">
                      #{printing.collector_number} · {printing.artist}
                    </p>
                    {isCurrent && <p className="text-primary font-medium mt-0.5">当前版本</p>}
                  </div>
                </button>
              );
            })}
          </div>
          {printings.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              未找到该卡牌的其他印刷版本
            </p>
          )}
          {/* 删除此卡牌 */}
          {switchCard && (
            <div className="border-t pt-3 mt-3">
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                disabled={deletingCard === switchCard.id}
                onClick={() => {
                  if (confirm(`确定要从套牌中删除「${switchCard.card_name}」吗？`)) {
                    onDeleteCard(switchCard.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deletingCard === switchCard.id ? "删除中..." : "从套牌中删除此卡牌"}
              </Button>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}