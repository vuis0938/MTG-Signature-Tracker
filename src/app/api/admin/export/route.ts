import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

/**
 * CSV 字段转义：
 * 1. 包含逗号、双引号、换行的字段用双引号包裹，内部双引号转义为两个双引号
 * 2. 以公式注入前缀（=, +, -, @, 制表符, 回车）开头的字段前加单引号，防止 Excel 等自动执行公式
 */
function escapeCsvField(value: unknown): string {
  let str = String(value ?? "");

  // 防御 CSV 公式注入：在危险前缀前加单引号
  if (/^[\t\r\n=@+\-]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 转义
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function buildCsv(rows: Record<string, unknown>[], headers: string[]): string {
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escapeCsvField(r[h])).join(",")),
  ].join("\n");
}

// GET: 全局数据导出（JSON 格式）
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json"; // json | csv
    const dataType = searchParams.get("type") || "all"; // all | users | decks | cards

    const supabase = getSupabase();
    const exportData: Record<string, unknown> = {};
    const timestamp = new Date().toISOString();

    // 根据类型选择性导出
    if (dataType === "all" || dataType === "users") {
      const { data: users } = await supabase
        .from("users")
        .select("username, created_at, last_active_at")
        .order("created_at", { ascending: false });
      exportData.users = users || [];
    }

    if (dataType === "all" || dataType === "decks") {
      const { data: decks } = await supabase
        .from("decks")
        .select("*")
        .order("created_at", { ascending: false });
      exportData.decks = decks || [];
    }

    if (dataType === "all" || dataType === "cards") {
      const { data: cards } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50000);
      exportData.cards = cards || [];
    }

    if (dataType === "all") {
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .order("date", { ascending: false });
      exportData.events = events || [];

      const { data: aliases } = await supabase
        .from("artist_aliases")
        .select("*")
        .order("canonical_name", { ascending: true });
      exportData.artistAliases = aliases || [];

      const { data: announcements } = await supabase
        .from("announcements")
        .select("id, title, content, type, active, created_at, expires_at")
        .order("created_at", { ascending: false });
      exportData.announcements = announcements || [];
    }

    await logAdminAction(adminName, "data_export", dataType, { format });

    if (format === "csv") {
      // CSV 格式导出（仅支持单表）
      if (dataType === "users" && Array.isArray(exportData.users)) {
        const rows = exportData.users as Record<string, unknown>[];
        const headers = ["username", "created_at", "last_active_at"];
        return new NextResponse(buildCsv(rows, headers), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="users_${timestamp.split("T")[0]}.csv"`,
          },
        });
      }
      if (dataType === "decks" && Array.isArray(exportData.decks)) {
        const rows = exportData.decks as Record<string, unknown>[];
        const headers = ["id", "name", "user_name", "created_at"];
        return new NextResponse(buildCsv(rows, headers), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="decks_${timestamp.split("T")[0]}.csv"`,
          },
        });
      }
    }

    // 默认 JSON 格式
    const jsonStr = JSON.stringify({
      title: "MTG签绘管家",
      url: "https://www.mtgkit.top",
      exportedAt: timestamp,
      exportedBy: adminName,
      ...exportData,
    }, null, 2);

    return new NextResponse(jsonStr, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mtg_export_${timestamp.split("T")[0]}.json"`,
      },
    });
  } catch (err) {
    console.error("[Admin Export API]", err);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
