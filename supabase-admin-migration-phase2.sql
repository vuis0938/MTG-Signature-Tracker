-- ─── 管理后台第二阶段数据库迁移 ────────────────────────────
-- 在 Supabase Dashboard → SQL Editor 中执行此 SQL

-- 1. 自定义活动表（管理员手动添加的本地活动）
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  end_date TEXT,
  location TEXT,
  artists TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (date);
CREATE INDEX IF NOT EXISTS idx_events_archived ON events (archived);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- 自定义活动所有用户可读（会出现在活动列表中），仅服务端可写
CREATE POLICY "Allow read for all" ON events FOR SELECT USING (true);
CREATE POLICY "Deny write from frontend" ON events FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny update from frontend" ON events FOR UPDATE USING (false);
CREATE POLICY "Deny delete from frontend" ON events FOR DELETE USING (false);

-- 2. 画家别名映射表
CREATE TABLE IF NOT EXISTS artist_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_aliases_alias ON artist_aliases (alias);

ALTER TABLE artist_aliases ENABLE ROW LEVEL SECURITY;

-- 画家别名所有用户可读（匹配逻辑需要），仅服务端可写
CREATE POLICY "Allow read for all" ON artist_aliases FOR SELECT USING (true);
CREATE POLICY "Deny write from frontend" ON artist_aliases FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny update from frontend" ON artist_aliases FOR UPDATE USING (false);
CREATE POLICY "Deny delete from frontend" ON artist_aliases FOR DELETE USING (false);
