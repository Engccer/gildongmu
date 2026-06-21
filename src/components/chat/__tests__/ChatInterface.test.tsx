// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// RTL 자동 cleanup은 vitest globals 미설정 시 등록되지 않는다 — 렌더 누수로 인한
// 테스트 간 DOM 누적(중복 텍스트 오탐)을 막기 위해 명시적으로 정리한다.
afterEach(() => cleanup());

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));
vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [{ id: "1", role: "assistant", text: "안녕하세요" }],
    isLoading: false,
    error: null,
    progressCategories: [],
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
  }),
}));
vi.mock("@/components/chat/ChatInput", () => ({ ChatInput: () => <div data-testid="chat-input" /> }));
vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { text: string } }) => <div>{message.text}</div>,
}));

import { ChatInterface } from "../ChatInterface";

describe("ChatInterface", () => {
  it("메시지와 입력창을 렌더", () => {
    render(<ChatInterface />);
    expect(screen.getByText("안녕하세요")).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
  });

  it("답변 텍스트는 DOM에 1회만 존재 — 산문 live region 복제로 인한 중복 낭독 방지", () => {
    // 과거엔 보이는 MessageBubble + sr-only 산문 live region 두 곳에 답변이 복제돼
    // 스크린 리더가 답변→카드→출처→(또)답변으로 중복 낭독했다. 산문 live region을
    // 제거해 답변은 MessageBubble 한 곳에만 존재한다.
    render(<ChatInterface />);
    expect(screen.getAllByText("안녕하세요")).toHaveLength(1);
  });

  it("진행 통지용 polite live region 존재(답변 산문 채널 아님)", () => {
    const { container } = render(<ChatInterface />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
