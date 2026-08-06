"use client";

/**
 * 轻量前端错误上报
 *
 * 挂载全局 error + unhandledrejection 监听器，
 * 将未捕获异常静默 POST 到 /api/error-log。
 *
 * 设计原则：
 * - 不引入第三方 SDK（Sentry 等），零依赖、零体积增长
 * - 本地缓存去重，同一错误 5 分钟内只报一次，避免雪崩
 * - 上报失败静默吞错，绝不影响用户操作
 */

const reported = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_STACK_LEN = 2000;

function report(error: { message: string; stack?: string }) {
  // 去重：同一消息 5 分钟内只报一次
  const now = Date.now();
  const last = reported.get(error.message);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  reported.set(error.message, now);

  const payload = {
    message: error.message?.slice(0, 2000) || "Unknown error",
    stack: error.stack?.slice(0, MAX_STACK_LEN),
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  };

  // sendBeacon 优先（页面卸载时也能发出），降级 fetch
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/error-log", blob);
      return;
    }
  } catch {
    // sendBeacon 失败则降级 fetch
  }

  fetch("/api/error-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // 上报失败静默吞错
  });
}

let initialized = false;

/**
 * 主动上报一个 Error 对象（带栈）。
 * error.tsx 等错误边界内使用，避免重复初始化全局监听器。
 */
export function reportError(error: Error) {
  report(error);
}

/**
 * 初始化全局错误捕获。应在应用最外层 Providers 中调用一次。
 */
export function initErrorReporter() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (e) => {
    if (e.error) {
      report(e.error);
    } else if (e.message) {
      report({ message: e.message });
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    if (reason instanceof Error) {
      report(reason);
    } else if (typeof reason === "string") {
      report({ message: reason });
    } else {
      report({ message: "Unhandled promise rejection" });
    }
  });
}
