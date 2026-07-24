# 编码规范

## Git 纪律

1. **每完成一个阶段任务**，且代码运行无误后，立即 `git commit`
2. Commit message 格式: `feat(phase-N): 简短描述`
3. 每次提交前确保 `npm run dev` 无报错
4. 不跨阶段写代码——一个阶段做完、验证、提交，再开始下一个

## 代码风格

### TypeScript
- 使用 strict 模式
- 所有函数参数必须有类型标注
- 优先使用 `interface` 而非 `type`
- 异步操作必须有 try-catch 包裹
- 不使用 `any`，用 `unknown` + 类型守卫

### React 组件
- 使用函数组件 + Hooks
- 组件文件命名: kebab-case 或 PascalCase
- 一个文件一个组件（小型辅助组件除外）
- "use client" 指令仅在需要交互/状态的组件中使用
- 服务端组件优先，客户端组件按需

### 文件组织
```
src/
  app/              # Next.js App Router 页面
    login/          # 登录页面
    decks/          # 套牌管理页面
    match/          # 活动匹配页面
    settings/       # 设置页面
    api/            # API Routes
  components/       # 通用 UI 组件
    ui/             # shadcn/ui 组件
  lib/              # 工具函数
    supabase.ts     # Supabase 客户端
    scryfall.ts     # Scryfall API 工具
    parser.ts       # CSV 解析工具
    fuzzy.ts        # Fuse.js 工具
  types/            # TypeScript 类型定义
```

### Tailwind CSS
- 优先用 Tailwind 原子类，避免自定义 CSS
- 响应式断点: `sm:` (640px), `md:` (768px), `lg:` (1024px)
- 移动端优先：先写手机样式，再用 `md:` `lg:` 覆盖

## 外部 API 调用规范

### Scryfall
- 每次请求至少 100ms 延迟
- 携带自定义 User-Agent
- 错误重试最多 3 次，指数退避
- 按 `/cards/:set/:number` 端点查询，不模糊搜索卡名

### LLM API
- 使用 API Route 代理，不在前端直接调
- 设置超时 15 秒
- 降级方案: 无 API Key 时自动换用正则引擎

## UI/UX 规范
- 所有异步操作必须有 Loading 状态
- 所有错误必须有 Toast 提示
- 按钮在操作进行中必须 disabled
- 危险操作（删除、清空）必须有二次确认
