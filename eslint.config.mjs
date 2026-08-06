import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 / Next.js 15 新增的严格规则，对“在 useEffect 中初始化数据、
      // 从 localStorage 恢复状态”等常见安全模式也会报错。项目中有大量既有代码
      // 采用此类模式，强行重构为 useSyncExternalStore 或 use 会带来较高回归风险。
      // 暂时关闭，后续可逐步将这些 hook 迁移为外部存储订阅模式。
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
