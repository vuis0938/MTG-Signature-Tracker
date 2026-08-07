-- 限流计数持久化表
-- 解决 Serverless 内存限流在实例回收/多实例间可被绕过的风险
-- 在 Supabase Dashboard → SQL Editor 中执行

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits (reset_at);

-- 禁止前端直接读写，仅允许服务端通过 Service Role Key 操作
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "禁止前端直接访问限流表" ON rate_limits
  FOR ALL USING (false) WITH CHECK (false);
