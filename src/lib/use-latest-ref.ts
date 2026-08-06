"use client";

import { useRef, useEffect } from "react";

/**
 * 返回一个始终指向最新 value 的 ref。
 *
 * 使用 useEffect 在 commit 阶段同步 ref.current，避免在 render 阶段
 * 直接修改 ref（React 19 严格规则会报错），同时解决事件处理器/异步回调中的
 * 闭包陷阱问题。
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
