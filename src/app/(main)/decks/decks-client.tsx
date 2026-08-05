"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo, type ReactNode } from "react";
import { useToast } from "@/lib/toast-context";
import { preloadData, getPreloadedData, preloadDialogChunks } from "@/lib/preload";
import { useDisplayMode } from "@/lib/display-mode";
import { CardImage } from "@/components/card-image";
import { useDecks, type DecksResponse } from "@/lib/swr-hooks";
import { useDeckLayout } from "@/lib/deck-layout";
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
import { Upload, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw, Loader2, Palette, Lightbulb, AlertTriangle, Heart, Check, MoreHorizontal } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
import type { Deck, CardEntry, DeckStats, Printing } from "@/types";
import { getNextDeckStatus } from "@/lib/match-utils";
import VersionSwitchDialog from "./version-switch-dialog";

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

/** 合并相同卡牌（同名+同系列+同编号+同状态），返回 { card, count, ids } */
function mergeIdenticalCards(
  cardList: CardEntry[]
): Array<{ card: CardEntry; count: number; ids: string[] }> {
  // 合并 key 包含 status，不同状态的卡牌分开显示
  const key = (c: CardEntry) => `${c.card_name}|${c.set_code}|${c.collector_number}|${c.status ?? 0}`;
  const groups = new Map<string, { card: CardEntry; count: number; ids: string[] }>();

  for (const card of cardList) {
    const k = key(card);
    const existing = groups.get(k);
    if (existing) {
      existing.count++;
      existing.ids.push(card.id);
    } else {
      groups.set(k, { card, count: 1, ids: [card.id] });
    }
  }

  return Array.from(groups.values());
}

// ─── 页面组件 ──────────────────────────────────────────────

interface DecksClientProps {
  fallbackDecks?: Deck[];
  fallbackStats?: Record<string, DeckStats>;
  fallbackCards?: Record<string, CardEntry[]>;
}

