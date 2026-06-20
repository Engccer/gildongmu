// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
    // live region + MessageBubble 둘 다 텍스트를 가질 수 있으므로 getAllByText 사용
    expect(screen.getAllByText("안녕하세요").length).toBeGreaterThan(0);
    expect(screen.getByTestId("chat-input")).toBeTruthy();
  });

  it("polite live region 존재", () => {
    const { container } = render(<ChatInterface />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
