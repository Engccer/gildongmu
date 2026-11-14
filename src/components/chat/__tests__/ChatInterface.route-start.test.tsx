// @vitest-environment jsdom
/**
 * 채팅 화면의 경로 안내 시작 카드 배선(E83 spec R2): 통로가 이어진 범용 채팅만 능력을 신고하고 카드에 통로를 준다.
 * 여정 신고와 서로 독립이다. 위치를 새로 받는 대중교통 [안내 시작]의 대기만 이 화면의 통지 창구 하나로 알린다.
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
type Opts = { placeContext?: unknown; journeyCapable?: boolean; routeStartCapable?: boolean };
const chat = vi.hoisted(() => ({ opts: [] as Array<Opts | undefined> }));
vi.mock("@/hooks/useChat", () => ({
  useChat: (opts?: Opts) => {
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
const GROUP = vi.hoisted(() => ({ destLabel: "강남역" }));
type Action = { kind: "start"; mode: "walk" | "car" | "transit" } | { kind: "open" };
vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({ onRouteStartAction }: { onRouteStartAction?: (g: unknown, a: Action) => void }) => (
    <div>
      <p data-testid="card-channel">{onRouteStartAction ? "on" : "off"}</p>
      {(["walk", "car", "transit"] as const).map((mode) => (
        <button key={mode} type="button" onClick={() => onRouteStartAction?.(GROUP, { kind: "start", mode })}>
          {`card-start-${mode}`}
        </button>
      ))}
      <button type="button" onClick={() => onRouteStartAction?.(GROUP, { kind: "open" })}>
        card-open
      </button>
    </div>
  ),
}));

import { ChatInterface } from "../ChatInterface";

const place = { name: "광화문", lat: 37.571, lng: 126.976 };

describe("ChatInterface 경로 안내 시작 카드 배선", () => {
  it("통로가 없으면 능력을 신고하지 않고 카드에도 통로가 없다", () => {
    render(<ChatInterface />);
    expect(chat.opts.at(-1)?.routeStartCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("off");
  });

  it("범용 채팅에 통로가 오면 능력을 신고하고 카드에 통로를 준다(여정 통로가 없어도)", () => {
    render(<ChatInterface onRouteStartAction={() => {}} />);
    expect(chat.opts.at(-1)?.routeStartCapable).toBe(true);
    expect(chat.opts.at(-1)?.journeyCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("on");
  });

  it("여정 통로만 온 채팅은 이 능력을 신고하지 않는다(서로 독립)", () => {
    render(<ChatInterface onJourneyAction={() => {}} />);
    expect(chat.opts.at(-1)?.journeyCapable).toBe(true);
    expect(chat.opts.at(-1)?.routeStartCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("off");
  });

  it("장소 앵커 채팅은 통로가 와도 신고하지 않고 카드에 통로를 주지 않는다", () => {
    render(<ChatInterface placeContext={place} onRouteStartAction={() => {}} />);
    expect(chat.opts.at(-1)?.routeStartCapable).toBe(false);
    expect(screen.getByTestId("card-channel").textContent).toBe("off");
  });

  it("대중교통 [안내 시작]만 측위 대기를 화면의 통지 창구 하나로 알린다. 나머지 버튼은 알리지 않고 넘긴다", () => {
    const onRouteStartAction = vi.fn();
    const { container } = render(<ChatInterface onRouteStartAction={onRouteStartAction} />);
    const regions = container.querySelectorAll("[aria-live]");
    expect(regions.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "card-open" }));
    expect(onRouteStartAction).toHaveBeenLastCalledWith(GROUP, { kind: "open" });
    fireEvent.click(screen.getByRole("button", { name: "card-start-walk" }));
    expect(onRouteStartAction).toHaveBeenLastCalledWith(GROUP, { kind: "start", mode: "walk" });
    fireEvent.click(screen.getByRole("button", { name: "card-start-car" }));
    expect(onRouteStartAction).toHaveBeenLastCalledWith(GROUP, { kind: "start", mode: "car" });
    expect(regions[0].textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "card-start-transit" }));
    expect(onRouteStartAction).toHaveBeenLastCalledWith(GROUP, { kind: "start", mode: "transit" });
    expect(regions[0].textContent).toBe("directions.locating");
    expect(regions[0].getAttribute("aria-live")).toBe("polite");
  });
});
