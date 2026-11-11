// @vitest-environment jsdom
/**
 * 채팅 화면의 여정 배선(E70-b spec D7·비목표 「장소 상세에서 연 채팅」): 통로가 이어진 범용 채팅만 능력을 신고하고 카드에
 * 통로를 준다. [안내 시작]의 측위 대기는 이 화면의 통지 창구 하나로 알린다(새 live region 없음).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chat.opts = [];
});

vi.mock("next-intl", async () => {
  const m = await import("../../__tests__/stable-intl-mock");
  return m.stableIntlMock("ko");
});
const chat = vi.hoisted(() => ({ opts: [] as Array<{ placeContext?: unknown; journeyCapable?: boolean } | undefined> }));
vi.mock("@/hooks/useChat", () => ({
  useChat: (opts?: { placeContext?: unknown; journeyCapable?: boolean }) => {
    chat.opts.push(opts);
    return {
      messages: [{ id: "1", role: "assistant", text: "답" }],
      isLoading: false,
      error: null,
      progressCategories: [],
      sendMessage: vi.fn(),
      dismissError: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useChatSound", () => ({ useChatSound: () => ({ playSend: vi.fn(), playReceive: vi.fn() }) }));
vi.mock("@/hooks/useFollowUpSuggestions", () => ({
  useFollowUpSuggestions: () => ({ chips: [], fetch: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/hooks/useTtsPlayback", () => ({
  useTtsPlayback: () => ({ playingId: null, toggle: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/components/chat/ChatInput", () => ({ ChatInput: () => null }));
vi.mock("@/components/chat/FollowUpChips", () => ({ FollowUpChips: () => null }));
const PAYLOAD = vi.hoisted(() => ({ type: "journey" }));
vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({ onJourneyAction }: { onJourneyAction?: (p: unknown, o: { start: boolean }) => void }) => (
    <div>
      <p data-testid="card-channel">{onJourneyAction ? "on" : "off"}</p>
      <button type="button" onClick={() => onJourneyAction?.(PAYLOAD, { start: true })}>
        card-start
      </button>
      <button type="button" onClick={() => onJourneyAction?.(PAYLOAD, { start: false })}>
        card-open
      </button>
    </div>
  ),
}));

import { ChatInterface } from "../ChatInterface";

const place = { name: "광화문", lat: 37.571, lng: 126.976 };

describe("ChatInterface 여정 배선", () => {
  it("통로가 없으면 능력을 신고하지 않고 카드에도 통로가 없다", () => {
    render(<ChatInterface />);
    expect(chat.opts.at(-1)?.journeyCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("off");
  });

  it("범용 채팅에 통로가 오면 능력을 신고하고 카드에 통로를 준다", () => {
    render(<ChatInterface onJourneyAction={() => {}} />);
    expect(chat.opts.at(-1)?.journeyCapable).toBe(true);
    expect(screen.getByTestId("card-channel").textContent).toBe("on");
  });

  it("장소 앵커 채팅은 통로가 와도 신고하지 않고 카드에 통로를 주지 않는다", () => {
    render(<ChatInterface placeContext={place} onJourneyAction={() => {}} />);
    expect(chat.opts.at(-1)?.journeyCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("off");
  });

  it("[안내 시작]은 측위 대기를 화면의 통지 창구 하나로 알리고 통로로 넘긴다, [길찾기에서 열기]는 알리지 않는다", () => {
    const onJourneyAction = vi.fn();
    const { container } = render(<ChatInterface onJourneyAction={onJourneyAction} />);
    const regions = container.querySelectorAll("[aria-live]");
    expect(regions.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "card-open" }));
    expect(onJourneyAction).toHaveBeenLastCalledWith(PAYLOAD, { start: false });
    expect(regions[0].textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    expect(onJourneyAction).toHaveBeenLastCalledWith(PAYLOAD, { start: true });
    expect(regions[0].textContent).toBe("directions.locating");
    expect(regions[0].getAttribute("aria-live")).toBe("polite");
  });
});
