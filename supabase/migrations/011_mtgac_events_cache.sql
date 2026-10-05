-- ════════════════════════════════════════════════════════════
-- MTG Artist Connection 活动缓存表
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：持久化「最近一次成功拉取」的 mtgac 活动列表。
--   mtgac 外部 GraphQL 偶发超时/失败/返回空，活动更新频率又很低，
--   因此失败时回退这张表里上次成功的结果（不设 TTL，即使很久前也照用），
--   避免活动清单时有时无。共享持久存储，冷启动也读得到。
--
-- 写入时机：每次成功拉取 mtgac 活动后覆盖写（服务端 service role）。
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mtgac_events_cache (
  id TEXT PRIMARY KEY DEFAULT 'mtgac',
  events JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 服务端专用：service role 读写（绕过 RLS），前端 anon 无 policy 默认拒绝
ALTER TABLE mtgac_events_cache ENABLE ROW LEVEL SECURITY;
