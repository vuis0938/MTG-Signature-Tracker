// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatestRef } from "@/lib/use-latest-ref";

describe("useLatestRef", () => {
  it("初始返回当前 value", () => {
    const { result } = renderHook((value) => useLatestRef(value), {
      initialProps: "initial",
    });

    expect(result.current.current).toBe("initial");
  });

  it("rerender 后 ref.current 始终指向最新值", () => {
    const { result, rerender } = renderHook((value) => useLatestRef(value), {
      initialProps: "a",
    });

    expect(result.current.current).toBe("a");

    rerender("b");
    expect(result.current.current).toBe("b");

    rerender("c");
    expect(result.current.current).toBe("c");
  });

  it("ref 对象本身保持稳定，不触发额外渲染", () => {
    const { result, rerender } = renderHook((value) => useLatestRef(value), {
      initialProps: "a",
    });

    const firstRef = result.current;
    rerender("b");
    expect(result.current).toBe(firstRef);
  });
});
