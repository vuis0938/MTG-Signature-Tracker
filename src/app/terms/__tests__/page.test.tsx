// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TermsPage from "../page";

describe("TermsPage", () => {
  it("渲染用户协议标题和关键章节", () => {
    render(<TermsPage />);
    expect(screen.getByText("用户协议")).toBeTruthy();
    expect(screen.getByText(/最后更新日期/)).toBeTruthy();
    expect(screen.getByText("1. 服务说明")).toBeTruthy();
    expect(screen.getByText("2. 账号注册与安全")).toBeTruthy();
  });
});
