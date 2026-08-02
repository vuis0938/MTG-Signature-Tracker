-- ─── 管理后台第三阶段数据库迁移 ────────────────────────────
-- 在 Supabase Dashboard → SQL Editor 中执行此 SQL

-- 系统公告表
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',  -- info / warning / maintenance
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ  -- 过期时间，NULL 表示永久
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (active);
CREATE INDEX IF NOT EXISTS idx_announcements_expires ON announcements (expires_at);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- 公告所有用户可读，仅服务端可写
CREATE POLICY "Allow read for all" ON announcements FOR SELECT USING (true);
CREATE POLICY "Deny write from frontend" ON announcements FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny update from frontend" ON announcements FOR UPDATE USING (false);
CREATE POLICY "Deny delete from frontend" ON announcements FOR DELETE USING (false);
