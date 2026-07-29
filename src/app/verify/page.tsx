"use client";

import { useState, useEffect } from "react";
import { Loader2, Check, AlertTriangle } from "lucide-react";

interface Section {
  name: string;
  deadline: string | null;
  artists: string[];
}

interface VerifyData {
  success: boolean;
  sections: Section[];
  cached: boolean;
  debug: {
    rawText: string;
    rawTextLength: number;
    sectionCount: number;
    parsedCount: number;
  };
}

export default function VerifyPage() {
  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/events/mountain-mage?debug=1&refresh=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d);
        else setError(d.error || "加载失败");
      })
      .catch(() => setError("网络错误"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen text-red-500">
        {error || "数据为空"}
      </div>
    );
  }

  // ── 解析原始文本，标记每行的类型 ──
  const rawLines = data.debug.rawText.split(/\r?\n/);
  const parsedArtistSet = new Set(
    data.sections.flatMap((s) => s.artists.map((a) => a.toLowerCase()))
  );

  // 提取括号前的名称
  const lineStatus = rawLines.map((rawLine) => {
    const line = rawLine.trim();
    if (!/^\s*\*\s+/.test(line)) return null; // 非艺术家行不标记

    // 提取括号前的名称
    const nameMatch = line.match(/^\s*\*\s+(.+)$/);
    if (!nameMatch) return null;
    let name = nameMatch[1].trim();
    const parenIdx = name.indexOf("(");
    if (parenIdx > 0) name = name.slice(0, parenIdx).trim();

    return {
      matched: parsedArtistSet.has(name.toLowerCase()),
      name,
    };
  });

  const matchedCount = lineStatus.filter((s) => s?.matched).length;
  const missedCount = lineStatus.filter((s) => s !== null && !s.matched).length;

  // 章节标题正则（与解析器一致）
  const sectionRegex =
    /^(Q[1-4]\s+\d{4}|DragonCon\s+\d{4}|Commander\s+Sealed\s+\d{4}|IN[\s-]PROGRESS)/i;

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="text-xl font-semibold mb-4">Mountain Mage 数据验证</h1>

      {/* 统计摘要 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold">{data.sections.length}</div>
          <div className="text-xs text-muted-foreground">解析章节</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-emerald-600">{matchedCount}</div>
          <div className="text-xs text-muted-foreground">已匹配艺术家</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-amber-600">{missedCount}</div>
          <div className="text-xs text-muted-foreground">未匹配行</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-muted-foreground">
            {data.debug.rawTextLength.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">原始文本字符数</div>
        </div>
      </div>

      {/* 双栏对比 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左栏：原始文本 */}
        <div className="rounded-lg border">
          <div className="px-4 py-2 border-b bg-accent/30 font-medium text-sm flex items-center gap-2">
            <span>原始文本</span>
            <span className="text-xs text-muted-foreground font-normal">
              🟢 已匹配 · 🟡 未匹配 · ⬜ 非艺术家行
            </span>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed">
            {rawLines.map((rawLine, i) => {
              const trimmed = rawLine.trim();
              const status = lineStatus[i];

              if (sectionRegex.test(trimmed)) {
                return (
                  <div key={i} className="bg-blue-50 dark:bg-blue-950/30 px-1 py-0.5 rounded my-1 font-semibold text-blue-700 dark:text-blue-400">
                    {trimmed}
                  </div>
                );
              }

              if (status) {
                return (
                  <div
                    key={i}
                    className={
                      status.matched
                        ? "bg-emerald-50 dark:bg-emerald-950/20 px-1 py-0.5 rounded my-0.5 text-emerald-800 dark:text-emerald-300"
                        : "bg-amber-50 dark:bg-amber-950/20 px-1 py-0.5 rounded my-0.5 text-amber-800 dark:text-amber-300"
                    }
                  >
                    <span className="inline-block w-5 text-center">
                      {status.matched ? (
                        <Check className="h-3 w-3 inline text-emerald-500" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 inline text-amber-500" />
                      )}
                    </span>{" "}
                    {status.name}
                    {!status.matched && (
                      <span className="ml-2 text-amber-500">（未解析）</span>
                    )}
                  </div>
                );
              }

              // 普通行
              if (trimmed) {
                return (
                  <div key={i} className="text-muted-foreground/60">
                    {trimmed}
                  </div>
                );
              }
              return <div key={i} className="h-3" />;
            })}
          </div>
        </div>

        {/* 右栏：解析结果 */}
        <div className="rounded-lg border">
          <div className="px-4 py-2 border-b bg-accent/30 font-medium text-sm">
            解析结果 · {data.sections.length} 个章节 · {data.debug.parsedCount} 位艺术家
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {data.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                没有解析到任何章节
              </p>
            ) : (
              <div className="space-y-4">
                {data.sections.map((section) => (
                  <div key={section.name}>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm">{section.name}</h3>
                      {section.deadline && (
                        <span className="text-xs text-muted-foreground">
                          截止 {section.deadline}
                        </span>
                      )}
                      <span className="text-xs bg-accent px-1.5 py-0.5 rounded">
                        {section.artists.length} 位
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {section.artists.map((artist) => (
                        <span
                          key={artist}
                          className="inline-flex text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                        >
                          {artist}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}