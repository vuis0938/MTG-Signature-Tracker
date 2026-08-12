# 交接笔记（2026-08-13）

> 由接续开发者完成「代码同步 + 环境跑通」后整理，记录项目当前真实状态，
> 用于纠正部分已过时的 `docs/` 文档。**以代码和数据库实际状态为准**。

## 一、代码与分支

- 线上生产：`main` @ `7dc1c9b`（Vercel 自动部署，域名 https://www.mtgkit.top，区域 hkg1）
- 开发分支：`dev` @ `cb67fa6`（与 main 内容**完全一致**，dev 的 14 个提交被 squash 成 main 的 1 个提交）
- 废弃分支：`master`（main 的祖先，落后 75 提交，勿用）
- 本地旧快照（7/25）已备份到 `backup/local-master-pre-sync`

## 二、技术栈（实际值，纠正 tech-stack.md / DEVELOPMENT.md）

- Next.js **16.3.0**（App Router + Turbopack）—— DEVELOPMENT.md 写的「15」是错的
- Tailwind CSS **v4**（`@tailwindcss/postcss` + `@import "tailwindcss"`）
- Supabase（PostgreSQL + RLS，12 张表；服务端用 service_role key 绕过 RLS）
- shadcn/ui + **SWR**（数据缓存）+ Vitest（**332 测试全绿**）
- 名单解析：**DeepSeek**（`DEEPSEEK_API_KEY`），Anthropic 仅备选
- 匹配引擎：**自研三级匹配**（精确 → 首尾名 → 变音规范化），**Fuse.js 已移除**
- 卡牌数据：Scryfall（`/cards/collection` 批量接口 + RateLimiter 10 req/s）

## 三、数据库（12 张表）

核心 3 张（DDL 在 Supabase Dashboard 手建，**不在仓库**）：

| 表 | 列 |
|---|---|
| `users` | `username`(text PK)、`password`、`security_question`、`security_answer`、`created_at`、`last_active_at`、`banned_at`、⚠️`id`(bigint 遗留死列) |
| `decks` | `id`(uuid PK)、`name`、`source`、`user_name`、`created_at`、`updated_at` |
| `cards` | `id`(uuid PK)、`deck_id`(FK→decks)、`scryfall_id`、`card_name`、`set_name`、`set_code`、`collector_number`、`artist_names`(**text[]**)、`image_url`、`status`(int 0/1/2/3)、`is_signed`(bool)、`event_name`、`event_date`、`created_at`、⚠️`signed_date`/`signed_event`(遗留死列) |

其余 9 张（DDL 在仓库 SQL 文件）：`card_printings`、`artist_cards`、`feedback`、`scryfall_meta`、`events`、`artist_aliases`、`announcements`、`admin_logs`、`mountain_mage_curated`

SQL 文件位置：`supabase/migrations/001-009.sql`、`supabase-migration.sql`、`supabase/rls-setup.sql`、`supabase-admin-migration*.sql`

## 四、环境变量（8 个）

`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`TOKEN_SECRET`、`ADMIN_USERS`、`NEXT_PUBLIC_SITE_URL`、`DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`(可选)

## 五、鉴权

- 自定义鉴权（**非** Supabase Auth）：PBKDF2-SHA256(60 万次) 密码哈希 + HMAC-SHA256 无状态 token（7 天）
- Cookie：`auth_token`(httpOnly) / `user_name` / `is_admin`
- 数据隔离靠 `decks.user_name = 当前用户`；服务端 service_role 绕过 RLS
- `src/middleware.ts` 校验 token —— ⚠️ Next 16 已弃用 middleware 约定，需迁 `proxy`

## 六、关键架构

- 模糊匹配两阶段：Phase 1 快速出结果（仅画家名）→ Phase 2 按需加载印刷版本
- 缓存：`card_printings` 表持久化 + `scryfall_meta` 记录 bulk-data 版本号；`card_printings` 当前为空（按需预热重建）
- UC 浏览器兼容：`safeNormalize` 捕获 ICU 崩溃；POST URL 加随机参数防云端加速缓存

## 七、已知待办 / 注意

- middleware → proxy 迁移（有弃用警告）
- `cards.signed_date`/`signed_event`、`users.id` 三个遗留死列，可日后清理
- 9 条用户反馈在 `/admin/feedback` 待处理
- 数据库变更只加不删不改名（向后兼容）
