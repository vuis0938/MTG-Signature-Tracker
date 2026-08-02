import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUserFromRequest, isAdmin } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

// ─── 管理员权限守卫 ────────────────────────────────────────

/**
 * 验证请求是否来自管理员
 * 返回 { userName } 或 { error } — 调用方负责处理
 */
export function requireAdmin(request: NextRequest):
  | { userName: string; error: null }
  | { userName: null; error: NextResponse } {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return { userName: null, error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  if (!isAdmin(userName)) {
    return { userName: null, error: NextResponse.json({ error: "无权执行此操作" }, { status: 403 }) };
  }
  return { userName, error: null };
}

// ─── 审计日志 ──────────────────────────────────────────────

export type AdminAction =
  | "user_ban"
  | "user_unban"
  | "user_reset_password"
  | "curate_save"
  | "curate_refresh"
  | "event_create"
  | "event_update"
  | "event_delete"
  | "cache_clear_all"
  | "cache_delete"
  | "artist_alias_add"
  | "artist_alias_delete";

/**
 * 记录管理员操作到审计日志表
 * 失败时静默处理，不影响主流程
 */
export async function logAdminAction(
  adminUser: string,
  action: AdminAction,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("admin_logs").insert({
      admin_user: adminUser,
      action,
      target: target || null,
      detail: detail || {},
    });
    if (error) {
      console.error("[Admin Audit] 写入失败:", error.message);
    }
  } catch (err) {
    console.error("[Admin Audit] 异常:", err);
  }
}
