// @vitest-environment jsdom
/**
 * `PlaceSearch` × `HomeBridge`·`navigator`(spec 2026-08-29 §3.2·§5.2). 자식 뷰는 목킹하고 fetch를
 * deferred Promise로 막아 정착·superseded·언와인드를 결정론적으로 재현한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PlaceSearch } from "../PlaceSearch";
import { __resetViewRegistryForTest, bridgeOf, currentView, markModal, navigator, publishView, withdrawView } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest, acquireOp, releaseOp, type Op } from "@/lib/webmcp/tool-lock";
import { __resetOpenPlaceForTest } from "@/lib/place-open-request";
import type { HomeBridge } from "@/lib/webmcp/tools/context";
import type { JusoAddress, Place } from "@/lib/types";

vi.mock("next-intl", () => {
  const t = (k: string) => k;
  Object.assign(t, { rich: t, markup: t, raw: t, has: () => true });
  return { useTranslations: () => t, useLocale: () => "ko" };
});
// 음성 전사는 로딩 가드 없이 새 검색을 시작한다 — 사용자 우선(superseded) 재현용.
vi.mock("../VoiceRecordButton", () => ({
  VoiceRecordButton: ({ onTranscribed }: { onTranscribed: (text: string) => void }) => (
    <button type="button" onClick={() => onTranscribed("음성검색")}>
      voice
    </button>
  ),
}));
vi.mock("../NearbyHub", () => ({
  NearbyHub: ({ onBack }: { onBack: () => void }) => (
    <button type="button" onClick={onBack}>
      nearby-back
    </button>
  ),
}));
vi.mock("../DirectionsView", async () => {
  const { useEffect } = await import("react");
  const reg = await import("@/lib/webmcp/view-registry");
  return {
    DirectionsView: ({ onBack }: { onBack: () => void }) => {
      useEffect(() => {
        const bridge = { tag: "directions" };
        reg.publishView("directions", bridge);
        return () => reg.withdrawView("directions", bridge);
      }, []);
      return (
        <button type="button" onClick={onBack}>
          directions-back
        </button>
      );
    },
  };
});
vi.mock("../PlaceDetail", async () => {
  const { useEffect, useRef } = await import("react");
  const reg = await import("@/lib/webmcp/view-registry");
  return {
    PlaceDetail: ({ place, onBack }: { place: Place; onBack: () => void }) => {
      const h = useRef<HTMLHeadingElement>(null);
      // 실제 PlaceDetail처럼 마운트 착지(언와인드 억제 검출용).
      useEffect(() => {
        if (reg.isUnwinding()) return;
        h.current?.focus();
      }, [place.id]);
      useEffect(() => {
        const bridge = { placeId: place.id, read: () => ({ chatOpen: false }) };
        reg.publishView("place", bridge, place.id);
        return () => reg.withdrawView("place", bridge);
      }, [place.id]);
      return (
        <div>
          <h2 ref={h} tabIndex={-1}>{place.name}</h2>
          <button type="button" onClick={onBack}>
            place-back
          </button>
        </div>
      );
    },
  };
});

const p1: Place = { id: "p1", name: "강남역", category: "c", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02 };
const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro",
  zipNo: "05397",
  bdNm: "",
};
type Res = { ok: boolean; json: () => Promise<unknown> };
function deferred() {
  let resolve!: (v: Res) => void;
  const promise = new Promise<Res>((r) => (resolve = r));
  return { promise, resolve };
}
const okJson = (body: unknown): Res => ({ ok: true, json: async () => body });
function stubFetch(routes: Record<string, () => Promise<Res>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      calls.push(input);
      const hit = Object.entries(routes).find(([k]) => input.startsWith(k));
      if (!hit) return Promise.resolve(okJson({ places: [], addresses: [], web: [] }));
      return hit[1]();
    }),
  );
  return calls;
}
const op = () => acquireOp("t", undefined) as Op;
const home = () => bridgeOf<HomeBridge>("home")!.bridge;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

afterEach(() => {
  cleanup();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetOpenPlaceForTest();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("PlaceSearch × HomeBridge(spec §3.2·§5.2)", () => {
  it("홈 브릿지는 항상 게시되고 navigator가 있다", () => {
    stubFetch({});
    render(<PlaceSearch isMockMode={false} />);
    expect(bridgeOf("home")).not.toBeNull();
    expect(navigator()).not.toBeNull();
    expect(currentView()).toBe("home");
    expect(home().read()).toMatchObject({ query: "", attempt: null, branches: null, chatOpen: false });
  });

  it("runSearch는 세 분기 정착 뒤 settled를 주고 스냅샷을 동결한다(웹은 skipped)", async () => {
    const d = deferred();
    stubFetch({
      "/api/places": () => d.promise,
      "/api/address/search": () => Promise.resolve(okJson({ addresses: [] })),
    });
    render(<PlaceSearch isMockMode={false} canSearchAddress canSearchWeb />);
    const p = home().runSearch({ query: "강남역", sort: "accuracy" }, op());
    await act(async () => d.resolve(okJson({ places: [p1], total: 1 })));
    const r = await p;
    expect(r).toMatchObject({ kind: "settled", branches: { places: "done", addresses: "empty", web: "skipped" } });
    const attempt = (r as { attempt: number }).attempt;
    expect(home().snapshotFor(attempt)?.places[0].id).toBe("p1");
    expect(home().read()).toMatchObject({ query: "강남역", attempt, counts: { places: 1, addresses: 0, web: 0 } });
    // 입력창도 같은 검색어를 보인다(사용자가 한 것처럼).
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("강남역");
  });

  it("장소·주소 0건이면 웹 폴백까지 기다려 web done으로 정착한다", async () => {
    const web = deferred();
    stubFetch({
      "/api/places": () => Promise.resolve(okJson({ places: [], total: 0 })),
      "/api/address/search": () => Promise.resolve(okJson({ addresses: [] })),
      "/api/search/web": () => web.promise,
    });
    render(<PlaceSearch isMockMode={false} canSearchAddress canSearchWeb />);
    const p = home().runSearch({ query: "없는곳", sort: "accuracy" }, op());
    let settled = false;
    void p.then(() => (settled = true));
    await act(async () => {});
    expect(settled).toBe(false);
    await act(async () => web.resolve(okJson({ web: [{ title: "t", url: "https://a.b/x?lat=1", snippet: "s", date: null }] })));
    expect(await p).toMatchObject({ kind: "settled", branches: { places: "empty", addresses: "empty", web: "done" } });
    expect(home().read().webResults).toEqual([{ title: "t", url: "https://a.b/x?lat=1", snippet: "s" }]);
  });

  it("로딩 중 둘째 도구 검색은 busy, 대기 중 사용자 검색은 superseded, 언마운트는 aborted", async () => {
    const d1 = deferred();
    stubFetch({ "/api/places": () => d1.promise });
    const view = render(<PlaceSearch isMockMode={false} />);
    const o = op();
    const first = home().runSearch({ query: "하나", sort: "accuracy" }, o);
    expect(await home().runSearch({ query: "둘", sort: "accuracy" }, o)).toEqual({ kind: "busy" });
    // 사용자 음성 검색이 새 세대를 연다 — 앞 대기자는 superseded, 그 응답이 늦게 와도 무시된다.
    const d2 = deferred();
    stubFetch({ "/api/places": () => d2.promise });
    await act(async () => {
      screen.getByRole("button", { name: "voice" }).click();
    });
    expect(await first).toEqual({ kind: "superseded" });
    await act(async () => {
      d1.resolve(okJson({ places: [p1], total: 1 }));
      d2.resolve(okJson({ places: [], total: 0 }));
    });
    expect(home().read()).toMatchObject({ query: "음성검색", counts: { places: 0 } });
    // 언마운트는 대기자를 aborted로.
    const d3 = deferred();
    stubFetch({ "/api/places": () => d3.promise });
    const third = home().runSearch({ query: "넷", sort: "accuracy" }, o);
    await act(async () => {});
    view.unmount();
    expect(await third).toEqual({ kind: "aborted" });
    releaseOp(o);
  });

  it("toHome: 길찾기 위 상세에서 두 단계 언와인드, 중간 착지 0", async () => {
    stubFetch({ "/api/places": () => Promise.resolve(okJson({ places: [p1], total: 1 })) });
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    const o = op();
    await home().runSearch({ query: "강남역", sort: "accuracy" }, o);
    await nextFrame();
    act(() => navigator()!.toPlace(p1, o));
    await waitFor(() => expect(bridgeOf("place")?.identity).toBe("p1"));
    act(() => navigator()!.toDirections(o));
    await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
    expect(currentView()).toBe("directions");
    await act(async () => {
      await navigator()!.toHome(o);
    });
    expect(bridgeOf("directions")).toBeNull();
    expect(bridgeOf("place")).toBeNull();
    expect(currentView()).toBe("home");
    await nextFrame();
    // 언와인드의 중간 착지(결과 헤딩·상세 제목)가 없다.
    expect(document.activeElement).toBe(document.body);
    // 이미 홈이면 즉시 돌아온다.
    await navigator()!.toHome(o);
  });

  it("toHome 상한: 뒤로가기가 진전을 못 내면 viewChanging", async () => {
    stubFetch({});
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    const o = op();
    act(() => navigator()!.toDirections(o));
    await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
    // history.back을 무력화해 popstate가 오지 않게 한다(1초 × 3회).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    try {
      const p = navigator()!.toHome(o);
      let outcome: string | null = null;
      p.then(() => (outcome = "ok"), (e: Error) => (outcome = e.message));
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1_001);
      }
      expect(outcome).toBe("viewChanging");
      expect(back).toHaveBeenCalledTimes(3);
    } finally {
      back.mockRestore();
      vi.useRealTimers();
    }
  });

  it("isModalOpen: 범용 채팅·현재 위치 지정·상세 채팅·허브 모달 표식", () => {
    stubFetch({});
    render(<PlaceSearch isMockMode={false} />);
    expect(navigator()!.isModalOpen()).toBe(false);
    markModal("nearbyManualPicker", true);
    expect(navigator()!.isModalOpen()).toBe(true);
    markModal("nearbyManualPicker", false);
    const fake = { placeId: "x", read: () => ({ chatOpen: true }) };
    publishView("place", fake, "x");
    expect(navigator()!.isModalOpen()).toBe(true);
    withdrawView("place", fake);
    expect(navigator()!.isModalOpen()).toBe(false);
  });

  it("op가 끊기면 runSearch·toHome은 aborted, 끊긴 뒤 주소 실패는 coordError를 낭독하지 않는다", async () => {
    const d = deferred();
    // geocode는 signal abort에 reject하는 실제 fetch 동작을 흉내 낸다.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: { signal?: AbortSignal }) => {
        if (input.startsWith("/api/geocode")) {
          return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        return input.startsWith("/api/places") ? d.promise : Promise.resolve(okJson({ addresses: [] }));
      }),
    );
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    const host = new AbortController();
    const o = acquireOp("t", host.signal) as Op;
    const p = home().runSearch({ query: "강남역", sort: "accuracy" }, o);
    host.abort();
    expect(await p).toEqual({ kind: "aborted" });
    __resetToolLockForTest();
    const host2 = new AbortController();
    const o2 = acquireOp("t", host2.signal) as Op;
    const addr = home().openAddress(juso, o2);
    host2.abort();
    expect(await addr).toEqual({ ok: false, reason: "aborted" });
    expect(screen.queryByText("search.addressCoordFailed")).toBeNull();
  });

  it("openAddress는 주소 카드 탭과 같은 경로로 상세를 열고, 좌표 실패는 geocodeFailed", async () => {
    stubFetch({
      "/api/geocode": () => Promise.resolve(okJson({ matches: [{ lat: 37.53, lng: 127.12 }] })),
    });
    render(<PlaceSearch isMockMode={false} />);
    const o = op();
    expect(await home().openAddress(juso, o)).toEqual({ ok: true });
    await waitFor(() => expect(bridgeOf("place")).not.toBeNull());
    await act(async () => {
      await navigator()!.toHome(o);
    });
    stubFetch({ "/api/geocode": () => Promise.resolve({ ok: false, json: async () => ({}) }) });
    expect(await home().openAddress(juso, o)).toEqual({ ok: false, reason: "geocodeFailed" });
  });
});
