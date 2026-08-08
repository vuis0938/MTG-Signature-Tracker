# 开发规范

## 项目简介

MTG 签绘管家 — 万智牌签绘收藏管理工具。核心功能：导入牌表、匹配活动画家、管理签绘进度。

## 分支策略

| 分支 | 用途 | 规则 |
|------|------|------|
| `main` | 线上生产环境，Vercel 自动部署 | **禁止直接推送**，只通过 PR 合入 |
| `dev` | 日常开发分支 | 所有新功能、Bug 修复都在此分支开发 |

## 工作流程

```
dev 上开发 → git push → Vercel 预览环境验证 → 确认无误 → 合并到 main 上线
```

## 合并到 main 前检查清单

- [ ] `npx vitest run` 全部通过
- [ ] `npx tsc --noEmit` 零错误
- [ ] 预览环境手动验证核心流程（登录、匹配、状态切换）
- [ ] 数据库变更向后兼容（只加不删，不改名）

## 技术栈

- Next.js 15 (App Router) + TypeScript
- Supabase (PostgreSQL + RLS)
- shadcn/ui + Tailwind CSS
- Vercel (部署)
- Vitest (测试)

## 关键文件

- 认证: `src/lib/auth.ts` (Node) / `src/lib/auth-edge.ts` (Edge)
- 中间件: `src/middleware.ts`
- 匹配逻辑: `src/lib/match-utils.ts`
- 限流: `src/lib/rate-limit.ts`
- Supabase 客户端: `src/lib/supabase.ts`

## 已踩过的坑（不要重蹈覆辙）

### 1. `safeNormalize` 不可替换为原生 `normalize()`

`src/lib/match-utils.ts` 中的 `safeNormalize` 函数存在是因为 UC 浏览器 ICU 实现不完整，调用 `String.normalize("NFD")` 会直接抛异常。**绝对不要**改用原生 `normalize`，否则 UC 用户匹配功能会崩溃。

### 2. 数据库查询目前使用两步查询，未用 join

`cards` 和 `decks` 表之间可能没有外键约束（迁移 `005_add_foreign_keys.sql` 需要在 Supabase Dashboard 手动执行，不确定是否已跑）。因此代码统一使用两步查询：先查 cards 拿 deck_id，再查 decks 验证 user_name。如果确认迁移已执行，可以改用 PostgREST join 语法简化代码。

### 3. `import { supabase }` 和 `getSupabase()` 等价

两者都使用 Service Role Key（绕过 RLS），都带 15 秒超时。`supabase` 是 Proxy，所有属性访问自动转发到 `getSupabase()`。11 个 API 路由都在用 `import { supabase }`，这是主流用法。无需强制统一。

### 4. Edge Runtime 和 Node Runtime 的认证函数不同

`src/lib/auth.ts` 用 Node `crypto`，用于 API 路由。`src/lib/auth-edge.ts` 用 Web Crypto API，用于 middleware。两者 token 格式完全一致，但不能混用。

### 5. 测试中 mock 浏览器 API 记得恢复

如果测试中 mock 了 `String.prototype.normalize` 等全局对象，必须在 `afterEach` 中恢复原值，否则会影响后续测试。参考 `safe-normalize.test.ts` 的做法。