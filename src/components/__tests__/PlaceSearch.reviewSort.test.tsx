// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest } from "@/lib/manual-location-store";
import { PlaceSearch } from "../PlaceSearch";

afterEach(cleanup);

/**
 * 리뷰순 토글 계약(spec 2026-08-17 §4): 노출 조건(ko + 네이버 키), 라벨 전환이 상태 신호,
 * 재조회 중 포커스 유지·aria-disabled(disabled 금지)·in-flight 가드, ?sort=review 동기화.
 */
const place = (id: string) => ({
  id, name: id, category: "음식점", address: "서울", roadAddress: "서울", lat: 37.5, lng: 127.1,
});

function renderHome(props: { canSortByReview?: boolean; locale?: "ko" | "en" } = {}) {
  const locale = props.locale ?? "ko";
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "ko" ? ko : en}>
      <PlaceSearch isMockMode={false} canSortByReview={props.canSortByReview ?? true} />
    </NextIntlClientProvider>,
  );
}

async function submitQuery(q: string) {
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: q } });
  fireEvent.submit(input.closest("form")!);
}

describe("PlaceSearch — 리뷰순 토글", () => {
  const fetchUrls: string[] = [];
  let pending: Array<() => void> = [];
  let holdFetch = false;

  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    fetchUrls.length = 0;
    pending = [];
    holdFetch = false;
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: 37.5, longitude: 127.1, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      const body = url.includes("sort=review")
        ? { provider: "naver-local", query: "q", places: [place("리뷰1"), place("리뷰2")] }
        : { provider: "kakao-local", query: "q", places: [place("정확1")] };
      const respond = () => new Response(JSON.stringify(body), { status: 200 });
      if (!holdFetch) return Promise.resolve(respond());
      return new Promise<Response>((resolve) => pending.push(() => resolve(respond())));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ko+키: 검색 후 토글이 뜨고, 누르면 sort=review로 재조회·라벨 전환·포커스 유지·URL 동기화", async () => {
    renderHome();
    await submitQuery("길동 맛집");
    const toggle = await screen.findByRole("button", { name: "네이버 리뷰순으로 보기" });
    // 첫 검색의 헤딩 착지(rAF)가 끝난 뒤 사용자가 토글로 이동하는 실제 순서를 재현한다.
    await screen.findByText("정확1");
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(fetchUrls.some((u) => u.includes("/api/places?") && u.includes("sort=review"))).toBe(true));
    await screen.findByRole("button", { name: "정확도순으로 보기" });
    // 정렬 전환은 첫 결과 착지 계약 비적용 — 포커스가 토글에 남는다. 헤딩 착지는
    // rAF 뒤에 일어나므로 rAF 두 틱을 기다린 뒤 판정해야 검출력이 있다(변이로 확인).
    await screen.findByText("리뷰1");
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    expect(document.activeElement).toBe(toggle);
    expect(new URL(window.location.href).searchParams.get("sort")).toBe("review");
    // 되돌리면 sort 파라미터가 사라진다.
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "네이버 리뷰순으로 보기" });
    await waitFor(() => expect(new URL(window.location.href).searchParams.has("sort")).toBe(false));
  });

  it("검색 전(idle)에는 토글이 없다", () => {
    renderHome();
    expect(screen.queryByRole("button", { name: "네이버 리뷰순으로 보기" })).toBeNull();
  });

  it("네이버 키가 없으면 토글이 없다", async () => {
    renderHome({ canSortByReview: false });
    await submitQuery("길동 맛집");
    await screen.findByText("정확1");
    expect(screen.queryByRole("button", { name: "네이버 리뷰순으로 보기" })).toBeNull();
  });

  it("en 로케일이면 키가 있어도 토글이 없다(네이버는 한국어 전용)", async () => {
    renderHome({ locale: "en" });
    await submitQuery("gildong");
    await screen.findByText("정확1");
    expect(screen.queryByRole("button", { name: /Naver/ })).toBeNull();
  });

  it("재조회 중 토글은 disabled가 아니라 aria-disabled이고 재클릭은 무시된다(fetch 1회)", async () => {
    renderHome();
    await submitQuery("길동 맛집");
    const toggle = await screen.findByRole("button", { name: "네이버 리뷰순으로 보기" });
    holdFetch = true;
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBe("true"));
    expect(toggle.hasAttribute("disabled")).toBe(false);
    const reviewCalls = fetchUrls.filter((u) => u.includes("sort=review")).length;
    expect(reviewCalls).toBe(1);
    pending.forEach((r) => r());
    await screen.findByRole("button", { name: "정확도순으로 보기" });
  });

  it("?sort=review 진입은 리뷰순으로 자동검색한다", async () => {
    window.history.replaceState(null, "", "/?q=길동%20맛집&sort=review");
    renderHome();
    await screen.findByText("리뷰1");
    await screen.findByRole("button", { name: "정확도순으로 보기" });
  });
});
