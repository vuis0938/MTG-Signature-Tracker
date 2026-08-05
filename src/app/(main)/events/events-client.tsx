"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, MapPin, Users, Loader2, Package, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/lib/swr-hooks";
import { preloadData, getPreloadedData, preloadDialogChunks } from "@/lib/preload";
import type { ArtistCard, CalendarEvent } from "@/types";

// ─── 懒加载弹窗：首屏不打包，首次打开时下载 chunk ────────────
// chunk 下载期间展示与数据加载一致的 spinner（当前打开弹窗本就有加载态，体验无差别）

function DialogChunkFallback() {
  return (
    <Dialog open onOpenChange={() => {}} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>加载中...</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="flex items-center justify-center overflow-y-auto pr-2 h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ArtistGalleryDialog = dynamic(() => import("@/components/artist-gallery-dialog"), {
  ssr: false,
  loading: DialogChunkFallback,
});

interface EventsClientProps {
  fallbackEvents?: CalendarEvent[];
}

export default function EventsClient({ fallbackEvents }: EventsClientProps = {}) {
  const fallbackData =
    fallbackEvents !== undefined
      ? { success: true, events: fallbackEvents }
      : undefined;
  const { events, isLoading: loading } = useEvents(fallbackData);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 画家卡牌弹窗
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [artistCards, setArtistCards] = useState<ArtistCard[]>([]);
  const [artistCardsLoading, setArtistCardsLoading] = useState(false);

  // 页面加载后空闲时预加载弹窗 chunk
  useEffect(() => {
    preloadDialogChunks();
  }, []);

  // 首次加载完成后记录更新时间
  useEffect(() => {
    if (!loading) {
      setLastUpdated(new Date().toLocaleString("zh-CN"));
    }
  }, [loading]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) =>
      `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    if (fmt(s) === fmt(e)) return fmt(s);
    return `${fmt(s)} — ${fmt(e)}`;
  };

  /** 格式化 Mountain Mage 截止日期：完整日期 → YYYY/M/D，仅月份 → YYYY/M，无 → 暂无 */
  const formatDeadline = (deadline: string | null | undefined): string => {
    if (!deadline) return "时间待定";
    const parts = deadline.split("-");
    if (parts.length === 2) {
      // 仅月份格式 "2026-11" → "2026/11"
      return `${parts[0]}/${parseInt(parts[1], 10)}`;
    }
    if (parts.length === 3) {
      return `${parts[0]}/${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    }
    return "时间待定";
  };

  // 点击画家名，加载其所有卡牌（优先取 hover 预加载的缓存）
  async function handleArtistClick(artist: string) {
    setSelectedArtist(artist);
    setArtistCards([]);
    setArtistCardsLoading(true);

    try {
      const data = await getPreloadedData<{ success: boolean; cards?: ArtistCard[] }>(
        `/api/artist-cards?artist=${encodeURIComponent(artist)}`
      );

      if (data.success) {
        setArtistCards(data.cards || []);
      } else {
        setArtistCards([]);
      }
    } catch {
      setArtistCards([]);
    } finally {
      setArtistCardsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">活动日历</h1>
        <p className="text-muted-foreground">
          未来活动及出席画家
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">暂无未来活动</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 rounded-t-lg"
                onClick={() => toggleExpand(event.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{event.name}</CardTitle>
                    </div>
                    <CardDescription className="flex flex-col gap-y-1">
                      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                        {event.source === "mtgac" ? (
                          <>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Calendar className="h-3 w-3 shrink-0" />
                              {formatDate(event.startDate, event.endDate || event.startDate)}
                            </span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {event.city}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Calendar className="h-3 w-3 shrink-0" />
                              {formatDeadline(event.endDate)}
                            </span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Package className="h-3 w-3 shrink-0" />
                              平台代理（邮寄）
                            </span>
                          </>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Users className="h-3 w-3 shrink-0" />
                        {event.artists.length} 位画家
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              {expanded.has(event.id) && (
                <CardContent>
                  {event.artists.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无画家信息</p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mb-3">
                        <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                        点击画家名可查看其全部卡牌
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {event.artists.map((artist) => (
                          <Button
                            key={artist}
                            variant="outline"
                            size="sm"
                            className="border-border text-muted-foreground hover:bg-accent"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArtistClick(artist);
                            }}
                            onMouseEnter={() => preloadData(`/api/artist-cards?artist=${encodeURIComponent(artist)}`)}
                          >
                            {artist}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4">
        数据来源：mtgartistconnection.com · mountainmagesigs.com
        {lastUpdated && ` · 上次更新：${lastUpdated}`}
      </p>

      {/* ─── 画家卡牌画廊弹窗（懒加载，打开时才下载 chunk）─── */}
      {selectedArtist !== null && (
        <ArtistGalleryDialog
          artist={selectedArtist}
          cards={artistCards}
          loading={artistCardsLoading}
          onClose={() => { setSelectedArtist(null); setArtistCards([]); }}
        />
      )}
    </div>
  );
}
