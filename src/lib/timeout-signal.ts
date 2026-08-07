/**
 * 兼容性超时 Signal 工具
 *
 * 优先使用原生的 AbortSignal.timeout / AbortSignal.any，
 * 在旧版 Node / Edge Runtime 中自动降级为 AbortController + setTimeout。
 */

export interface TimeoutSignal {
  signal: AbortSignal;
  /** 清理定时器与监听器，避免 fetch 成功后仍触发 abort 或内存泄漏 */
  clear: () => void;
}

/** 创建一个在 ms 后自动 abort 的 signal */
export function createTimeoutSignal(ms: number): TimeoutSignal {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === "function"
  ) {
    return {
      signal: (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(ms),
      clear: () => {},
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/** 把多个 abort signal 组合成“任一触发即触发”的 signal */
export function combineSignals(signals: (AbortSignal | undefined | null)[]): TimeoutSignal {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined && s !== null);

  if (valid.length === 0) {
    const controller = new AbortController();
    return { signal: controller.signal, clear: () => {} };
  }

  if (valid.length === 1) {
    return { signal: valid[0], clear: () => {} };
  }

  if (
    typeof AbortSignal !== "undefined" &&
    typeof (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any === "function"
  ) {
    return {
      signal: (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any(valid),
      clear: () => {},
    };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();

  function onAbort() {
    controller.abort();
    for (const [sig, fn] of listeners) {
      sig.removeEventListener("abort", fn);
    }
    listeners.clear();
  }

  for (const sig of valid) {
    if (sig.aborted) {
      onAbort();
      break;
    }
    const fn = () => onAbort();
    sig.addEventListener("abort", fn);
    listeners.set(sig, fn);
  }

  return {
    signal: controller.signal,
    clear: () => {
      for (const [sig, fn] of listeners) {
        sig.removeEventListener("abort", fn);
      }
      listeners.clear();
    },
  };
}
