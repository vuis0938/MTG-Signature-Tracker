"use client";

import { CardImage } from "@/components/card-image";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { ArtistCard } from "@/types";

// ─── 画家卡牌画廊弹窗 ──────────────────────────────────────

export interface ArtistGalleryDialogProps {
  artist: string;
  cards: ArtistCard[];
  loading: boolean;
  onClose: () => void;
}

// 固定内容区高度：所有阶段（加载/空/展示）共用，消除尺寸跳变
const CONTENT_HEIGHT = "h-[50vh]";

export default function ArtistGalleryDialog({
  artist,
  cards,
  loading,
  onClose,
}: ArtistGalleryDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={onClose}
      className="max-w-3xl"
    >
      <DialogHeader>
        <DialogTitle>{artist} 的卡牌</DialogTitle>
      </DialogHeader>
      <DialogContent>
        {loading ? (
          <div className={"flex items-center justify-center overflow-y-auto pr-2 " + CONTENT_HEIGHT}>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
          </div>
        ) : cards.length === 0 ? (
          <div className={"flex items-center justify-center overflow-y-auto pr-2 " + CONTENT_HEIGHT}>
            <p className="text-sm text-muted-foreground text-center">未找到该画家的卡牌</p>
          </div>
        ) : (
          <div className={"grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 overflow-y-auto pr-2 " + CONTENT_HEIGHT}>
            {cards.map((card) => (
              <div
                key={card.set + "-" + card.collector_number}
                className="rounded-lg border overflow-hidden bg-background"
                title={card.set_name + " #" + card.collector_number}
              >
                {card.image_url ? (
                  <CardImage src={card.image_url} alt={card.name} className="w-full" />
                ) : (
                  <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                    {card.name}
                  </div>
                )}
                <div className="p-1.5 text-xs">
                  <p className="font-medium truncate">{card.name}</p>
                  <p className="text-muted-foreground truncate">{card.set_name} #{card.collector_number}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
