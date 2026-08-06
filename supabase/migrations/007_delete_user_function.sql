-- ════════════════════════════════════════════════════════════
-- 永久删除用户的数据库函数
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：
--   在数据库层提供一个原子事务，一次性永久删除用户账号及其全部数据：
--     - users 表中的账号记录
--     - decks 表中的套牌（依赖外键 fk_cards_deck_id 级联删除其下卡牌）
--     - cards 表中按 user_name 残留/孤立的卡牌
--     - feedback 表中该用户提交的所有反馈
--
-- 安全说明：
--   - 函数使用 SECURITY DEFINER，由创建者权限执行
--   - 服务端 API 通过 Service Role Key 调用 RPC，绕过 RLS
--   - 若用户不存在，函数返回 FALSE，不会报错
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_user_completely(target_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_exists BOOLEAN;
BEGIN
  -- 检查用户是否存在
  SELECT EXISTS(
    SELECT 1 FROM public.users WHERE username = target_username
  ) INTO user_exists;

  IF NOT user_exists THEN
    RETURN FALSE;
  END IF;

  -- 1. 删除该用户提交的所有反馈
  DELETE FROM public.feedback WHERE user_name = target_username;

  -- 2. 删除按 user_name 残留/孤立的卡牌（兜底清理）
  DELETE FROM public.cards WHERE user_name = target_username;

  -- 3. 删除套牌；fk_cards_deck_id ON DELETE CASCADE 会自动删除其下卡牌
  DELETE FROM public.decks WHERE user_name = target_username;

  -- 4. 最后删除账号本身
  DELETE FROM public.users WHERE username = target_username;

  RETURN TRUE;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 说明：
--   执行此 SQL 后，管理员在后台点击「删除用户」即可真正永久销号。
--   所有相关数据在同一个数据库事务中删除，任一环节失败会整体回滚，
--   不会出现「用户没了但套牌/反馈还在」的半删除状态。
-- ════════════════════════════════════════════════════════════
