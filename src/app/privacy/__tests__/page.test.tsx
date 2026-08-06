// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage from "../page";

describe("PrivacyPage", () => {
  it("渲染隐私政策标题和关键章节", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("隐私政策")).toBeTruthy();
    expect(screen.getByText(/最后更新日期/)).toBeTruthy();
    expect(screen.getByText("1. 我们收集哪些信息")).toBeTruthy();
    expect(screen.getByText("2. 我们如何使用您的信息")).toBeTruthy();
  });
});
