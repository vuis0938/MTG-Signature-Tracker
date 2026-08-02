/**
 * 客户端 instrumentation
 *
 * 在 React 水合之前执行，加载 core-js 完整 polyfill，
 * 确保 ES2015~ES2024 的所有运行时 API 在旧设备上都可用。
 * 浏览器缺少哪些 API，core-js 会根据 browserslist 配置自动补齐。
 */
import "core-js/stable";
