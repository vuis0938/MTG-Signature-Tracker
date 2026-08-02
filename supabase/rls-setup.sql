-- ════════════════════════════════════════════════════════════
-- Supabase RLS（行级安全）配置
-- ════════════════════════════════════════════════════════════
-- 
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 背景：
--   本项目的 Supabase 使用 ANON_KEY（公开密钥）直连数据库。
--   如果不开启 RLS，任何拿到 ANON_KEY 的人（密钥在前端代码中可见）
--   都可以直接读写所有用户的数据。
--   开启 RLS 后，数据库层面强制行级隔离，即使密钥泄露也无法跨用户访问。
--
-- 注意：
--   本项目使用自定义认证（非 Supabase Auth），所以 RLS 策略
--   基于 user_name 字段匹配，而非 Supabase 内置的 auth.uid()。
--   这意味着 RLS 是"尽力而为"的兜底防护，主要安全仍依赖 API 层鉴权。
--   但 RLS 能防止前端直连 Supabase 绕过 API 的情况。
-- ════════════════════════════════════════════════════════════

-- ─── 1. users 表 ──────────────────────────────────────────
-- 密码表，只允许通过 API（服务端）访问，前端不应直接操作
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 禁止前端直接读取 users 表（密码哈希不能泄露）
CREATE POLICY "禁止前端读取 users" ON users
  FOR SELECT USING (false);

CREATE POLICY "禁止前端写入 users" ON users
  FOR ALL USING (false) WITH CHECK (false);

-- ─── 2. decks 表 ──────────────────────────────────────────
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;

-- 只能读自己的套牌
CREATE POLICY "用户只能读自己的套牌" ON decks
  FOR SELECT USING (user_name = current_setting('app.current_user', true));

-- 只能写自己的套牌
CREATE POLICY "用户只能写自己的套牌" ON decks
  FOR ALL USING (user_name = current_setting('app.current_user', true))
  WITH CHECK (user_name = current_setting('app.current_user', true));

-- ─── 3. cards 表 ──────────────────────────────────────────
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- 只能读自己套牌里的卡牌（通过 deck_id 关联）
CREATE POLICY "用户只能读自己套牌的卡牌" ON cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = cards.deck_id
      AND decks.user_name = current_setting('app.current_user', true)
    )
  );

-- 只能写自己套牌里的卡牌
CREATE POLICY "用户只能写自己套牌的卡牌" ON cards
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = cards.deck_id
      AND decks.user_name = current_setting('app.current_user', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = cards.deck_id
      AND decks.user_name = current_setting('app.current_user', true)
    )
  );

-- ─── 4. card_printings 表 ─────────────────────────────────
-- 缓存表，所有用户可读（公共数据），但前端不应写入
ALTER TABLE card_printings ENABLE ROW LEVEL SECURITY;

-- 所有用户可读（印刷版本信息是公共的）
CREATE POLICY "所有人可读印刷版本缓存" ON card_printings
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入印刷版本缓存" ON card_printings
  FOR INSERT WITH CHECK (false);

CREATE POLICY "禁止前端修改印刷版本缓存" ON card_printings
  FOR UPDATE USING (false);

-- ─── 5. mountain_mage_curated 表 ──────────────────────────
-- 策展数据，所有用户可读，但只有登录用户可通过 API 修改
ALTER TABLE mountain_mage_curated ENABLE ROW LEVEL SECURITY;

-- 所有用户可读
CREATE POLICY "所有人可读策展数据" ON mountain_mage_curated
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入策展数据" ON mountain_mage_curated
  FOR ALL USING (false) WITH CHECK (false);

-- ════════════════════════════════════════════════════════════
-- 重要提醒
-- ════════════════════════════════════════════════════════════
--
-- 1. 执行以上 SQL 后，RLS 立即生效。
--
-- 2. 因为本项目使用自定义认证（非 Supabase Auth），
--    API 路由中通过 ANON_KEY 访问 Supabase 时，
--    RLS 的 current_setting('app.current_user') 默认为空。
--    这意味着 API 路由也会被 RLS 拦截！
--
-- 3. 解决方案（二选一）：
--
--    方案 A（推荐）：使用 Service Role Key 访问数据库
--    ─────────────────────────────────────────────────
--    在服务端 API 路由中使用 SERVICE_ROLE_KEY（绕过 RLS），
--    这样 API 层的鉴权逻辑不受影响。
--    需要修改 src/lib/supabase.ts，新增一个 getServiceClient() 函数。
--    SERVICE_ROLE_KEY 只存在服务端环境变量，绝不暴露给前端。
--
--    方案 B：在每次查询前设置 current_setting
--    ─────────────────────────────────────────────────
--    在每个 API 路由中，查询前执行：
--    supabase.rpc('set_config', { name: 'app.current_user', value: userName })
--    这样 RLS 就能识别当前用户。
--    但此方案更复杂，且容易遗漏。
--
-- 4. 如果暂时不想配置 RLS（小站风险可控），
--    至少确认 Supabase Dashboard 中的 RLS 开关状态。
--    如果已关闭，以上 SQL 不会强制生效。
-- ════════════════════════════════════════════════════════════
