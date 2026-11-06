// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JourneyResult, Place } from "@/lib/types";
import { placeEndpoint } from "@/lib/directions-state";
import { clearRecentRoutes, recordRecentRoute } from "@/lib/recent-searches";
import { anyModalOpen, bridgeOf } from "@/lib/webmcp/view-registry";
import type { DirectionsBridge } from "@/lib/webmcp/tools/context";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
// 스냅샷은 고정 참조여야 한다(`useSyncExternalStore` — 새 객체를 주면 무한 렌더).
const IDLE = vi.hoisted(() => ({ status: "idle" as const }));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => IDLE,
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => IDLE,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
vi.mock("../DistanceBeacon", () => ({ DistanceBeacon: () => null }));

import { DirectionsView } from "../DirectionsView";

const ahyeonStation: Place = {
  id: "p-ahyeon",
  name: "아현역 2호선",
  category: "교통,수송 > 지하철,전철 > 수도권2호선",
  address: "서울 마포구 아현동",
  roadAddress: "서울 마포구 신촌로 지하270",
  lat: 37.5577,
  lng: 126.9562,
};
const cafe: Place = {
  id: "p-cafe",
  name: "아현 카페",
  category: "음식점 > 카페",
  address: "서울 마포구 아현동 1",
  roadAddress: "",
  lat: 37.556,
  lng: 126.955,
};

