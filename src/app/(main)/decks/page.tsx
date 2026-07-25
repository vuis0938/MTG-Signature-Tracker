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
import { Upload, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";

interface Deck {
  id: string;
  name: string;
  source: string;
  created_at: string;
}

interface DeckStats {
  total: number;
  unsigned: number;
  pending: number;
}

interface CardEntry {
  id: string;
  deck_id: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  artist_names: string[];
  image_url: string | null;
  is_signed: boolean;
  status: number; // 0=未签, 1=送签中, 2=已签, 3=心动
  event_name?: string | null;
  event_date?: string | null;
}

export default function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckStats, setDeckStats] = useState<Record<string, DeckStats>>({});
  const [loading, setLoading] = useState(true);

  // 导入表单状态
  const [showImport, setShowImport] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckText, setDeckText] = useState("");
  const [importing, setImporting] = useState(false);

  // Toast 通知
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(
    null
  );

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
  const [addCardsOpen, setAddCardsOpen] = useState<string | null>(null); // deckId
  const [addCardsText, setAddCardsText] = useState("");
  const [addCardsLoading, setAddCardsLoading] = useState(false);

  // 切换印刷版本弹窗
  const [switchCard, setSwitchCard] = useState<CardEntry | null>(null);
  const [printings, setPrintings] = useState<Array<{
    set: string;
    set_name: string;
    collector_number: string;
    artist: string;
    image_url: string | null;
    released_at: string;
  }>>([]);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [switchPrintingLoading, setSwitchPrintingLoading] = useState<string | null>(null);

  // 加载套牌列表 + 每套牌的统计
  const loadDecks = useCallback(async () => {
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .eq("user_name", getCurrentUser())
      .order("created_at", { ascending: false });

    if (!error && data) {
      setDecks(data);

      // 并发获取每套牌的计数
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

  // 展开/收起套牌详情
  async function toggleDeck(deckId: string) {
    if (expandedDeck === deckId) {
      setExpandedDeck(null);
      return;
    }

    setExpandedDeck(deckId);

    // 如果还没加载过这个套牌的卡牌，加载之
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

  // 删除套牌
  async function deleteDeck(deckId: string) {
    if (!confirm("确定要删除这套牌吗？所有卡牌数据将被永久删除。")) return;

    await supabase.from("decks").delete().eq("id", deckId);
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setCards((prev) => {
      const next = { ...prev };
      delete next[deckId];
      return next;
    });
    if (expandedDeck === deckId) setExpandedDeck(null);
  }

  // 导入套牌
  async function handleImport() {
    if (!deckName.trim()) {
      setToast({ message: "请输入套牌名称", type: "error" });
      return;
    }
    if (!deckText.trim()) {
      setToast({ message: "请粘贴 Moxfield 牌表内容", type: "error" });
      return;
    }

    setImporting(true);

    try {
      const res = await fetch("/api/import-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deckName, text: deckText }),
      });

      const data = await res.json();

      if (data.success) {
        const t = data.timing;
        const hasFailures = data.failCount > 0;
        const msg =
          `✅ 「${deckName}」${data.successCount}/${data.total} 张成功` +
          (hasFailures ? `，${data.failCount} 张未找到` : "") +
          ` | ${t.total}`;

        setToast({ message: msg, type: hasFailures ? "error" : "success" });

        // 保存失败卡牌供手动重试
        if (hasFailures && data.failedCards) {
          setFailedCards(data.failedCards);
          setRetryingDeckId(data.deckId);
        } else {
          setFailedCards([]);
          setRetryingDeckId(null);
        }

        setDeckName("");
        setDeckText("");
        setShowImport(false);
        await loadDecks();
      } else {
        setToast({ message: data.error, type: "error" });
      }
    } catch {
      setToast({ message: "网络错误，请重试", type: "error" });
    } finally {
      setImporting(false);
    }
  }

  // 手动重试单张卡牌（模糊搜索）
  async function retryCard(cardName: string, setCode: string, collectorNumber: string) {
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
        // 从失败列表移除
        setFailedCards((prev) => prev.filter((c) => c.name !== cardName));
        const note = data.note ? `（${data.note}）` : "";
        setToast({
          message: `✅ 「${cardName}」通过模糊搜索成功录入${note}`,
          type: "success",
        });
        // 刷新
        await loadDecks();
        if (retryingDeckId && expandedDeck === retryingDeckId) {
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
  }

  // 三态切换：0=未签 → 1=送签中 → 2=已签 → 0=未签
  async function toggleStatus(cardId: string, currentStatus: number, deckId: string) {
    const newStatus = (currentStatus + 1) % 3;

    // 乐观更新本地状态
    setCards((prev) => {
      const updated = { ...prev };
      if (updated[deckId]) {
        updated[deckId] = updated[deckId].map((c) =>
          c.id === cardId ? { ...c, status: newStatus, is_signed: newStatus === 2 } : c
        );
      }
      return updated;
    });

    // 更新统计
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

    // 写入数据库
    await supabase
      .from("cards")
      .update({ status: newStatus, is_signed: newStatus === 2 })
      .eq("id", cardId);
  }

  // 按画家分组
  function groupCardsByArtist(cardList: CardEntry[]): Map<string, CardEntry[]> {
    const map = new Map<string, CardEntry[]>();
    for (const card of cardList) {
      const artists = card.artist_names;
      for (const artist of artists) {
        const existing = map.get(artist) || [];
        existing.push(card);
        map.set(artist, existing);
      }
    }
    return map;
  }

  // ─── 添加卡牌到套牌 ───
  async function handleAddCards() {
    if (!addCardsOpen || !addCardsText.trim()) {
      setToast({ message: "请粘贴 Moxfield 牌表内容", type: "error" });
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
        const msg =
          `✅ 添加 ${data.successCount}/${data.total} 张成功` +
          (hasFailures ? `，${data.failCount} 张未找到` : "");

        setToast({ message: msg, type: hasFailures ? "error" : "success" });
        setAddCardsOpen(null);
        setAddCardsText("");
        await loadDecks();
        // 刷新展开的卡牌
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
  }

  // ─── 加载卡牌所有印刷版本 ───
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

  // ─── 切换印刷版本 ───
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

        // 更新本地状态
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
            if (!showImport) {
              setDeckName("");
              setDeckText("");
            }
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
            <CardTitle>导入 Moxfield 套牌</CardTitle>
            <CardDescription>
              从 Moxfield 导入套牌数据，自动匹配每张卡牌的画家信息
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
                placeholder={`粘贴 Copy for Moxfield 的内容，格式如下：
1 Sol Ring (CMM) 345
1 Arcane Signet (ELD) 314
1 Command Tower (CMR) 350 *F*
...`}
                rows={8}
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                💡 操作步骤：<br />
                1. 在 Moxfield 牌表页面，点击每张卡牌 → <b>Switch Printing</b> 切换为实际持有的印刷版本<br />
                2. 点击 <b>Export</b> → <b>Copy for Moxfield</b><br />
                3. 粘贴到上方文本框 → 点击「开始导入」<br />
                注意：卡牌印刷版本不同，对应的画家也可能不同，请务必逐一确认版本。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "导入中..." : "开始导入"}
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
                    <p className="text-xs text-muted-foreground">
                      {card.setCode} / {card.collectorNumber}
                    </p>
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
        <p className="text-muted-foreground text-center py-12">加载中...</p>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            暂无套牌数据，点击"导入套牌"开始
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <Card key={deck.id}>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 rounded-t-lg"
                onClick={() => toggleDeck(deck.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expandedDeck === deck.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <div>
                      <CardTitle className="text-base">
                        {deck.name}
                      </CardTitle>
                      <CardDescription>
                        {deckStats[deck.id] &&
                          `共 ${deckStats[deck.id].total} 张` +
                            (deckStats[deck.id].unsigned > 0
                              ? ` · ${deckStats[deck.id].unsigned} 待签`
                              : "") +
                            (deckStats[deck.id].pending > 0
                              ? ` · ${deckStats[deck.id].pending} 送签中`
                              : "") +
                            (deckStats[deck.id].total -
                              deckStats[deck.id].unsigned -
                              deckStats[deck.id].pending >
                            0
                              ? ` · ${deckStats[deck.id].total - deckStats[deck.id].unsigned - deckStats[deck.id].pending} 已签`
                              : "")}
                        <br />
                        上次更新时间：{new Date(deck.created_at).toLocaleDateString("zh-CN")}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="添加卡牌"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddCardsOpen(deck.id);
                        setAddCardsText("");
                      }}
                    >
                      <Plus className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDeck(deck.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {/* 展开的卡牌列表（按画家分组） */}
              {expandedDeck === deck.id && (
                <CardContent>
                  {cardsLoading ? (
                    <p className="text-muted-foreground text-sm">加载卡牌...</p>
                  ) : cards[deck.id]?.length === 0 ? (
                    <p className="text-muted-foreground text-sm">暂无卡牌</p>
                  ) : (
                    <div className="space-y-4">
                      {Array.from(
                        groupCardsByArtist(cards[deck.id] || [])
                      ).map(([artist, artistCards]) => (
                        <div key={artist}>
                          <h4 className="text-sm font-medium mb-2">
                            🎨 {artist} ({artistCards.length})
                          </h4>
                          <div className="flex flex-wrap gap-3">
                            {artistCards.map((card) => {
                              const status = card.status ?? (card.is_signed ? 2 : 0);
                              const statusLabels: Record<number, string> = {
                                0: "未签（点击切换为送签中）",
                                1: "送签中（点击切换为已签）",
                                2: "已签（点击切换为未签）",
                                3: "心动",
                              };
                              const hasOverlay = status >= 1;
                              const overlayColor: Record<number, string> = {
                                1: "bg-blue-500",
                                2: "bg-green-500",
                                3: "bg-pink-500",
                              };
                              const overlayIcon: Record<number, string> = {
                                1: "…",
                                2: "✓",
                                3: "♥",
                              };

                              return (
                                <div
                                  key={card.id}
                                  className="group relative w-24"
                                >
                                  <div
                                    onClick={() =>
                                      toggleStatus(card.id, status, deck.id)
                                    }
                                    className={`relative rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 ${
                                      hasOverlay
                                        ? status === 3 ? "border-pink-400" : status === 1 ? "border-blue-400" : "border-green-500"
                                        : "border-border hover:shadow-md"
                                    }`}
                                    title={statusLabels[status]}
                                  >
                                    {/* 心动活动标签 — 卡牌顶部 */}
                                    {status === 3 && card.event_name && (
                                      <div className="absolute top-0 left-0 right-0 z-10 bg-pink-500/90 text-white text-[9px] px-1 py-0.5 text-center leading-tight">
                                        ♥ {card.event_name}
                                        {card.event_date && ` · ${card.event_date}`}
                                      </div>
                                    )}

                                    {/* 卡图区域 — 仅这块半透明 */}
                                    <div className={hasOverlay ? "opacity-75" : ""}>
                                      {card.image_url ? (
                                        <img
                                          src={card.image_url}
                                          alt={card.card_name}
                                          className="w-full"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                                          {card.card_name}
                                        </div>
                                      )}
                                    </div>

                                    {/* 状态圆 — 保持完全不透明 */}
                                    {hasOverlay && (
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div
                                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${overlayColor[status] || "bg-blue-500"}`}
                                        >
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      loadPrintings(card);
                                    }}
                                    className="absolute -top-1 -right-1 z-20 w-5 h-5 rounded-full bg-background border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                                    title="切换印刷版本"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ─── 添加卡牌弹窗 ─── */}
      <Dialog open={addCardsOpen !== null} onOpenChange={() => setAddCardsOpen(null)}>
        <DialogHeader>
          <DialogTitle>添加卡牌到套牌</DialogTitle>
          <DialogDescription>
            粘贴 Copy for Moxfield 格式的牌表，将卡牌添加到当前套牌
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addCardsText">牌表内容</Label>
            <Textarea
              id="addCardsText"
              placeholder={`粘贴 Copy for Moxfield 的内容，格式如下：
1 Sol Ring (CMM) 345
1 Arcane Signet (ELD) 314
...`}
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
      <Dialog open={switchCard !== null} onOpenChange={() => { setSwitchCard(null); setPrintings([]); }}>
        <DialogHeader>
          <DialogTitle>切换印刷版本 — {switchCard?.card_name}</DialogTitle>
          <DialogDescription>
            当前版本：{switchCard?.set_code?.toUpperCase()} #{switchCard?.collector_number}
            {switchCard?.artist_names && ` · 画家：${switchCard.artist_names.join(", ")}`}
          </DialogDescription>
        </DialogHeader>
        {printingsLoading ? (
          <DialogContent>
            <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
          </DialogContent>
        ) : (
          <DialogContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
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
                        handleSwitchPrinting(switchCard.id, printing.set, printing.collector_number);
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
                      {isCurrent && (
                        <p className="text-primary font-medium mt-0.5">当前版本</p>
                      )}
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
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
