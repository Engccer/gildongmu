// @vitest-environment jsdom
/**
 * PlaceSearch 모드 분기 테스트.
 * 핵심 케이스:
 * (1) canShowChat=false → ModeToggle 미렌더
 * (2) canShowChat=true → ModeToggle 렌더
 * (3) ModeToggle 클릭 → ChatInterface 마운트(채팅 모드 전환)
 *
 * 무거운 의존 컴포넌트는 모두 mock 처리해 격리한다.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// --- 기본 next-intl mock ---
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

// --- 내비게이션/지오로케이션 mock ---
vi.mock("@/hooks/useGeolocation", () => ({
  useGeolocation: () => ({ status: "idle" }),
}));
vi.mock("@/lib/geolocation", () => ({
  requestLocation: vi.fn(),
}));

// --- 검색 관련 모듈 mock ---
vi.mock("@/lib/search-sections", () => ({
  orderResultSections: () => [],
  combinedLiveMessage: () => null,
}));
vi.mock("@/lib/category", () => ({
  bucketsPresent: () => [],
  filterPlacesByBucket: (p: unknown[]) => p,
  groupByCategory: () => ({}),
}));
vi.mock("@/lib/region", () => ({
  regionsPresent: () => [],
  filterPlacesByRegion: (p: unknown[]) => p,
}));
vi.mock("@/lib/geo", () => ({
  sortPlacesByDistance: (p: unknown[]) => p,
}));

// --- 자식 컴포넌트들 mock ---
vi.mock("@/components/SearchBar", () => ({
  SearchBar: ({ inputRef }: { inputRef?: React.Ref<HTMLInputElement> }) => (
    <div data-testid="search-bar">
      <input ref={inputRef} data-testid="search-input" />
    </div>
  ),
}));
vi.mock("@/components/ChipFilter", () => ({ ChipFilter: () => null }));
vi.mock("@/components/ResultList", () => ({ ResultList: () => null }));
vi.mock("@/components/AddressResultList", () => ({ AddressResultList: () => null }));
vi.mock("@/components/PlaceDetail", () => ({ PlaceDetail: () => null }));
vi.mock("@/components/BusArrivals", () => ({ BusArrivals: () => null }));
vi.mock("@/components/BikeStations", () => ({ BikeStations: () => null }));
vi.mock("@/components/SubwayArrivalsNearby", () => ({ SubwayArrivalsNearby: () => null }));
vi.mock("@/components/NightClinicsNearby", () => ({ NightClinicsNearby: () => null }));
vi.mock("@/components/KidsPlacesNearby", () => ({ KidsPlacesNearby: () => null }));
vi.mock("@/components/SurroundingsNearby", () => ({ SurroundingsNearby: () => null }));

// --- ModeToggle / ChatInterface mock ---
// ModeToggle은 실제를 쓰되, ChatInterface는 무거운 hook 의존이 있어 mock 처리
vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    isLoading: false,
    error: null,
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
  }),
}));
vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: () => <div data-testid="chat-input-field" />,
}));
vi.mock("@/components/chat/MessageBubble", () => ({ MessageBubble: () => null }));

// React import (jsx 변환용)
import React from "react";
import { PlaceSearch } from "../PlaceSearch";

// window.history mock
const originalPushState = window.history.pushState.bind(window.history);
const originalReplaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  // URL 초기화 (mode 파라미터 없이)
  window.history.replaceState({}, "", "/ko");
  vi.spyOn(window.history, "replaceState").mockImplementation(originalReplaceState);
  // localStorage 초기화 (jsdom에서 사용 가능할 때만)
  if (typeof localStorage !== "undefined" && localStorage.clear) {
    localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlaceSearch 모드 분기", () => {
  it("canShowChat=false 이면 ModeToggle을 렌더하지 않는다", () => {
    render(
      <PlaceSearch
        isMockMode={false}
        canShowChat={false}
      />,
    );
    // ModeToggle이 없으면 '채팅' 관련 버튼이 없다
    const chatButtons = screen.queryAllByRole("button").filter((btn) => {
      const label = btn.getAttribute("aria-label") ?? btn.textContent ?? "";
      return label.includes("switchToChat") || label.includes("switchToSearch");
    });
    expect(chatButtons.length).toBe(0);
  });

  it("canShowChat=true 이면 ModeToggle이 렌더된다", async () => {
    render(
      <PlaceSearch
        isMockMode={false}
        canShowChat={true}
      />,
    );
    // ModeToggle이 있으면 switchToChat 라벨이 있는 버튼이 렌더된다
    const btn = await screen.findByRole("button", { name: /switchToChat/i });
    expect(btn).toBeTruthy();
  });

  it("ModeToggle 클릭 시 ChatInterface가 마운트된다", async () => {
    render(
      <PlaceSearch
        isMockMode={false}
        canShowChat={true}
      />,
    );

    // 검색창이 처음엔 보인다
    expect(screen.getByTestId("search-bar")).toBeTruthy();

    // ModeToggle 클릭 → chat 모드
    const toggleBtn = screen.getByRole("button", { name: /switchToChat/i });
    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    // ChatInterface (chat-input-field)가 마운트됐는지 확인
    expect(screen.getByTestId("chat-input-field")).toBeTruthy();
    // 검색창은 사라진다
    expect(screen.queryByTestId("search-bar")).toBeNull();
  });

  it("canShowChat=true 마운트 시 검색창에 자동 focus가 가지 않는다 (isMountRef 가드)", async () => {
    // jsdom에서 focus()는 document.activeElement를 바꾸지만
    // focus 이벤트가 항상 발화되지는 않는다. 대신 focus() 호출 횟수를 spy로 검증한다.
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
    await act(async () => {
      render(
        <PlaceSearch
          isMockMode={false}
          canShowChat={true}
        />,
      );
    });
    // isMountRef 가드로 마운트 직후에는 searchInputRef.current?.focus()가 호출되지 않는다.
    // (ModeToggle 클릭 없이 모드 변경이 없으므로 focus spy가 0회여야 함)
    const focusCalls = focusSpy.mock.calls.length;
    expect(focusCalls).toBe(0);
  });

  it("canShowChat=false 이면 전역 단축키 리스너를 등록하지 않는다", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    render(
      <PlaceSearch
        isMockMode={false}
        canShowChat={false}
      />,
    );
    // keydown 리스너가 등록되지 않았음을 확인
    const keydownListeners = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === "keydown",
    );
    expect(keydownListeners.length).toBe(0);
  });
});