const journey: JourneyResult = {
  variants: [
    {
      kind: "designated",
      boardStation: { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } },
      taxiIn: { durationSeconds: 480, taxiFare: 7800 } as JourneyResult["variants"][number]["taxiIn"],
      transit: {
        routeKey: "r0",
        legs: [{ mode: "subway", fromName: "아현", toName: "광화문", lineName: "수도권 2호선" }],
        summary: { totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 0 },
      } as unknown as JourneyResult["variants"][number]["transit"],
      totals: { minutes: 30, taxiFare: 7800, transitFare: 1550 },
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
/** 여정 조회 응답(케이스가 바꿔 끼운다): 기본은 찾음. */
let journeyResponse: () => Response = () => ({ ok: true, json: async () => journey }) as Response;
beforeEach(() => {
  journeyResponse = () => ({ ok: true, json: async () => journey }) as Response;
  clearRecentRoutes();
  // 경유지 확정은 `?dir=`에 경유지를 남긴다 — 다음 케이스의 첫 화면이 경유지 복원으로 시작하지 않게 비운다.
  window.history.replaceState(null, "", "/");
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/places")) {
      return { ok: true, json: async () => ({ places: [cafe, ahyeonStation], provider: "kakao-local", query: "q" }) } as Response;
    }
    if (url.startsWith("/api/route/journey?")) return journeyResponse();
    if (url.startsWith("/api/address/search")) return { ok: true, json: async () => ({ addresses: [] }) } as Response;
    if (url.startsWith("/api/route/journey/stops?")) {
      return {
        ok: true,
        json: async () => ({ stops: [{ name: "아현역", lat: 37.5571, lng: 126.9555, stopNo: "13001", source: "seoul" }] }),
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const from = placeEndpoint("집", { lat: 37.55, lng: 126.95 }, null);
const to = placeEndpoint("광화문", { lat: 37.571, lng: 126.976 }, null);

function renderView(canPlanJourney: boolean) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      canPlanJourney={canPlanJourney}
      canSearchJourneyStops
      initialFrom={from}
      initialTo={to}
      onBack={() => {}}
    />,
  );
}

/** 입구 칸을 펼쳐 「아현」을 검색한다(E77 — 끝점 칸과 같은 장소 검색 + 정류장 줄). */
async function searchTransfer() {
  fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
  // 펼침은 다음 프레임에 입력으로 포커스를 준다 — 그 이동이 끝난 뒤 진행해야 뒤의 포커스 단언이 그 이동과 겹치지 않는다.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("transferField")));
  fireEvent.change(screen.getByLabelText("transferField"), { target: { value: "아현" } });
  fireEvent.click(screen.getByRole("button", { name: "searchField" }));
  await screen.findByRole("button", { name: /아현역 2호선/ });
}

/** 입구 칸에서 아현역을 골라 짐작(출발지 쪽 — 집이 더 가깝다)에 「네」로 답한다 → 승차 쪽 칸. */
async function pickBoardStation() {
  await searchTransfer();
  fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
  fireEvent.click(await screen.findByRole("button", { name: "answerYesBoardSubway" }));
}

describe("여정 웹 입구(E70-f · E77)", () => {
  it("게이트가 거짓이면 종전 「경유지 추가」 버튼만 있다", () => {
    renderView(false);
    expect(screen.getByRole("button", { name: "addVia" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "addMenu" })).toBeNull();
  });

  it("입구는 disclosure이고 누르면 메뉴 없이 검색 칸 하나가 펼쳐져 입력으로 착지한다, 다시 누르면 접힌다(검색 취소)", async () => {
    renderView(true);
    const entry = screen.getByRole("button", { name: "addMenu" });
    expect(entry.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(entry);
    expect(entry.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByLabelText("transferField");
    await waitFor(() => expect(document.activeElement).toBe(input));
    for (const name of ["addVia", "addBoardStation", "addAlightStation"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    fireEvent.click(entry);
    expect(screen.queryByLabelText("transferField")).toBeNull();
    expect(screen.queryByLabelText("via")).toBeNull();
  });

  it("후보는 장소 전부 + 정류장 줄이고, 역이 아닌 장소는 질문 없이 경유지가 된다", async () => {
    renderView(true);
    await searchTransfer();
    expect(screen.getByRole("button", { name: /아현 카페/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^아현역, busStopKind/ })).toBeTruthy();
    const stopsUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/route/journey/stops?"));
    expect(stopsUrl).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /아현 카페/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("via") as HTMLInputElement).value).toBe("아현 카페");
    expect(screen.getByRole("button", { name: "removeVia" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" }));
  });

  it("역을 고르면 질문 문장 → 짐작 버튼 순서의 대화상자가 열리고 버튼 1에 착지한다", async () => {
    renderView(true);
    await searchTransfer();
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    const dialog = await screen.findByRole("dialog", { name: "askBoardSubway" });
    const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toEqual(["answerYesBoardSubway", "answerNoAlightSubway", "answerViaOnly", "close"]);
    const question = dialog.querySelector("p")!;
    expect(question.compareDocumentPosition(dialog.querySelector("button")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("answerYesBoardSubway"));
    // 과잉 ARIA 없음: 이름은 질문 문장 하나(aria-labelledby), role·aria-modal을 덧씌우지 않는다.
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.getAttribute("role")).toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
  });

  it("답이 「네」면 승차 쪽 칸이 종류별 이름으로 서고 커서가 그 칸으로 간다, 남은 쪽은 종전 버튼이다(두 번째는 묻지 않는다)", async () => {
    renderView(true);
    await pickBoardStation();
    expect(screen.queryByRole("dialog")).toBeNull();
    const field = screen.getByLabelText("boardFieldStation") as HTMLInputElement;
    expect(field.value).toBe("아현역 2호선");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByRole("button", { name: "addMenu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "addVia" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "addAlightStation" }));
    const alight = screen.getByLabelText("alightField");
    await waitFor(() => expect(document.activeElement).toBe(alight));
    fireEvent.change(alight, { target: { value: "아현" } });
    const searchButtons = screen.getAllByRole("button", { name: "searchField" });
    fireEvent.click(searchButtons[searchButtons.length - 1]);
    fireEvent.click(await screen.findByRole("button", { name: /아현역 2호선, 서울/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("alightFieldStation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "clearStations" }));
    expect(screen.queryByLabelText("boardFieldStation")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" }));
    expect(screen.getByRole("button", { name: "addMenu" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("버튼 2(짐작과 반대)는 하차 쪽 칸, 「경유만」은 경유지가 된다", async () => {
    renderView(true);
    await searchTransfer();
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    fireEvent.click(await screen.findByRole("button", { name: "answerNoAlightSubway" }));
    const alight = screen.getByLabelText("alightFieldStation") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(alight));
    fireEvent.click(screen.getByRole("button", { name: "clearStations" }));

    await searchTransfer();
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    fireEvent.click(await screen.findByRole("button", { name: "answerViaOnly" }));
    const via = screen.getByLabelText("via") as HTMLInputElement;
    expect(via.value).toBe("아현역 2호선");
    await waitFor(() => expect(document.activeElement).toBe(via));
    expect(screen.queryByLabelText(/Field(Station|Stop)$/)).toBeNull();
  });

  it("질문을 닫으면 아무것도 바뀌지 않고 커서는 입구 버튼으로 간다(검색 칸·후보 그대로)", async () => {
    renderView(true);
    await searchTransfer();
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "addMenu" }));
    expect(screen.getByRole("button", { name: /아현역 2호선/ })).toBeTruthy();
    expect(screen.queryByLabelText(/^(boardField|alightField|via)/)).toBeNull();
    // Esc(cancel)도 같은 경로다.
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    fireEvent(await screen.findByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "addMenu" }));
    expect(dialog.isConnected).toBe(false);
  });

  it("후보 순서는 장소 → 정류장 → 주소이고 건수에 정류장이 든다", async () => {
    const base = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/address/search")
        ? ({ ok: true, json: async () => ({ addresses: [{ roadAddr: "서울 마포구 아현로 1", roadAddrPart1: "서울 마포구 아현로 1", engAddr: "1 Ahyeon-ro" }] }) } as Response)
        : base(input),
    );
    renderView(true);
    await searchTransfer();
    const names = Array.from(screen.getByLabelText("transferField").closest("div")!.parentElement!.querySelectorAll("li button")).map(
      (b) => b.textContent ?? "",
    );
    const at = (re: RegExp) => names.findIndex((n) => re.test(n));
    expect(at(/아현 카페/)).toBeGreaterThanOrEqual(0);
    expect(at(/아현 카페/)).toBeLessThan(at(/^아현역, busStopKind/));
    expect(at(/^아현역, busStopKind/)).toBeLessThan(at(/아현로 1/));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("candidateCount"));
  });

  it("장소·주소가 둘 다 실패하고 정류장만 오면 건수 뒤에 실패를 덧붙이고 줄로도 보인다(3-state)", async () => {
    const base = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places") || url.startsWith("/api/address/search")) return { ok: false, status: 502, json: async () => ({}) } as Response;
      return base(input);
    });
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("transferField")));
    fireEvent.change(screen.getByLabelText("transferField"), { target: { value: "아현" } });
    fireEvent.click(screen.getByRole("button", { name: "searchField" }));
    await screen.findByRole("button", { name: /^아현역, busStopKind/ });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/candidateCount.*candidateError/));
    expect(screen.getByText("candidateError")).toBeTruthy();
  });

  it("장소·주소가 실패하고 정류장이 0건이면 「0건」이 아니라 실패다(3-state)", async () => {
    const base = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places") || url.startsWith("/api/address/search")) return { ok: false, status: 502, json: async () => ({}) } as Response;
      if (url.startsWith("/api/route/journey/stops?")) return { ok: true, json: async () => ({ stops: [] }) } as Response;
      return base(input);
    });
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("transferField")));
    fireEvent.change(screen.getByLabelText("transferField"), { target: { value: "아현" } });
    fireEvent.click(screen.getByRole("button", { name: "searchField" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("candidateError"));
    expect(screen.getByRole("status").textContent).not.toContain("candidateNone");
  });

  it("장소만 실패하고 주소가 오면 건수 뒤에 실패를 덧붙인다(역은 장소 검색에서만 온다)", async () => {
    const base = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) return { ok: false, status: 502, json: async () => ({}) } as Response;
      if (url.startsWith("/api/address/search"))
        return { ok: true, json: async () => ({ addresses: [{ roadAddr: "서울 마포구 아현로 1", roadAddrPart1: "서울 마포구 아현로 1", engAddr: "1 Ahyeon-ro" }] }) } as Response;
      return base(input);
    });
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("transferField")));
    fireEvent.change(screen.getByLabelText("transferField"), { target: { value: "아현" } });
    fireEvent.click(screen.getByRole("button", { name: "searchField" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/candidateCount.*candidateError/));
  });

  it("질문에 답하면 떠 있던 조회 결과를 버린다(새 입력이 옛 결과를 남기지 않는다)", async () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByRole("heading", { name: "car" });
    await pickBoardStation();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "car" })).toBeNull());
  });

  it("정류장 검색만 실패하면 건수 뒤에 그 문장을 잇는다", async () => {
    const base = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/route/journey/stops?")
        ? ({ ok: false, status: 502, json: async () => ({}) } as Response)
        : base(input),
    );
    renderView(true);
    await searchTransfer();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/candidateCount.*stopSearchFailed/));
    expect(screen.queryByRole("button", { name: /^아현역, busStopKind/ })).toBeNull();
  });

  it("질문이 열린 동안은 모달로 표식돼 도구 조회가 거절된다", async () => {
    renderView(true);
    await searchTransfer();
    expect(anyModalOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /아현역 2호선/ }));
    await screen.findByRole("dialog");
    expect(anyModalOpen()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(anyModalOpen()).toBe(false);
  });

  it("정류장 줄을 고르면 버스 질문이 열리고 답하면 정류장 칸 이름이 선다", async () => {
    renderView(true);
    await searchTransfer();
    fireEvent.click(screen.getByRole("button", { name: /^아현역, busStopKind/ }));
    const dialog = await screen.findByRole("dialog", { name: "askBoardBus" });
    expect(Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "answerYesBoardBus",
      "answerNoAlightBus",
      "answerViaOnly",
      "close",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "answerYesBoardBus" }));
    expect((screen.getByLabelText("boardFieldStop") as HTMLInputElement).value).toBe("아현역");
  });

  it("고른 역으로 여정만 조회한다(D12 — 수단별 조회 0회)", async () => {
    renderView(true);
    await pickBoardStation();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    const heading = await screen.findByRole("heading", { name: "designatedHeading" });
    expect(heading.tagName).toBe("H3");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const journeyUrl = urls.find((u) => u.startsWith("/api/route/journey?"));
    expect(journeyUrl).toBeTruthy();
    const q = new URL(journeyUrl!, "http://x").searchParams;
    expect(q.get("board")).toBe("37.5577,126.9562");
    expect(q.get("boardName")).toBe("아현역 2호선");
    expect(q.get("boardLine")).toBe("수도권2호선");
    expect(q.get("stops")).toBe("1");
    expect(q.get("alight")).toBeNull();
    expect(urls.some((u) => u.startsWith("/api/route/transit") || u.startsWith("/api/route/car") || u.startsWith("/api/route/walk"))).toBe(false);
    // 출입구 승격(A11)도 부르지 않는다.
    expect(urls.some((u) => u.startsWith("/api/places/entrance"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("readySummary"));
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // 도구 스냅샷은 여정 결과에 null을 낸다(spec §4 — 도구 계약에 여정이 없다. 수단 전부 null인 plan은 "경로 없음"으로 읽힌다).
    const snapshot = bridgeOf<DirectionsBridge>("directions")!.bridge.read();
    expect(snapshot.phase).toBe("settled");
    expect(snapshot.plan).toBeNull();
  });

  it("남은 쪽 칸을 열고 비워 두면 조회하지 않고 needEndpoints", async () => {
    renderView(true);
    await pickBoardStation();
    fireEvent.click(screen.getByRole("button", { name: "addAlightStation" }));
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("needEndpoints"));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/route"))).toBe(false);
  });

  it("경로 없음과 조회 실패는 다른 통지다(3-state, iOS와 같은 키)", async () => {
    journeyResponse = () => ({ ok: true, json: async () => ({ variants: [] }) }) as Response;
    renderView(true);
    await pickBoardStation();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("noRoute"));
    expect(screen.queryByRole("heading", { name: "designatedHeading" })).toBeNull();

    journeyResponse = () => ({ ok: false, status: 502, json: async () => ({}) }) as Response;
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("error"));
    expect(screen.getByRole("status").textContent).not.toContain("noRoute");
  });

  it("출발·도착 교체는 갈아탈 곳도 자리를 바꾼다(승차 쪽 → 하차 쪽)", async () => {
    renderView(true);
    await pickBoardStation();
    expect((screen.getByLabelText("boardFieldStation") as HTMLInputElement).value).toBe("아현역 2호선");
    fireEvent.click(screen.getByRole("button", { name: "swap" }));
    expect(screen.queryByLabelText("boardFieldStation")).toBeNull();
    expect((screen.getByLabelText("alightFieldStation") as HTMLInputElement).value).toBe("아현역 2호선");
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByRole("heading", { name: "designatedHeadingAlight" });
    const journeyUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/route/journey?"));
    const q = new URL(journeyUrl!, "http://x").searchParams;
    expect(q.get("alight")).toBe("37.5577,126.9562");
    expect(q.get("board")).toBeNull();
  });

  it("게이트가 거짓이면 최근 경로 목록에서 여정 항목을 숨긴다(같은 끝점 보통 경로와 문장이 같다)", async () => {
    const side = (label: string, lat: number, lng: number) => ({ label, lat, lng });
    recordRecentRoute({ from: side("집", 37.55, 126.95), to: side("광화문", 37.571, 126.976) });
    recordRecentRoute({
      from: side("집", 37.55, 126.95),
      to: side("광화문", 37.571, 126.976),
      board: { label: "아현역 2호선", lat: 37.5577, lng: 126.9562, line: "수도권2호선" },
    });
    const view = render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute canPlanJourney={false} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^item/ })).toHaveLength(1));
    view.unmount();
    render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute canPlanJourney onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^item|^recentRoute/ })).toHaveLength(2));
  });
});
