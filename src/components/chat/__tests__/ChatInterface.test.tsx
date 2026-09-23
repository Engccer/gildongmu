// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// RTL 자동 cleanup은 vitest globals 미설정 시 등록되지 않는다 — 렌더 누수로 인한
// 테스트 간 DOM 누적(중복 텍스트 오탐)을 막기 위해 명시적으로 정리한다.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));
vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [{ id: "1", role: "assistant", text: "안녕하세요" }, { id: "2", role: "assistant", text: "**둘째** 답" }],
    isLoading: false,
    error: null,
    progressCategories: [],
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
  }),
}));
vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: ({ onDictationPress }: { onDictationPress?: () => void }) => (
    <div data-testid="chat-input">
      <button type="button" onClick={onDictationPress}>
        mic
      </button>
    </div>
  ),
}));
vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({
    message,
    listening,
    onCopied,
    onToggleListen,
  }: {
    message: { text: string };
    listening?: boolean;
    onCopied?: () => void;
    onToggleListen?: () => void;
  }) => (
    <div>
      {message.text}
      <button type="button" onClick={onCopied}>
        copied-stub
      </button>
      <button type="button" onClick={onToggleListen}>
        {listening ? "stop-stub" : "listen-stub"}
      </button>
    </div>
  ),
}));
// 듣기 훅은 단위 테스트가 따로 있다 — 여기선 화면 배선(토글 인자·받아쓰기 정지·실패 통지)만 본다.
const tts = vi.hoisted(() => ({
  toggle: vi.fn(),
  stop: vi.fn(),
  playingId: null as string | null,
  onFailed: null as null | (() => void),
}));
vi.mock("@/hooks/useTtsPlayback", () => ({
  useTtsPlayback: (_locale: string, onFailed: () => void) => {
    tts.onFailed = onFailed;
    return { playingId: tts.playingId, toggle: tts.toggle, stop: tts.stop };
  },
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

  describe("복사·듣기 통지(B12)", () => {
    function politeRegions(container: HTMLElement) {
      return container.querySelectorAll('[aria-live="polite"]');
    }

    it("복사됨은 기존 진행 통지 창구 하나로만 나가고, 연속 복사도 매번 DOM을 바꾼다", async () => {
      const { container } = render(<ChatInterface />);
      expect(politeRegions(container)).toHaveLength(1);
      const region = politeRegions(container)[0];
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.filter((r) => r.type === "childList" && r.addedNodes.length > 0).length;
      });
      observer.observe(region, { childList: true, subtree: true, characterData: true });
      fireEvent.click(screen.getAllByText("copied-stub")[0]);
      await act(async () => {});
      expect(region.textContent).toBe("copied");
      // 같은 문장 연속 게시 — React 동일 값 bail out이면 침묵한다. 텍스트 노드를 새로 넣어야 한다.
      fireEvent.click(screen.getAllByText("copied-stub")[0]);
      await act(async () => {});
      observer.disconnect();
      expect(mutations).toBe(2);
      // 통지 문장은 화면에 한 번만(새 live region·복제 없음)
      expect(screen.getAllByText("copied")).toHaveLength(1);
      expect(politeRegions(container)).toHaveLength(1);
    });

    it("복사됨은 2초 뒤 비워진다", () => {
      vi.useFakeTimers();
      const { container } = render(<ChatInterface />);
      fireEvent.click(screen.getAllByText("copied-stub")[0]);
      expect(politeRegions(container)[0].textContent).toBe("copied");
      act(() => vi.advanceTimersByTime(2000));
      expect(politeRegions(container)[0].textContent).toBe("");
      vi.useRealTimers();
    });

    it("듣기는 메시지 id와 평문으로 토글하고, 재생 중인 답변만 라벨이 바뀐다", () => {
      tts.playingId = "2";
      render(<ChatInterface />);
      expect(screen.getAllByText("listen-stub")).toHaveLength(1);
      expect(screen.getAllByText("stop-stub")).toHaveLength(1);
      fireEvent.click(screen.getAllByText("listen-stub")[0]);
      expect(tts.toggle).toHaveBeenCalledWith("1", "안녕하세요");
      fireEvent.click(screen.getByText("stop-stub"));
      expect(tts.toggle).toHaveBeenLastCalledWith("2", "둘째 답");
      tts.playingId = null;
    });

    it("받아쓰기 버튼을 누르면 듣기를 멈춘다", () => {
      render(<ChatInterface />);
      fireEvent.click(screen.getByText("mic"));
      expect(tts.stop).toHaveBeenCalledTimes(1);
    });

    it("듣기 실패는 같은 창구로 통지한다(침묵 금지)", () => {
      const { container } = render(<ChatInterface />);
      act(() => tts.onFailed?.());
      expect(politeRegions(container)[0].textContent).toBe("listenFailed");
    });
  });
});
