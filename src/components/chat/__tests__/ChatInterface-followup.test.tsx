// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ChatMessage } from "@/lib/chat/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));
vi.mock("@/components/VoiceRecordButton", () => ({ VoiceRecordButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatSound", () => ({
  useChatSound: () => ({ playSend: vi.fn(), playReceive: vi.fn() }),
}));

// useChat mock — 테스트가 messages·isLoading을 직접 밀어 넣어 "응답 완료" 전이를 재현한다.
const chatState: { messages: ChatMessage[]; isLoading: boolean } = { messages: [], isLoading: false };
const sendMessage = vi.fn();
vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: chatState.messages,
    isLoading: chatState.isLoading,
    error: null,
    progressCategories: [],
    sendMessage,
    dismissError: vi.fn(),
  }),
}));
vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { text: string } }) => <div>{message.text}</div>,
}));

import { ChatInterface } from "../ChatInterface";

const user: ChatMessage = { id: "u1", role: "user", text: "강동역 근처 카페" };
const assistant: ChatMessage = { id: "a1", role: "assistant", text: "카페 세 곳이 있습니다." };

beforeEach(() => {
  sendMessage.mockReset();
  chatState.messages = [];
  chatState.isLoading = false;
});

/** 로딩 중 → 완료(assistant 도착) 전이를 한 번 재현한다. 두 렌더는 act를 나눠야
 *  합쳐지지 않고 isLoading=true 상태가 실제로 관측된다. */
async function finishTurn(rerender: (ui: React.ReactElement) => void, props = {}) {
  chatState.messages = [user];
  chatState.isLoading = true;
  await act(async () => rerender(<ChatInterface {...props} />));
  chatState.messages = [user, assistant];
  chatState.isLoading = false;
  await act(async () => rerender(<ChatInterface {...props} />));
}

describe("ChatInterface follow-up 칩", () => {
  it("응답 완료 시 /api/chat/suggestions를 마지막 질문·답변·locale·placeName으로 호출하고 칩을 렌더한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: ["칩1", "칩2", "칩3"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const props = { placeContext: { name: "강동역", lat: 37.5, lng: 127.1 } };
    const { rerender } = render(<ChatInterface {...props} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await finishTurn(rerender, props);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/suggestions");
    expect(JSON.parse(init.body)).toEqual({
      lastUserMessage: user.text,
      lastAssistantMessage: assistant.text,
      locale: "ko",
      placeName: "강동역",
    });
    await waitFor(() => expect(screen.getByRole("group", { name: "followUpGroupLabel" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "칩2" })).toBeTruthy();
  });

  it("칩 클릭 → 보내기 버튼에 포커스 선점 후 전송, 칩은 사라진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: ["칩1"] }) }),
    );
    const { rerender } = render(<ChatInterface />);
    await finishTurn(rerender);
    const chip = await screen.findByRole("button", { name: "칩1" });

    fireEvent.click(chip);

    expect(sendMessage).toHaveBeenCalledWith("칩1");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "send" })));
    expect(screen.queryByRole("group", { name: "followUpGroupLabel" })).toBeNull();
  });

  it("빈 상태 예시 버튼도 같은 포커스 선점을 거쳐 전송한다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ChatInterface examplePrompts={["예시 질문"]} />);
    fireEvent.click(screen.getByRole("button", { name: "예시 질문" }));
    expect(sendMessage).toHaveBeenCalledWith("예시 질문");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "send" })));
  });

  it("전송 중(isLoading)엔 칩이 aria-disabled이고 클릭해도 전송하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: ["칩1"] }) }),
    );
    const { rerender } = render(<ChatInterface />);
    await finishTurn(rerender);
    await screen.findByRole("button", { name: "칩1" });
    chatState.isLoading = true;
    rerender(<ChatInterface />);
    const chip = screen.getByRole("button", { name: "칩1" });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(chip);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
