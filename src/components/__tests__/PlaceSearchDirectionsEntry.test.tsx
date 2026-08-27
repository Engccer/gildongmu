// @vitest-environment jsdom
/**
 * 길찾기 진입·복귀의 **사용자 동작** 회귀(W2 spec 2026-08-29 §8.4 — 삭제 승인 조건).
 * W1 홈 진입 도구·착지 도구가 지워져도 아래 두 동작은 그대로여야 한다:
 * ① 장소 상세 "여기까지 길찾기" → 길찾기 뷰가 그 장소를 도착지(좌표 endpoint)로 받는다.
 * ② 길찾기 뒤로가기 → 검색 결과 헤딩으로 포커스 복귀.
 * 자식 뷰는 목킹한다(`PlaceSearchWebMcp.test` 골격 동형) — 여기서 보는 것은 PlaceSearch의 배선이다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlaceSearch } from "../PlaceSearch";
import { __resetViewRegistryForTest } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest } from "@/lib/webmcp/tool-lock";
import { __resetOpenPlaceForTest } from "@/lib/place-open-request";
import type { DirEndpoint } from "@/lib/directions-state";
import type { Place } from "@/lib/types";

vi.mock("next-intl", () => {
  const t = (k: string) => k;
  Object.assign(t, { rich: t, markup: t, raw: t, has: () => true });
  return { useTranslations: () => t, useLocale: () => "ko" };
});
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../NearbyHub", () => ({ NearbyHub: () => null }));
vi.mock("../DirectionsView", () => ({
  DirectionsView: ({ initialTo, onBack }: { initialTo?: DirEndpoint | null; onBack: () => void }) => (
    <div>
      <p data-testid="initial-to">
        {!initialTo ? "none" : initialTo.kind === "current" ? "current" : `${initialTo.kind}:${initialTo.label}`}
      </p>
      <button type="button" onClick={onBack}>
        directions-back
      </button>
    </div>
  ),
}));
vi.mock("../PlaceDetail", () => ({
  PlaceDetail: ({ place, onOpenDirections }: { place: Place; onOpenDirections?: () => void }) => (
    <div>
      <h2 tabIndex={-1}>{place.name}</h2>
      {onOpenDirections && (
        <button type="button" onClick={onOpenDirections}>
          toHere
        </button>
      )}
    </div>
  ),
}));

const p1: Place = { id: "p1", name: "강남역", category: "지하철역", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02 };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.startsWith("/api/places")) return { ok: true, json: async () => ({ places: [p1], total: 1 }) };
      return { ok: true, json: async () => ({ places: [], addresses: [], web: [] }) };
    }),
  );
}

/** 사용자 검색: 검색창 입력 + 폼 제출 → 결과 항목이 나타날 때까지. */
async function searchAsUser() {
  const box = screen.getByRole("searchbox") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "강남역" } });
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(screen.getByRole("button", { name: /강남역/ })).toBeTruthy());
}

afterEach(() => {
  cleanup();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetOpenPlaceForTest();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("길찾기 진입·복귀 사용자 동작(W2 §8.4 회귀 고정)", () => {
  it("① 상세 '여기까지 길찾기' → 길찾기 뷰가 그 장소를 좌표 도착지로 받는다", async () => {
    stubFetch();
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    await searchAsUser();
    fireEvent.click(screen.getByRole("button", { name: /강남역/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "toHere" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "toHere" }));
    await waitFor(() => expect(screen.getByTestId("initial-to").textContent).toBe("place:강남역"));
  });

  it("② 길찾기 뒤로가기 → 검색 결과 헤딩으로 포커스 복귀", async () => {
    stubFetch();
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    await searchAsUser();
    // 홈 "길찾기" 칩(도착지 없음).
    fireEvent.click(screen.getByRole("button", { name: "directions.title" }));
    await waitFor(() => expect(screen.getByTestId("initial-to").textContent).toBe("none"));
    fireEvent.click(screen.getByRole("button", { name: "directions-back" }));
    // history.back() → popstate → onPop → 결과 헤딩(h2, tabIndex -1) rAF 착지.
    await waitFor(() => {
      expect(screen.queryByTestId("initial-to")).toBeNull();
      const active = document.activeElement as HTMLElement | null;
      expect(active?.tagName).toBe("H2");
      expect(active?.getAttribute("tabindex")).toBe("-1");
    });
  });
});
