"use client";

import { CardImage } from "@/components/card-image";
import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import type { CardEntry, Printing } from "@/types";

// ─── 切换印刷版本弹窗（next/dynamic 懒加载，首次打开时才下载 chunk）──

export interface VersionSwitchDialogProps {
  switchCard: CardEntry | null;
  printings: Printing[];
  printingsLoading: boolean;
  switchPrintingLoading: string | null;
  deletingCard: string | null;
  onClose: () => void;
  onSwitchPrinting: (cardId: string, setCode: string, collectorNumber: string) => void;
  onDeleteCard: (cardId: string) => void;
}

export default function VersionSwitchDialog({
  switchCard, printings, printingsLoading, switchPrintingLoading, deletingCard,
  onClose, onSwitchPrinting, onDeleteCard,
}: VersionSwitchDialogProps) {
  return (
    <Dialog open={switchCard !== null} onOpenChange={onClose} className="max-w-3xl flex flex-col h-[70dvh] md:h-[80vh] !max-h-[70dvh] md:!max-h-[80vh] overflow-hidden pr-0">
      <DialogHeader className="shrink-0 px-6 pt-4 pb-1">
        <DialogTitle>切换印刷版本 — {switchCard?.card_name}</DialogTitle>
        <DialogDescription>
          当前版本：{switchCard?.set_code?.toUpperCase()} #{switchCard?.collector_number}
          {switchCard?.artist_names && (" · 画家：" + switchCard.artist_names.join(", "))}
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="flex-1 overflow-y-auto min-h-0 px-6 pb-2">
        {printingsLoading ? (
          <CardGridSkeleton className="p-1" rows={2} />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-1 items-start content-start">
              {(() => {
                // 确保当前版本始终在列表中（Scryfall 搜索可能遗漏部分 promo/特殊版本）
                const currentSet = (switchCard?.set_code || "").toLowerCase().trim();
                const currentNum = String(switchCard?.collector_number || "").trim();
                const hasCurrent = printings.some(
                  (p) => p.set.toLowerCase().trim() === currentSet &&
                         String(p.collector_number).trim() === currentNum
                );
                const displayPrintings = hasCurrent ? printings : [
                   {
                     set: switchCard?.set_code || "",
                     set_name: "当前版本",
                     collector_number: switchCard?.collector_number || "",
                     artist: switchCard?.artist_names?.join(", ") || "Unknown",
                     image_url: switchCard?.image_url || null,
                     released_at: undefined,
                   },
                   ...printings,
                 ];

                return displayPrintings.map((printing) => {
                const isCurrent =
                  printing.set.toLowerCase().trim() === (switchCard?.set_code || "").toLowerCase().trim() &&
                  String(printing.collector_number).trim() === String(switchCard?.collector_number || "").trim();
                const isSwitching = switchPrintingLoading === switchCard?.id;

                return (
                  <button
                    key={printing.set + "-" + printing.collector_number}
                    onClick={() => {
                      if (switchCard && !isCurrent && !isSwitching) {
                        onSwitchPrinting(switchCard.id, printing.set, printing.collector_number);
                      }
                    }}
                    disabled={isCurrent || isSwitching}
                    className={"text-left rounded-lg border-2 transition-all " + (isCurrent ? "overflow-visible border-blue-400 ring-2 ring-blue-400/40 cursor-default" : "overflow-hidden border-border hover:border-primary/50 hover:shadow cursor-pointer") + (isSwitching ? " opacity-50" : "")}
                    title={printing.artist}
                  >
                    {printing.image_url ? (
                      <CardImage
                        src={printing.image_url}
                        alt={printing.set_name + " #" + printing.collector_number}
                        className="w-full rounded-t-lg"
                      />
                    ) : (
                      <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center text-xs text-muted-foreground">
                        {printing.set_name}
                      </div>
                    )}
                    <div className="p-1.5 text-xs">
                      <p className="font-medium truncate">{printing.set_name}</p>
                      <p className="text-muted-foreground truncate">
                        #{printing.collector_number} · {printing.artist}
                      </p>
                    </div>
                  </button>
                );
              });
              })()}
            </div>
            {printings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                未找到该卡牌的其他印刷版本
              </p>
            )}
          </>
        )}
      </DialogContent>
      {/* 删除此卡牌 — 固定在底部，与 DialogContent 同级，高度算进 70vh */}
      {switchCard && (
        <div className="px-6 py-2 border-t shrink-0">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={printingsLoading || deletingCard === switchCard.id}
            onClick={() => {
              if (confirm(`确定从套牌中删除「${switchCard.card_name}」吗？此操作不可撤销`)) {
                onDeleteCard(switchCard.id);
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deletingCard === switchCard.id ? "删除中..." : "从套牌中删除此卡牌"}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
