-- ════════════════════════════════════════════════════════════
-- 安全问题字段（用于忘记密码找回）
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：在 users 表添加安全问题和答案字段，用于忘记密码时的身份验证
-- 答案在服务端哈希存储（SHA-256 + salt），不存明文
--
-- 注意：已注册的老用户 security_question 为 NULL，
--   登录后会提示补充安全问题，不影响原有功能
-- ════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer TEXT;
