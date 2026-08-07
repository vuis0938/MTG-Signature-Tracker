// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createToken, verifyToken, isAdmin } from "../auth-edge";
import { createToken as createNodeToken } from "../auth";

describe("auth-edge", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("TOKEN_SECRET", "edge-test-secret");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("createToken 返回 payload.signature 格式", async () => {
    const token = await createToken("alice");
    expect(token).toContain(".");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it("verifyToken 验证 edge 自身生成的 token", async () => {
    const token = await createToken("alice");
    expect(await verifyToken(token)).toBe("alice");
  });

  it("verifyToken 兼容 Node 版 auth.ts 生成的 token", async () => {
    const token = createNodeToken("alice");
    expect(await verifyToken(token)).toBe("alice");
  });

  it("verifyToken 拒绝伪造 token", async () => {
    expect(await verifyToken("fake.invalid")).toBeNull();
    expect(await verifyToken("onlypayload")).toBeNull();
    expect(await verifyToken("a.b.c")).toBeNull();
  });

  it("verifyToken 拒绝篡改签名", async () => {
    const token = await createToken("alice");
    const [payload] = token.split(".");
    const forged = `${payload}.invalidsignature`;
    expect(await verifyToken(forged)).toBeNull();
  });

  it("verifyToken 拒绝空/undefined/null", async () => {
    expect(await verifyToken("")).toBeNull();
    expect(await verifyToken(undefined)).toBeNull();
    expect(await verifyToken(null)).toBeNull();
  });

  it("isAdmin 正确判断管理员", () => {
    vi.stubEnv("ADMIN_USERS", "alice,bob");
    expect(isAdmin("alice")).toBe(true);
    expect(isAdmin("Bob")).toBe(true);
    expect(isAdmin("charlie")).toBe(false);
  });
});