export default function DecksClient({
  fallbackDecks,
  fallbackStats,
  fallbackCards,
}: DecksClientProps = {}) {
  // 使用服务端预取数据作为 SWR fallback，首屏零加载
  const fallbackData =
    fallbackDecks !== undefined
      ? { success: true, decks: fallbackDecks, stats: fallbackStats || {} }
      : undefined;
  const { decks, stats: deckStats, revalidate, isLoading } = useDecks(fallbackData);

  // 页面加载后空闲时预加载弹窗 chunk，后续打开弹窗零等待
  useEffect(() => {
    preloadDialogChunks();
  }, []);

  // 导入表单状态
  const [showImport, setShowImport] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckText, setDeckText] = useState("");
  const [importing, setImporting] = useState(false);

  // Toast 通知
  const { toast: showToast } = useToast();
  const { mode: displayMode } = useDisplayMode();
  const { layout: deckLayout } = useDeckLayout();

  // 导入失败卡牌的手动重试
  const [failedCards, setFailedCards] = useState<
    Array<{ name: string; setCode: string; collectorNumber: string }>
  >([]);
  const [retryingDeckId, setRetryingDeckId] = useState<string | null>(null);
  const [retryingCard, setRetryingCard] = useState<string | null>(null);

  // 展开的套牌 + 卡牌数据（用服务端预取数据初始化，展开套牌时零加载）
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardEntry[]>>(fallbackCards || {});
  const [cardsLoading, setCardsLoading] = useState(false);

  // Ref 锁定最新状态，让回调函数保持引用稳定（配合 React.memo 减少重渲染）
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const expandedDeckRef = useRef(expandedDeck);
  expandedDeckRef.current = expandedDeck;

  // SWR 数据的 ref：mutate(updater, false) 在 revalidateOnMount:false + fallbackData 场景下
  // updater 收到的是 undefined（fallbackData 不写入 SWR 缓存），需要用 ref 获取当前数据
  const swrDataRef = useRef<DecksResponse | undefined>(
    fallbackData
  );
  swrDataRef.current = { success: true, decks, stats: deckStats };

  // 添加卡牌弹窗
  const [addCardsOpen, setAddCardsOpen] = useState<string | null>(null);
  const [addCardsText, setAddCardsText] = useState("");
  const [addCardsLoading, setAddCardsLoading] = useState(false);

  // 切换印刷版本弹窗
  const [switchCard, setSwitchCard] = useState<CardEntry | null>(null);
  const [switchCardAllIds, setSwitchCardAllIds] = useState<string[]>([]);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [switchPrintingLoading, setSwitchPrintingLoading] = useState<string | null>(null);
  const [deletingCard, setDeletingCard] = useState<string | null>(null);

  // 批量修改确认弹窗（独立模式下，卡牌有副本时弹出）
  const [batchConfirmCard, setBatchConfirmCard] = useState<{
    card: CardEntry;
    allIds: string[];
    singleId: string;
  } | null>(null);

  // ─── 展开/收起套牌 ──────────────────────────────────────

  const toggleDeck = useCallback(async (deckId: string) => {
    if (expandedDeckRef.current === deckId) {
      setExpandedDeck(null);
      return;
    }

    setExpandedDeck(deckId);

    if (!cardsRef.current[deckId]) {
      setCardsLoading(true);
      try {
        const res = await fetch(`/api/cards?deckId=${encodeURIComponent(deckId)}`);
        const data = await res.json();
        if (data.success && data.cards) {
          setCards((prev) => ({ ...prev, [deckId]: data.cards }));
        }
      } catch {
        showToast("加载卡牌失败，请重试", "error");
      }
      setCardsLoading(false);
    }
  }, [showToast]);

  // ─── 删除套牌 ──────────────────────────────────────────

  const deleteDeck = useCallback(async (deckId: string, deckName: string) => {
    if (!confirm(`确定删除套牌「${deckName}」吗？此操作不可撤销`)) return;

    try {
      const res = await fetch(`/api/decks?deckId=${encodeURIComponent(deckId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || "删除失败，请重试", "error");
        return;
      }
    } catch {
      showToast("网络错误，请重试", "error");
      return;
    }

    // 删除后刷新 SWR 缓存（服务端返回最新数据）
    revalidate();
    setCards((prev) => {
      const next = { ...prev };
      delete next[deckId];
      return next;
    });
    if (expandedDeckRef.current === deckId) setExpandedDeck(null);
    showToast("套牌已删除", "success");
  }, [showToast, revalidate]);

  /** 打开"添加卡牌"弹窗（稳定引用，供 memo 子组件使用） */
  const openAddCards = useCallback((deckId: string) => {
    setAddCardsOpen(deckId);
    setAddCardsText("");
  }, []);

  // ─── 导入套牌 ──────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!deckName.trim()) {
      showToast("请输入套牌名称", "error");
      return;
    }
    if (!deckText.trim()) {
      showToast("请粘贴牌表内容", "error");
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
        const hasFailures = (data.failCount ?? 0) > 0;
        let msg = hasFailures
          ? `「${deckName}」${data.successCount}/${data.total} 张导入成功，${data.failCount} 张可尝试搜索`
          : `「${deckName}」导入成功，共 ${data.successCount} 张`;

        showToast(msg, "success");

        // 合并失败和超时卡牌，供手动重试
        const allFailed = [
          ...(data.failedCards || []),
          ...(data.timedOutCards || []),
        ];
        if (allFailed.length > 0) {
          setFailedCards(allFailed);
          setRetryingDeckId(data.deckId);
        } else {
          setFailedCards([]);
          setRetryingDeckId(null);
        }

        setDeckName("");
        setDeckText("");
        setShowImport(false);
        await revalidate();
      } else {
        showToast(data.error, "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setImporting(false);
    }
  }, [deckName, deckText, revalidate]);

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
        if (data.note) {
          showToast(`「${cardName}」导入成功（版本不同，请核对）`, "success");
        } else {
          showToast(`「${cardName}」导入成功`, "success");
        }
        // 并行刷新：decks 列表 + 当前展开套牌的卡牌（原先串行）
        const refreshCards = expandedDeck === retryingDeckId
          ? fetch(`/api/cards?deckId=${encodeURIComponent(retryingDeckId)}`)
              .then((r) => r.json())
              .then((d) => {
                if (d.success && d.cards) {
                  setCards((prev) => ({ ...prev, [retryingDeckId]: d.cards }));
                }
              })
              .catch(() => {})
          : Promise.resolve();
        await Promise.all([revalidate(), refreshCards]);
      } else {
        showToast(`${cardName}: ${data.error}`, "error");
      }
    } catch {
      showToast(`${cardName}: 网络错误，请重试`, "error");
    } finally {
      setRetryingCard(null);
    }
  }, [retryingDeckId, expandedDeck, revalidate]);

  // ─── 三态切换 ──────────────────────────────────────────

  const toggleStatus = useCallback((cardIdOrIds: string | string[], currentStatus: number, deckId: string) => {
    // 支持单卡与批量：合并模式下同款多张卡牌一次请求完成
    const cardIds = Array.isArray(cardIdOrIds) ? cardIdOrIds : [cardIdOrIds];
    if (cardIds.length === 0) return;
    const idSet = new Set(cardIds);
    const newStatus = getNextDeckStatus(currentStatus);

    // 记录旧卡牌数据，用于回滚时恢复全部字段（含 event_name/event_date）
    const oldCards = new Map<string, CardEntry>();
    for (const c of cardsRef.current[deckId] || []) {
      if (idSet.has(c.id)) oldCards.set(c.id, c);
    }
    const firstOldCard = oldCards.get(cardIds[0]);

    // 1. 乐观更新：立即更新 UI，用户零延迟感知
    // 切换到非心动状态时清除活动信息
    const newCardPatch: Partial<CardEntry> = {
      status: newStatus,
      is_signed: newStatus === 2,
    };
    if (newStatus !== 3) {
      newCardPatch.event_name = null;
      newCardPatch.event_date = null;
    }

    setCards((prev) => {
      const updated = { ...prev };
      if (updated[deckId]) {
        updated[deckId] = updated[deckId].map((c) =>
          idSet.has(c.id) ? { ...c, ...newCardPatch } : c
        );
      }
      return updated;
    });

    // 乐观更新 SWR 缓存中的统计（不触发服务端请求）
    // 注意：SWR v2 中 fallbackData 不写入缓存，mutate(updater, false) 的 updater
    // 在 revalidateOnMount:false 场景下收到 undefined，必须用 mutate(data, false) 直接设置
    const applyStatsDelta = (stats: Record<string, DeckStats>, fromStatus: number, toStatus: number, times: number) => {
      if (!stats[deckId]) return stats;
      const delta: Record<number, { u: number; p: number; h: number }> = {
        0: { u: 1, p: 0, h: 0 },
        1: { u: 0, p: 1, h: 0 },
        2: { u: 0, p: 0, h: 0 },
        3: { u: 0, p: 0, h: 1 },
      };
      const old = delta[fromStatus] ?? { u: 0, p: 0, h: 0 };
      const now = delta[toStatus] ?? { u: 0, p: 0, h: 0 };
      return {
        ...stats,
        [deckId]: {
          ...stats[deckId],
          unsigned: stats[deckId].unsigned + (now.u - old.u) * times,
          pending: stats[deckId].pending + (now.p - old.p) * times,
          heart: (stats[deckId].heart ?? 0) + (now.h - old.h) * times,
        },
      };
    };

    const times = cardIds.length;
    // 用 ref 中的当前数据构建乐观更新后的完整数据，直接 mutate(data, false)
    const currentSWRData = swrDataRef.current;
    if (currentSWRData) {
      const newStats = applyStatsDelta({ ...currentSWRData.stats }, currentStatus, newStatus, times);
      revalidate({ ...currentSWRData, stats: newStats }, false);
    }

    // 2. 后台写入数据库（单请求批量），失败则回滚 UI
    fetch("/api/cards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardIds,
        status: newStatus,
        is_signed: newStatus === 2,
        event_name: newStatus === 3 && firstOldCard?.event_name ? firstOldCard.event_name : null,
        event_date: newStatus === 3 && firstOldCard?.event_date ? firstOldCard.event_date : null,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          // 回滚到旧状态（恢复全部字段）
          setCards((prev) => {
            const updated = { ...prev };
            if (updated[deckId]) {
              updated[deckId] = updated[deckId].map((c) =>
                oldCards.get(c.id) ?? c
              );
            }
            return updated;
          });
          const rollbackData = swrDataRef.current;
          if (rollbackData) {
            const rollbackStats = applyStatsDelta({ ...rollbackData.stats }, newStatus, currentStatus, times);
            revalidate({ ...rollbackData, stats: rollbackStats }, false);
          }
          showToast(data.error || "状态更新失败，请重试", "error");
        }
      })
      .catch(() => {
        // 网络异常，回滚（恢复全部字段）
        setCards((prev) => {
          const updated = { ...prev };
          if (updated[deckId]) {
            updated[deckId] = updated[deckId].map((c) =>
              oldCards.get(c.id) ?? c
            );
          }
          return updated;
        });
        const rollbackData = swrDataRef.current;
        if (rollbackData) {
          const rollbackStats = applyStatsDelta({ ...rollbackData.stats }, newStatus, currentStatus, times);
          revalidate({ ...rollbackData, stats: rollbackStats }, false);
        }
        showToast("网络错误，状态已恢复", "error");
      });
  }, [showToast, revalidate]);

  // ─── 添加卡牌到套牌 ──────────────────────────────────

  const handleAddCards = useCallback(async () => {
    if (!addCardsOpen || !addCardsText.trim()) {
      showToast("请粘贴牌表内容", "error");
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
        const hasFailures = (data.failCount ?? 0) > 0;
        let msg = hasFailures
          ? `${data.successCount}/${data.total} 张追加成功，${data.failCount} 张可尝试搜索`
          : `追加成功，共 ${data.successCount} 张`;
        showToast(msg, "success");
        setAddCardsOpen(null);
        setAddCardsText("");
        // 并行刷新：decks 列表 + 当前展开套牌的卡牌（原先串行）
        const refreshCards = expandedDeck === addCardsOpen
          ? fetch(`/api/cards?deckId=${encodeURIComponent(addCardsOpen)}`)
              .then((r) => r.json())
              .then((d) => {
                if (d.success && d.cards) {
                  setCards((prev) => ({ ...prev, [addCardsOpen]: d.cards }));
                }
              })
              .catch(() => {})
          : Promise.resolve();
        await Promise.all([revalidate(), refreshCards]);
      } else {
        showToast(data.error, "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setAddCardsLoading(false);
    }
  }, [addCardsOpen, addCardsText, expandedDeck, revalidate]);

  // ─── 加载卡牌所有印刷版本 ──────────────────────────────

  const proceedLoadPrintings = useCallback(async (card: CardEntry, allIds: string[]) => {
    setSwitchCard(card);
    setSwitchCardAllIds(allIds);
    setPrintings([]);
    setPrintingsLoading(true);

    try {
      // 优先取 hover 预加载的缓存数据（命中时零延迟）
      const data = await getPreloadedData<{ success: boolean; printings?: Printing[]; error?: string }>(
        `/api/card-printings?name=${encodeURIComponent(card.card_name)}`
      );

      if (data.success) {
        setPrintings(data.printings || []);
      } else {
        showToast(`加载印刷版本失败: ${data.error}`, "error");
        setSwitchCard(null);
        setSwitchCardAllIds([]);
      }
    } catch {
      showToast("网络错误，请重试", "error");
      setSwitchCard(null);
      setSwitchCardAllIds([]);
    } finally {
      setPrintingsLoading(false);
    }
  }, [showToast]);

  const loadPrintings = useCallback(async (card: CardEntry, allIds?: string[]) => {
    const ids = allIds && allIds.length > 0 ? allIds : [card.id];

    // 独立模式下（只有 1 张），检查套牌中是否有同款卡牌副本
    if (ids.length === 1) {
      const deckId = card.deck_id;
      const deckCards = cardsRef.current[deckId];
      if (deckCards) {
        const duplicates = deckCards.filter(
          (c) => c.card_name === card.card_name && c.id !== card.id
        );
        if (duplicates.length > 0) {
          setBatchConfirmCard({
            card,
            allIds: [card.id, ...duplicates.map((c) => c.id)],
            singleId: card.id,
          });
          return;
        }
      }
    }

    // 无副本或合并模式，直接加载
    proceedLoadPrintings(card, ids);
  }, [proceedLoadPrintings]);

  // 批量修改确认回调
  function handleBatchConfirm(batch: boolean) {
    if (!batchConfirmCard) return;
    const { card, allIds, singleId } = batchConfirmCard;
    setBatchConfirmCard(null);
    proceedLoadPrintings(card, batch ? allIds : [singleId]);
  }

  // ─── 切换印刷版本 ──────────────────────────────────────

  async function handleSwitchPrinting(cardId: string, setCode: string, collectorNumber: string) {
    const allIds = switchCardAllIds.length > 0 ? switchCardAllIds : [cardId];
    setSwitchPrintingLoading(cardId);
    try {
      const res = await fetch("/api/switch-printing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardIds: allIds, setCode, collectorNumber }),
      });

      const data = await res.json();

      if (data.success) {
        const countSuffix = allIds.length > 1 ? `（共 ${allIds.length} 张）` : "";
        showToast(
          `已切换为 ${data.newSet} #${data.newCollectorNumber}${countSuffix}`,
          "success",
        );

        const deckId = switchCard?.deck_id;
        if (deckId) {
          setCards((prev) => {
            const updated = { ...prev };
            if (updated[deckId]) {
              const idSet = new Set(allIds);
              updated[deckId] = updated[deckId].map((c) =>
                idSet.has(c.id)
                  ? {
                      ...c,
                      set_code: data.newSetCode,
                      collector_number: data.newCollectorNumber,
                      artist_names: data.newArtistNames,
                      image_url: data.newImageUrl,
                    }
                  : c
              );
              // 切换版本后画家可能变化，重新按 artist_names 字母序排序
              updated[deckId] = [...updated[deckId]].sort((a, b) =>
                (a.artist_names[0] || "").localeCompare(b.artist_names[0] || "")
              );
            }
            return updated;
          });
        }
        setSwitchCard(null);
        setSwitchCardAllIds([]);
        setPrintings([]);
      } else {
        showToast(`切换失败: ${data.error}`, "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setSwitchPrintingLoading(null);
    }
  }

  // ─── 删除卡牌 ──────────────────────────────────────────

  async function handleDeleteCard(cardId: string) {
    setDeletingCard(cardId);
    try {
      const res = await fetch(`/api/cards?cardId=${encodeURIComponent(cardId)}`, { method: "DELETE" });
      const data = await res.json();

      if (!data.success) {
        showToast(data.error || "删除失败", "error");
        return;
      }

      showToast("卡牌已删除", "success");

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
      setSwitchCardAllIds([]);
      setPrintings([]);
      await revalidate();
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setDeletingCard(null);
    }
  }

  // ─── 渲染 ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">套牌管理</h1>
          <p className="text-muted-foreground">管理你的套牌与签绘清单</p>
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
              导入你的套牌，自动识别画家信息
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deckName">套牌名称</Label>
              <Input
                id="deckName"
                placeholder=""
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">牌表内容</Label>
              <Textarea
                id="text"
                placeholder={"粘贴纯文本套牌，支持多种格式，例如：\n1 Sol Ring (SLD) 1494\n1 Arcane Signet\n\n"}
                rows={8}
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>操作提示：<br />
                1. 推荐使用 Moxfield 网站，将牌表修改为实际持有的版本，选择 Copy for Moxfield 格式导入套牌<br />
                2. 无系列/编号信息的格式，导入时将随机选取卡牌版本，导入后点击卡牌右上角图标可随时切换版本
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    导入中...
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
            <CardTitle className="text-base flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {failedCards.length} 张卡牌未找到
            </CardTitle>
            <CardDescription>
              未精确匹配到以下卡牌，可尝试搜索<br />
              搜索可能返回不同版本，请核对
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
                    {retryingCard === card.name ? "搜索中..." : "尝试搜索"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 套牌列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">加载套牌...</span>
        </div>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">暂无套牌数据，点击上方「导入套牌」开始吧</p>
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
              displayMode={displayMode}
              deckLayout={deckLayout}
              onToggle={toggleDeck}
              onAddCards={openAddCards}
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
          <DialogTitle>添加卡牌</DialogTitle>
          <DialogDescription>
            向当前套牌添加卡牌，自动识别画家信息
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addCardsText">牌表内容</Label>
            <Textarea
              id="addCardsText"
              placeholder={"粘贴纯文本套牌，支持多种格式，例如：\n1 Sol Ring (SLD) 1494\n1 Arcane Signet\n\n"}
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

      {/* ─── 切换印刷版本弹窗（懒加载，打开时才下载 chunk）─── */}
      {switchCard !== null && (
        <VersionSwitchDialog
          switchCard={switchCard}
          printings={printings}
          printingsLoading={printingsLoading}
          switchPrintingLoading={switchPrintingLoading}
          deletingCard={deletingCard}
          onClose={() => { setSwitchCard(null); setSwitchCardAllIds([]); setPrintings([]); }}
          onSwitchPrinting={handleSwitchPrinting}
          onDeleteCard={handleDeleteCard}
        />
      )}

      {/* ─── 批量修改确认弹窗 ─── */}
      <BatchConfirmDialog
        confirmCard={batchConfirmCard}
        onConfirm={(batch) => handleBatchConfirm(batch)}
        onCancel={() => setBatchConfirmCard(null)}
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
  displayMode: "individual" | "grouped";
  deckLayout: "default" | "compact" | "list";
  onToggle: (deckId: string) => void;
  onAddCards: (deckId: string) => void;
  onDelete: (deckId: string, deckName: string) => void;
  onToggleStatus: (cardIds: string | string[], currentStatus: number, deckId: string) => void;
  onLoadPrintings: (card: CardEntry, allIds?: string[]) => void;
}

const DeckListItem = memo(function DeckListItem({
  deck, stats, isExpanded, cards, cardsLoading, displayMode, deckLayout,
  onToggle, onAddCards, onDelete, onToggleStatus, onLoadPrintings,
}: DeckListItemProps) {
  // 分组 + 合并计算成本高（数百张卡牌），只在数据变化时重算
  const artistGroups = useMemo(
    () =>
      Array.from(groupCardsByArtist(cards || [])).map(([artist, artistCards]) => ({
        artist,
        artistCards,
        displayCards:
          displayMode === "grouped"
            ? mergeIdenticalCards(artistCards)
            : artistCards.map((c) => ({ card: c, count: 1, ids: [c.id] })),
      })),
    [cards, displayMode]
  );

  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-accent/50 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="button"
        tabIndex={0}
        onClick={() => onToggle(deck.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(deck.id); } }}
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
                    <span>共 {stats.total} 张</span>
                    {stats.unsigned > 0 && <span> · {stats.unsigned} 待签</span>}
                    {stats.pending > 0 && <span> · {stats.pending} 送签中</span>}
                    {stats.total - stats.unsigned - stats.heart - stats.pending > 0 &&
                      <span> · {stats.total - stats.unsigned - stats.heart - stats.pending} 已签</span>}
                    <br />
                    签绘进度 {stats.total > 0 ? Math.round(((stats.total - stats.unsigned - stats.heart - stats.pending) / stats.total) * 100) : 0}% · 上次更新 {new Date(deck.created_at!).toLocaleDateString("zh-CN")}
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
              aria-label="添加卡牌"
              onClick={(e) => { e.stopPropagation(); onAddCards(deck.id); }}
            >
              <Plus className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="删除套牌"
              aria-label="删除套牌"
              onClick={(e) => { e.stopPropagation(); onDelete(deck.id, deck.name); }}
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
              <span className="text-sm">加载中...</span>
            </div>
          ) : cards?.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无卡牌</p>
          ) : (
            <div className={deckLayout === "compact" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 sm:gap-y-4" : deckLayout === "list" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4" : "space-y-4"}>
              <p className="text-xs text-muted-foreground flex items-center gap-1 col-span-full">
                <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                点击卡牌可切换状态：未签 → 送签中 → 已签
              </p>
              {artistGroups.map(({ artist, artistCards, displayCards }) => {
                // 文本视图
                if (deckLayout === "list") {
                  return (
                    <div key={artist}>
                      <h4 className="text-base font-semibold mb-1.5 text-foreground/80 tracking-wide">
                        {artist}
                        <span className="text-muted-foreground font-normal ml-1">({artistCards.length})</span>
                      </h4>
                      <div className="rounded-lg border border-border/60 overflow-hidden">
                        {displayCards.map((group, idx) => {
                          const s = group.card.status ?? (group.card.is_signed ? 2 : 0);
                          const statusConfig: Record<number, { label: string; bg: string; text: string; dot: string }> = {
                            0: { label: "未签", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
                            1: { label: "送签中", bg: "bg-blue-50 dark:bg-blue-950", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
                            2: { label: "已签", bg: "bg-green-50 dark:bg-green-950", text: "text-green-600 dark:text-green-400", dot: "bg-green-500" },
                            3: { label: "心动", bg: "bg-pink-50 dark:bg-pink-950", text: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
                          };
                          const cfg = statusConfig[s] || statusConfig[0];
                          return (
                            <div
                              key={group.ids[0]}
                              className={"flex items-center gap-3 px-3 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer group/list " + (idx !== displayCards.length - 1 ? "border-b border-border/40" : "")}
                              onClick={() => {
                                const ids = group.ids.length > 0 ? group.ids : [group.card.id];
                                onToggleStatus(ids, s, deck.id);
                              }}
                            >
                              <span className={"inline-flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded text-xs font-medium " + cfg.bg + " " + cfg.text}>
                                <span className={"w-1.5 h-1.5 rounded-full " + cfg.dot} />
                                {cfg.label}
                              </span>
                              <span className="text-sm truncate">
                                {group.card.card_name}
                              </span>
                              {group.count > 1 && (
                                <span className="text-sm text-muted-foreground shrink-0">×{group.count}</span>
                              )}
                              <span className="text-xs text-muted-foreground shrink-0 font-mono ml-auto hidden sm:inline">
                                {group.card.set_code.toUpperCase()} #{group.card.collector_number}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // 网格视图（默认 & 紧凑）
                return (
                  <div key={artist}>
                    <h4 className={"text-base font-medium flex items-center gap-1 " + (deckLayout === "compact" ? "mb-1 sm:mb-1.5 truncate" : "mb-2")}>
                      <Palette className={"h-4 w-4 text-foreground shrink-0 " + (deckLayout === "compact" ? "hidden sm:block" : "")} />{artist} ({artistCards.length})
                    </h4>
                    <div className={deckLayout === "compact" ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 sm:gap-1.5 lg:gap-2" : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4"}>
                      {displayCards.map((group) => (
                        <CardThumbnail
                          key={group.ids[0]}
                          card={group.card}
                          count={group.count}
                          allIds={group.ids}
                          deckId={deck.id}
                          deckLayout={deckLayout}
                          onToggleStatus={onToggleStatus}
                          onLoadPrintings={onLoadPrintings}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
});

// ─── 卡牌缩略图 ──────────────────────────────────────────

interface CardThumbnailProps {
  card: CardEntry;
  deckId: string;
  /** 同款卡牌数量（合并模式下 >1） */
  count?: number;
  /** 合并模式下所有卡牌 ID，用于批量切换状态 */
  allIds?: string[];
  deckLayout?: "default" | "compact" | "list";
  onToggleStatus: (cardIds: string | string[], currentStatus: number, deckId: string) => void;
  onLoadPrintings: (card: CardEntry, allIds?: string[]) => void;
}

const CardThumbnail = memo(function CardThumbnail({ card, deckId, count = 1, allIds, deckLayout, onToggleStatus, onLoadPrintings }: CardThumbnailProps) {
  const status = card.status ?? (card.is_signed ? 2 : 0);
  const statusLabels: Record<number, string> = {
    0: "未签（点击切换为送签中）",
    1: "送签中（点击切换为已签）",
    2: "已签（点击切换为未签）",
    3: "心动（点击切换为未签）",
  };
  const hasOverlay = status >= 1;
  const overlayColor: Record<number, string> = { 1: "bg-blue-500", 2: "bg-green-500", 3: "bg-pink-500" };
  const overlayIcon: Record<number, ReactNode> = { 1: <MoreHorizontal className="h-4 w-4" />, 2: <Check className="h-4 w-4" />, 3: <Heart className="h-4 w-4" /> };
  const isCompact = deckLayout === "compact";

  /** 点击切换状态：合并模式下一次批量请求切换所有同款卡牌 */
  function handleToggle() {
    const ids = allIds && allIds.length > 0 ? allIds : [card.id];
    onToggleStatus(ids, status, deckId);
  }

  return (
    <div className={isCompact ? "group relative w-full" : "group relative w-full"}>
      <div
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); } }}
        role="button"
        tabIndex={0}
        className={"relative rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (hasOverlay ? (status === 3 ? "border-pink-400" : status === 1 ? "border-blue-400" : "border-green-500") : "border-border hover:shadow-md")}
        title={statusLabels[status]}
        aria-label={`${card.card_name}，${statusLabels[status]}`}
      >
        <div className={hasOverlay ? "opacity-75" : ""}>
          {card.image_url ? (
            <CardImage src={card.image_url} alt={card.card_name} className="w-full" />
          ) : (
            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {card.card_name}
            </div>
          )}
        </div>

        {hasOverlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={(isCompact ? "w-7 h-7 sm:w-8 sm:h-8" : "w-8 h-8") + " rounded-full flex items-center justify-center text-white shadow-lg " + (overlayColor[status] || "bg-blue-500") + (!card.event_name ? " -translate-y-2" : "")}>
              {overlayIcon[status] || <MoreHorizontal className="h-4 w-4" />}
            </div>
          </div>
        )}

        {/* 底部信息条 — 有活动时双行（活动名 + 卡牌名），无活动时单行卡牌名 */}
        {card.event_name ? (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div className={(status === 3 ? "bg-pink-500/90" : "bg-black/75") + " text-white text-xs px-1 py-0.5 text-center leading-tight truncate"}>
              {card.event_name}
            </div>
            <div className="bg-black/80 text-white text-xs px-1 py-0.5 text-center leading-tight truncate">
              {card.card_name}
            </div>
          </div>
        ) : (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-1 py-0.5 text-center leading-tight truncate">
            {card.card_name}
          </div>
        )}
      </div>

      {/* 合并按钮：数量 + 切换版本 — 右上角，圆角与卡牌一致 */}
      <button
        onClick={(e) => { e.stopPropagation(); onLoadPrintings(card, allIds); }}
        onMouseEnter={() => preloadData(`/api/card-printings?name=${encodeURIComponent(card.card_name)}`)}
        className={"absolute top-0.5 right-0.5 z-20 " + (isCompact ? "h-5 sm:h-6" : "h-6") + " bg-background/80 border border-border shadow-sm flex items-center justify-center gap-0.5 px-1 rounded-lg hover:bg-accent hover:scale-105 transition-all"}
        title="切换印刷版本"
        aria-label={`切换 ${card.card_name} 的印刷版本`}
      >
        {count > 1 && (
          <span className="text-xs font-bold text-foreground leading-tight">×{count}</span>
        )}
        <RefreshCw className={(isCompact ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5") + " text-foreground"} />
      </button>
    </div>
  );
});

// ─── 批量修改确认弹窗 ────────────────────────────────────

interface BatchConfirmDialogProps {
  confirmCard: {
    card: CardEntry;
    allIds: string[];
    singleId: string;
  } | null;
  onConfirm: (batch: boolean) => void;
  onCancel: () => void;
}

function BatchConfirmDialog({ confirmCard, onConfirm, onCancel }: BatchConfirmDialogProps) {
  if (!confirmCard) return null;
  const { allIds } = confirmCard;
  const duplicateCount = allIds.length;

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogHeader>
        <DialogTitle>批量修改卡牌版本？</DialogTitle>
        <DialogDescription>
          此卡牌在套牌中有 {duplicateCount} 张，是否批量切换为同一版本？
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex items-center gap-3">
          <Button variant="default" onClick={() => onConfirm(true)}>
            全部修改（{duplicateCount} 张）
          </Button>
          <Button variant="outline" onClick={() => onConfirm(false)}>
            仅改这一张
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

