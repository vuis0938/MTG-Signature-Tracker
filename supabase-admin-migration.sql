-- ─── 管理后台数据库迁移 ────────────────────────────────────
-- 在 Supabase Dashboard → SQL Editor 中执行此 SQL

-- 1. users 表新增字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ DEFAULT NULL;

-- 为已有用户回填 created_at（如果之前没有记录）
UPDATE users SET created_at = now() WHERE created_at IS NULL;
UPDATE users SET last_active_at = now() WHERE last_active_at IS NULL;

-- 2. 管理员审计日志表
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_user ON admin_logs (admin_user);

ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

-- 审计日志仅允许服务端（Service Role）访问，前端禁止读写
CREATE POLICY "Deny all from frontend" ON admin_logs FOR ALL USING (false) WITH CHECK (false);
