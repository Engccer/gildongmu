// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearbyPanelShell } from "../NearbyPanelShell";
import { useRevealMore } from "@/hooks/useRevealMore";

/**
 * `NearbyPanelShell`(nearby 8종 렌더 골격)과 `useRevealMore`("더 보기" 단계 공개 훅)의
 * 단위 계약 — Task 7~9가 이 두 시그니처를 소비하기 전에 계약을 못 박는다.
 * 기존 컴포넌트(`NightClinicsNearby.tsx` 등)의 계약 테스트는 무수정이며, 이 파일은
 * 그 골격을 추출한 두 신규 파일만 겨냥한다.
 */

afterEach(cleanup);

type ShellProps = ComponentProps<typeof NearbyPanelShell>;

function renderShell(overrides: Partial<ShellProps> = {}) {
  const triggerRef = createRef<HTMLButtonElement>();
  const headingRef = createRef<HTMLHeadingElement>();
  const onTrigger = vi.fn();
  const props: ShellProps = {
    triggerLabel: "조회",
    onTrigger,
    triggerRef,
    busy: false,
    live: "",
    open: false,
    heading: "결과 제목",
    headingRef,
    children: <p data-testid="children">내용</p>,
    ...overrides,
  };
  const view = render(<NearbyPanelShell {...props} />);
  return { ...view, onTrigger, triggerRef, headingRef };
}

describe("NearbyPanelShell", () => {
  it("showTrigger가 false면 트리거 버튼이 없고 live region은 존재한다", () => {
    renderShell({ showTrigger: false, live: "안내 문구" });
    expect(screen.queryByRole("button", { name: "조회" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("안내 문구");
  });

  it("open이 false면 패널이 렌더되지 않는다", () => {
    renderShell({ open: false });
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.queryByTestId("children")).toBeNull();
  });

  it("notice는 h3과 닫기 버튼 사이 DOM 순서로 렌더된다", () => {
    renderShell({
      open: true,
      notice: <p data-testid="notice">공지 문구</p>,
      onClose: vi.fn(),
      closeLabel: "닫기",
    });
    const heading = screen.getByRole("heading", { level: 3 });
    const notice = screen.getByTestId("notice");
    const closeButton = screen.getByRole("button", { name: "닫기" });
    expect(
      heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notice.compareDocumentPosition(closeButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("source가 있으면 각주를 렌더한다", () => {
    renderShell({ open: true, source: "출처: 테스트" });
    expect(screen.getByText("출처: 테스트")).not.toBeNull();
  });

  it("source가 없으면 각주를 렌더하지 않는다", () => {
    renderShell({ open: true, source: undefined });
    expect(screen.queryByText(/^출처/)).toBeNull();
  });

  it("onClose가 undefined면 닫기 버튼을 렌더하지 않는다", () => {
    renderShell({ open: true, onClose: undefined });
    expect(screen.queryByRole("button", { name: "닫기" })).toBeNull();
  });
});

/** `itemHeadingRefs`에 항목 헤딩을 배선하는 최소 소비자(실사용 8종의 렌더 형태 축약). */
function RevealHarness({ resetKey }: { resetKey: number }) {
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(resetKey);
  return (
    <div>
      <p data-testid="count">{visibleCount}</p>
      <button type="button" onClick={reveal}>
        더 보기
      </button>
      <ul>
        {Array.from({ length: visibleCount }, (_, i) => (
          <li key={i}>
            <h4
              tabIndex={-1}
              ref={(el) => {
                itemHeadingRefs.current[i] = el;
              }}
            >
              항목 {i}
            </h4>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("useRevealMore", () => {
  it("resetKey가 바뀌면 같은 렌더에서 초기 표시 수로 복귀한다(글리치 없음)", () => {
    const { rerender } = render(<RevealHarness resetKey={1} />);
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(screen.getByTestId("count").textContent).toBe("20");

    rerender(<RevealHarness resetKey={2} />);
    // rerender 직후 동기 단언 — act()·waitFor 없이 이미 10이면, 렌더 단계 리셋이
    // 별도 커밋(중간값이 화면에 비치는 프레임)을 만들지 않았다는 뜻이다.
    expect(screen.getByTestId("count").textContent).toBe("10");
  });

  it("reveal 호출 시 count가 +10 되고 새로 공개된 첫 항목으로 포커스 이동한다", () => {
    render(<RevealHarness resetKey={1} />);
    expect(screen.getByTestId("count").textContent).toBe("10");

    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));

    expect(screen.getByTestId("count").textContent).toBe("20");
    expect(document.activeElement).toBe(screen.getByText("항목 10"));
  });
});
