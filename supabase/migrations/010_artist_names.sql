-- ════════════════════════════════════════════════════════════
-- 全量画家标准名单表
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：缓存 Scryfall /catalog/artist-names 的全量画家名（约 2400+ 位），
--   用于「智能解析」阶段本地纠错——优先查本地名单，命中即零 Scryfall 请求，
--   本地未命中再降级打 Scryfall（兜底）。
--
-- 数据来源：管理员在「画家别名管理」页点「刷新画家名单」写入。
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS artists (
  name TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 服务端专用：service role 读写（绕过 RLS），前端 anon 无 policy 默认拒绝
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
