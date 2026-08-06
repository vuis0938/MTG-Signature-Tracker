// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ErrorPage from "../error";

const reportErrorMock = vi.fn();

vi.mock("@/lib/error-reporter", () => ({
  reportError: (...args: unknown[]) => reportErrorMock(...args),
}));

describe("ErrorPage", () => {
  beforeEach(() => {
    reportErrorMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染错误标题、错误编号和重试按钮", () => {
    const error = new Error("test error") as Error & { digest?: string };
    error.digest = "digest-123";
    const reset = vi.fn();

    render(<ErrorPage error={error} reset={reset} />);
    expect(screen.getByText("出错了")).toBeTruthy();
    expect(screen.getByText("页面加载时发生异常")).toBeTruthy();
    expect(screen.getByText("错误编号：digest-123")).toBeTruthy();
    expect(screen.getByText("重试")).toBeTruthy();
    expect(screen.getByText("返回首页")).toBeTruthy();
  });

  it("挂载后将错误上报到服务端", async () => {
    const error = new Error("report me") as Error & { digest?: string };
    error.digest = "digest-456";
    render(<ErrorPage error={error} reset={vi.fn()} />);

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(reportErrorMock).toHaveBeenCalledWith(error);
    });
  });

  it("点击重试调用 reset 回调", () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error("test")} reset={reset} />);
    fireEvent.click(screen.getByText("重试"));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
