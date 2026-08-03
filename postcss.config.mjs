const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // color-mix() 回退由 globals.css 中的 @supports not 手动处理
    // @csstools/postcss-color-mix-function 已移除：
    //   它无法解析 var()，会生成 100% 不透明的错误回退（如 .bg-primary/10 → var(--primary)）
    //   导致 iOS 15 上背景色遮挡文字
    // 将 oklch() 转换为 sRGB 回退（iOS 15.0-15.3 不支持 oklch）
    "@csstools/postcss-oklab-function": { preserve: true },
  },
};

export default config;
