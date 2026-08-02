const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // 将 color-mix() 转换为兼容格式（iOS 15.0-15.3 不支持 color-mix）
    "@csstools/postcss-color-mix-function": { preserve: true },
    // 将 oklch() 转换为 sRGB 回退（iOS 15.0-15.3 不支持 oklch）
    "@csstools/postcss-oklab-function": { preserve: true },
  },
};

export default config;
