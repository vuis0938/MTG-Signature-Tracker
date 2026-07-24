# 技术栈说明

## 选择与理由

| 层 | 技术 | 版本 | 用途 |
|----|------|------|------|
| 框架 | Next.js (App Router) | 16.x | 全栈框架，SSR 可选，免费部署 Vercel |
| 语言 | TypeScript | 5.x | 类型安全 |
| UI 样式 | Tailwind CSS | 4.x | 原子化 CSS，响应式 |
| UI 组件 | shadcn/ui | latest | 无包依赖，复制即用 |
| 数据库 | Supabase | - | 云端 PostgreSQL，PC/手机数据同步 |
| 卡牌数据 | Scryfall API | - | 免费、精准、高清卡图 |
| 列表清洗 | LLM API | - | Anthropic Haiku / GPT-4o-mini |
| 模糊匹配 | Fuse.js | latest | 前端运行，画家名容错比对 |
| CSV 解析 | papaparse | latest | Moxfield 导出文件解析 |
| 部署 | Vercel | Hobby Plan | 免费一键部署 |

## 外部 API

### Scryfall API
- 基础 URL: `https://api.scryfall.com`
- 速率限制: ~10 requests/second
- 查询方式: `/cards/:set/:number`（按系列代码+编号）
- 实现了延迟: 每次请求至少间隔 100ms
- 需要自定义 User-Agent 头部

### LLM API
- 首选: Anthropic Messages API (Claude Haiku)
- 备选: OpenAI Chat Completions API (GPT-4o-mini)
- 用途: 清洗活动名单文本，提取画家姓名数组
- 降级: 前端纯正则解析引擎（无 API Key 时自动启用）

## 前端依赖
- `@supabase/supabase-js` — Supabase 客户端 SDK
- `fuse.js` — 模糊搜索库
- `papaparse` — CSV 解析库

## 环境变量
```
SECRET_KEY=your-secret-key-here
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
ANTHROPIC_API_KEY=your-anthropic-api-key (可选)
OPENAI_API_KEY=your-openai-api-key (可选)
```
