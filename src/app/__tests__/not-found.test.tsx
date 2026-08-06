// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFoundPage from "../not-found";

describe("NotFoundPage", () => {
  it("渲染 404 标题、说明和返回首页链接", () => {
    render(<NotFoundPage />);
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText("页面找不到了")).toBeTruthy();
    expect(screen.getByText("返回首页")).toBeTruthy();
  });
});
