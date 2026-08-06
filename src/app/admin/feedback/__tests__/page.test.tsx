// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FeedbackPage from "../page";
import { ToastProvider } from "@/lib/toast-context";

// ═════════════════════════════════════════════════════════════
// 反馈管理页测试
//
// 重点覆盖复制按钮交互，以及已读/删除等状态变更。
// 注意：本项目 Vitest 未配置 jest-dom matchers，因此使用 toBeTruthy/toBeNull。
// ═════════════════════════════════════════════════════════════

const mockFeedback = [
  {
    id: "fb-1",
    user_name: "用户 A",
    category: "bug",
    content: "页面加载很慢",
    is_read: false,
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    id: "fb-2",
    user_name: "用户 B",
    category: "suggestion",
    content: "建议增加导出功能",
    is_read: true,
    created_at: "2026-08-02T12:30:00Z",
  },
];

function setupFetch(response: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(response), { status: 200 })
  );
}

function renderPage() {
  return render(
    <ToastProvider>
      <FeedbackPage />
    </ToastProvider>
  );
}

describe("FeedbackPage", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载并展示反馈列表", async () => {
    setupFetch({ success: true, feedback: mockFeedback });
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("页面加载很慢")).toBeTruthy();
      expect(screen.queryByText("建议增加导出功能")).toBeTruthy();
    });
  });

  it("点击复制按钮将反馈内容写入剪贴板", async () => {
    setupFetch({ success: true, feedback: mockFeedback });
    renderPage();

    await waitFor(() => expect(screen.queryByText("页面加载很慢")).toBeTruthy());

    const copyButtons = screen.getAllByTitle("复制反馈内容");
    expect(copyButtons.length).toBe(2);

    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(written).toContain("[Bug 反馈]");
      expect(written).toContain("用户 A");
      expect(written).toContain("页面加载很慢");
    });
  });

  it("复制成功后按钮显示勾选图标", async () => {
    setupFetch({ success: true, feedback: mockFeedback });
    renderPage();

    await waitFor(() => expect(screen.queryByText("页面加载很慢")).toBeTruthy());

    const copyButton = screen.getAllByTitle("复制反馈内容")[0];
    fireEvent.click(copyButton);

    await waitFor(() => {
      // copiedId 状态会触发重新渲染，第一个复制按钮内应出现 title 为空的 Check 图标
      expect(copyButton.querySelector("svg")).toBeTruthy();
    });
  });

  it("标记已读发起正确请求", async () => {
    setupFetch({ success: true, feedback: mockFeedback });
    const fetchSpy = vi.spyOn(global, "fetch");

    renderPage();

    await waitFor(() => expect(screen.queryByText("页面加载很慢")).toBeTruthy());

    // 第一个反馈未读，应存在标记已读按钮
    const readButton = screen.getByTitle("标记已读");
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    fireEvent.click(readButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/feedback",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ id: "fb-1" }),
        })
      );
    });
  });

  it("删除反馈后从列表移除", async () => {
    setupFetch({ success: true, feedback: mockFeedback });
    const fetchSpy = vi.spyOn(global, "fetch");

    renderPage();

    await waitFor(() => expect(screen.queryByText("页面加载很慢")).toBeTruthy());

    const deleteButtons = screen.getAllByTitle("删除");
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/feedback?id=fb-1",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(screen.queryByText("页面加载很慢")).toBeNull();
    });
  });
});
