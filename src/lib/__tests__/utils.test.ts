// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("合并多个字符串类名", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("忽略 falsy 值", () => {
    expect(cn("foo", null, undefined, false && "hidden", "bar")).toBe("foo bar");
  });

  it("处理对象条件类名", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("处理嵌套数组", () => {
    expect(cn(["foo", ["bar", "baz"]], "qux")).toBe("foo bar baz qux");
  });

  it("解决 Tailwind 冲突并保留后者", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
