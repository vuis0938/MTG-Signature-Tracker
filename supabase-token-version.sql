-- ─── Token Version 撤销机制迁移 ────────────────────────────
-- 在 Supabase Dashboard → SQL Editor 中执行此 SQL

-- 1. users 表新增 token_version 字段
-- 用于无状态 token 撤销：修改密码 / 登出 / 管理员重置密码时更新此值，
-- 使之前签发的所有 token 失效。
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version TEXT DEFAULT NULL;

-- 2. 为已有用户回填 token_version（平滑迁移）
-- 老用户首次登录时会重新生成，这里先给一个默认值避免 NULL 判断复杂化
UPDATE users
SET token_version = encode(gen_random_bytes(16), 'hex')
WHERE token_version IS NULL;

-- 3. 在 username 上建立索引以加速 token 验证查询
-- users 表通常已以 username 为主键或唯一索引，如没有可取消下面注释
-- CREATE INDEX IF NOT EXISTS idx_users_token_version ON users (username, token_version);

-- 4. RLS 说明
-- users 表已有 RLS 策略禁止前端直接读写，token_version 字段遵循相同策略。
-- 所有 token_version 操作均通过服务端 API（Service Role Key）完成。
