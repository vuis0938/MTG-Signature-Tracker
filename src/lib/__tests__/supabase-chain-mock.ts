// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Mock } from "vitest";

/**
 * 构造一个极简的链式 Supabase mock：所有链式方法都返回自身，
 * 终点方法（single / then）返回 Promise.resolve(finalResult)。
 */
export function createChainMock(finalResult: unknown): Record<string, any> {
  const chain: Record<string, any> = {};
  const handler = () => chain;

  const chainMethods = [
    "select",
    "eq",
    "in",
    "order",
    "from",
    "update",
    "delete",
    "insert",
    "limit",
  ];
  for (const method of chainMethods) {
    chain[method] = handler;
  }

  chain.single = () => Promise.resolve(finalResult);
  chain.then = (cb: (result: unknown) => unknown) =>
    Promise.resolve(cb ? cb(finalResult) : finalResult);

  return chain;
}

/**
 * 按调用顺序为 from(...) 配置返回结果。
 * 每调用一次 from 就按 results 顺序取一个结果包装成 chain mock。
 */
export function setupFromSequence(
  fromFn: Mock<(...args: unknown[]) => unknown>,
  results: unknown[]
): () => number {
  let fromCallCount = 0;
  fromFn.mockImplementation(() => {
    const result = results[fromCallCount] ?? { data: null, error: null };
    fromCallCount++;
    return createChainMock(result);
  });
  return () => fromCallCount;
}
