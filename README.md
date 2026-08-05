# MTG 签绘管家

万智牌签绘收藏管理工具。导入套牌牌表，追踪每张卡的签绘状态，管理送签进度，查看画家出席活动。

线上地址：[www.mtgkit.top](https://www.mtgkit.top)

## 技术栈

- **框架**：Next.js 16（App Router + Turbopack）
- **前端**：React 19、TypeScript、Tailwind CSS
- **后端**：Supabase（PostgreSQL + Auth）
- **数据源**：[Scryfall API](https://scryfall.com)、[MTG Artist Connection](https://mtgartistconnection.com)、[Mountain Mage Signatures](https://mountainmagesigs.com)
- **LLM**：DeepSeek / Anthropic（画师名单智能解析）
- **数据请求**：SWR

## 快速开始

```bash
# 安装依赖
npm install

# 复制环境变量模板并填写真实值
cp .env.example .env.local

# 启动开发服务器
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可访问。

## 环境变量

详见 `.env.example`，共 7 个变量：

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key（服务端） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key（前端） |
| `TOKEN_SECRET` | JWT 签名密钥（生产环境必须配置，32+ 字符） |
| `ADMIN_USERS` | 管理员用户名列表（逗号分隔） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（画师解析，优先） |
| `ANTHROPIC_API_KEY` | Anthropic API Key（画师解析，备选） |

## 数据库

在 Supabase Dashboard → SQL Editor 中依次执行 `supabase/migrations/` 下的 SQL 文件：

1. `001_optimize_card_toggle.sql` — 状态切换 RPC 函数
2. `002_artist_cards_cache.sql` — 画家卡牌缓存表
3. `003_security_questions.sql` — 密保问题表
4. `004_feedback.sql` — 用户反馈表
5. `005_add_foreign_keys.sql` — 外键约束

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm test` | 运行单元测试 |
| `npm run lint` | 代码检查 |

## 部署

推荐使用 [Vercel](https://vercel.com) 部署：

1. 将仓库导入 Vercel
2. 在 Settings → Environment Variables 中配置全部环境变量
3. 确认 Supabase 数据库迁移已执行
4. 部署即可

## 安全特性

- CSP / HSTS / X-Frame-Options 等安全响应头
- 全部 API 路由均有限流保护
- Supabase RLS 行级安全
- 客户端错误自动上报
