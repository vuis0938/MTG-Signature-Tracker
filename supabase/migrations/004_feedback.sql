-- ════════════════════════════════════════════════════════════
-- 用户反馈表（Bug 反馈 / 功能建议 / 其他）
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：存储用户提交的反馈，供管理员在后台查看与处理
-- 字段说明：
--   user_name  提交者用户名
--   category   反馈类别（bug / suggestion / other）
--   content    反馈内容
--   is_read    管理员是否已读
--   created_at 提交时间
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'bug',
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 未读反馈计数索引（管理员角标高频查询）
CREATE INDEX IF NOT EXISTS feedback_is_read_idx ON feedback(is_read) WHERE is_read = FALSE;

-- 按时间倒序查询索引
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback(created_at DESC);
