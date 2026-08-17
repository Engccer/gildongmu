// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirEndpoint } from "@/lib/directions-state";
import type { JusoAddress, Place } from "@/lib/types";
import {
  __resetManualLocationForTest,
  setManualLocation,
} from "@/lib/manual-location-store";
import { awaitGeolocation } from "@/lib/geolocation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
  // 조회 출발지의 나이 상한(A7). 모듈을 통째로 대체하므로 상수도 함께 준다 —
  // 빠뜨리면 런타임에 `undefined` 참조로 죽고 증상은 "phase가 locating에 멈춤"이다.
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
// 안내 진입점은 트리거 버튼과 시작 콜백만 흉내 낸다 — 이 스위트는 뷰의 통지 계약을
// 보지 세션(useRouteGuide, jsdom에 geolocation 없음)을 보지 않는다.
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: ({ triggerLabel, onStart }: { triggerLabel?: string; onStart?: () => void }) => (
    <button type="button" onClick={() => onStart?.()}>
      {triggerLabel}
    </button>
  ),
}));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};

const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
  zipNo: "05397",
  bdNm: "",
};

function stubFetch({
  places = [gangnam],
  addresses = [juso],
  geocode,
}: {
  places?: Place[];
  addresses?: JusoAddress[];
  /** `/api/geocode` 응답(주소 후보 선택 → 좌표 해석 결선 테스트 전용, 미지정 시 기존과 동일하게 미매칭 URL로 throw). */
  geocode?: { status: number; body: unknown };
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({ places, provider: "kakao-local", query: "q" }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses }) } as Response;
      }
      if (url.startsWith("/api/geocode") && geocode) {
        return {
          ok: geocode.status >= 200 && geocode.status < 300,
          status: geocode.status,
          json: async () => geocode.body,
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderView(overrides: { initialTo?: DirEndpoint | null } = {}) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      onBack={() => {}}
      {...overrides}
    />,
  );
}

function searchField(labelKey: "from" | "to", query: string) {
  fireEvent.change(screen.getByLabelText(labelKey), {
    target: { value: query },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: labelKey === "from" ? "searchFrom" : "searchTo",
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DirectionsView 흐름 전진 포커스", () => {
  it("후보 검색 완료 시 첫 후보(장소 우선)로 포커스가 이동한다", async () => {
    stubFetch();
    renderView();
    searchField("from", "강남");
    // useEffect 포커스는 비동기 반영이라 waitFor 필수(jsdom flake 방지).
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(
        "강남역, 서울 강남구 강남대로 396",
      );
    });
  });

  it("장소 후보가 없으면 첫 주소 후보로 포커스가 이동한다", async () => {
    stubFetch({ places: [] });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
  });

  it("출발지 확정 → 도착지 입력, 도착지 확정 → 조회 버튼으로 포커스가 전진한다", async () => {
    stubFetch();
    renderView();

    searchField("from", "강남");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByLabelText("to"));

    searchField("to", "잠실");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "submit" }),
    );
  });

  it("후보에 포커스가 있는 채로 재검색이 0건이면 입력으로 선점 복귀한다", async () => {
    stubFetch();
    renderView();
    searchField("from", "강남");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    // 같은 필드 재검색이 0건 — 후보 리스트가 통째로 언마운트되는 상태 전이.
    stubFetch({ places: [], addresses: [] });
    fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("candidateNone");
    });
    // 포커스가 body로 소실되지 않고 입력으로 복귀(제거 전 선점 이동).
    expect(document.activeElement).toBe(screen.getByLabelText("from"));
  });

  it("후보 0건이면 포커스를 옮기지 않고 통지만 한다", async () => {
    stubFetch({ places: [], addresses: [] });
    renderView();
    searchField("from", "ㅁㄴㅇㄹ");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("candidateNone");
    });
    // 마운트 시 제목 포커스가 그대로 — 결과 없는 검색은 커서를 끌고 가지 않는다.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "title" }),
    );
  });
});

// resolveAddressCoord 공용화(리팩터링) 회귀: 순수함수 단위테스트(resolve-address-coord.test.ts)와
// 별개로, DirectionsView의 selectAddress가 그 반환 kind로 실제로 분기하는지(호출부 결선)를 검증한다.
describe("DirectionsView 주소→좌표 해석 결선(resolveAddressCoord)", () => {
  it("주소 후보 선택 후 좌표 해석 성공 시 출발지가 확정된다", async () => {
    stubFetch({
      places: [],
      geocode: {
        status: 200,
        body: { matches: [{ lat: 37.5, lng: 127.1, addressName: juso.roadAddr }] },
      },
    });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
    fireEvent.click(document.activeElement as HTMLElement);
    // 성공 경로: onResolve가 돌아 "from" 입력값이 확정 라벨로 바뀐다(endpointToField).
    await waitFor(() => {
      expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
        juso.roadAddrPart1,
      );
    });
  });

  it("주소 후보 선택 후 좌표 해석 실패 시 coordError만 통지하고 확정하지 않는다", async () => {
    stubFetch({ places: [], geocode: { status: 502, body: {} } });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("coordError");
    });
    // 실패 경로: resolveAndClose가 돌지 않아 입력값이 원래 질의 그대로다.
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
      "성내로 12",
    );
  });
});

// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다(LocationBar와 동형).
// 안내 시작은 항상 실좌표를 다시 조회하므로(useRouteGuide.realfix), 이 브리핑이
// 수동 위치 기준일 때만 그 사실을 안내 시작 진입점 근처에서 미리 말한다.
describe("DirectionsView 수동 위치(manual location)", () => {
  afterEach(() => {
    // __resetManualLocationForTest는 모듈 상태만 지운다 — localStorage에 남은
    // 값은 다음 테스트의 hydrate()가 다시 읽어 들여 오염시킨다(LocationBar.test와
    // 동형 정리, 리뷰 발견).
    localStorage.clear();
    __resetManualLocationForTest();
  });

  it("origin 있는 수동 위치는 출발지 필드에 manual 라벨로 표시된다", () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    renderView();
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe("manual");
  });

  it("origin 없는 수동 위치는 manualUnverifiable 라벨로 표시된다", () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: null,
      setAt: 1,
    });
    renderView();
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
      "manualUnverifiable",
    );
  });

  it("수동 위치 출발지로 조회하면 역지오코딩 없이 그 좌표로 조회하고, 조회 완료 통지에는 고지를 싣지 않으며, 안내 시작 순간에만 '현재 위치에서 시작' 고지를 발화한다", async () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.startsWith("/api/route/car")) {
          return {
            ok: true,
            json: async () => ({ provider: "tmap", durationSeconds: 600 }),
          } as Response;
        }
        if (url.startsWith("/api/route/transit")) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        if (url.startsWith("/api/route/walk")) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderView({
      initialTo: { kind: "place", label: "잠실역", coord: { lat: 37.5, lng: 127.1 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    // 조회 완료 통지는 요약뿐이다 — 수동 위치 고지를 결과 화면 상시 문장으로 두지
    // 않는다(안내를 시작하지 않는 사용자에겐 매 조회 잡음, 위원장 판정 2026-08-17).
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("readySummary");
    });
    // 고지의 자리는 안내 시작의 직접 응답이다. 그 정보로 갈리는 행동이 안내 시작뿐이라
    // 그 순간에만 말한다(자동차 tmap 성공 → 시작 버튼 노출, DistanceBeacon 모크가
    // 시작 콜백만 흉내 낸다). 시작→중지→재시작에도 같은 문장이 다시 발화돼야 한다 —
    // 같은 문자열 재대입은 DOM이 안 바뀌어 침묵하므로 텍스트 노드가 새로 삽입돼야
    // 한다(노드 정체성으로 판정).
    fireEvent.click(screen.getByRole("button", { name: "guideStartCar" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("guideStartsFromCurrent");
    });
    const firstNode = screen.getByRole("status").firstChild;
    fireEvent.click(screen.getByRole("button", { name: "guideStartCar" }));
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("guideStartsFromCurrent");
      expect(status.firstChild).not.toBe(firstNode);
    });
    // 수동 좌표로 조회했다(GPS 아님) — awaitGeolocation 모크는 항상 error라
    // 실좌표 경로를 탔다면 이 조회 자체가 geoError로 끝나 route fetch가 없다.
    expect(
      calledUrls.some((u) => u.startsWith("/api/route/car?origin=37.5384,127.1432")),
    ).toBe(true);
    // 수동 위치일 때는 역지오코딩(fetchCurrentAddress)을 호출하지 않는다.
    expect(calledUrls.some((u) => u.startsWith("/api/geocode/reverse"))).toBe(false);
  });
});

// A11: 넓은 부지 목적지를 출입구로 승격한다. 검증 축 둘 — **전 수단 조회가 승격
// 좌표로 나가는가**(승격이 표시만 바꾸고 경로는 본관으로 가면 도착 판정이 그대로
// 안 선다)와 **승격 문장이 단일 live region에 실리는가**(결과 앞 정적 텍스트로
// 두면 조회 완료 시 첫 성공 heading으로 포커스가 뛰어 SR이 그 문장을 지나친다).
describe("DirectionsView 출입구 승격(A11)", () => {
  afterEach(() => {
    localStorage.clear();
    __resetManualLocationForTest();
  });

  beforeEach(() => {
    // 출발지는 "현재 위치"라 측위가 성공해야 조회가 진행된다(전역 mock은 항상 error).
    vi.mocked(awaitGeolocation).mockResolvedValue({
      status: "ready",
      coords: { lat: 37.5352, lng: 127.1441 },
    });
  });

  /** 승격 응답을 주는 fetch 스텁. 호출 URL을 모아 조회 좌표를 검증한다. */
  function stubWithEntrance(entrance: unknown) {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.startsWith("/api/places/entrance")) {
          return { ok: true, json: async () => ({ entrance }) } as Response;
        }
        if (url.startsWith("/api/route/car")) {
          return {
            ok: true,
            json: async () => ({ provider: "tmap", durationSeconds: 600 }),
          } as Response;
        }
        if (url.startsWith("/api/route/")) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    return calledUrls;
  }

  it("승격되면 승격 좌표로 조회하고 고지가 단일 live region에 실린다", async () => {
    const calledUrls = stubWithEntrance({
      name: "신명중학교 정문",
      lat: 37.5416844,
      lng: 127.1489539,
      meters: 56,
    });
    renderView({
      initialTo: {
        kind: "place",
        label: "신명중학교",
        coord: { lat: 37.5414909, lng: 127.1495375 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "readySummary entrancePromoted",
      );
    });
    // 경로 조회가 승격 좌표로 나갔다 — 표시만 바꾸고 본관으로 조회하면 이 단언이 red다.
    expect(
      calledUrls.some((u) => u.includes("dest=37.5416844,127.1489539")),
    ).toBe(true);
    expect(calledUrls.some((u) => u.includes("dest=37.5414909,127.1495375"))).toBe(false);
  });

  it("승격이 없으면 원래 목적지로 조회하고 고지도 없다", async () => {
    const calledUrls = stubWithEntrance(null);
    renderView({
      initialTo: {
        kind: "place",
        label: "강동성심병원",
        coord: { lat: 37.5335, lng: 127.131 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("readySummary");
    });
    expect(calledUrls.some((u) => u.includes("dest=37.5335,127.131"))).toBe(true);
  });
});

// A8: 계단 회피 토글은 outcomes.walk만 갈아끼우는데 요약 수치("N개 수단 준비됨")는
// phase.successCount가 든다 — 토글이 성공↔실패를 뒤집으면 수치가 함께 움직여야 한다.
// 낭독되는 수치라 시각으로 반증되지 않는다(백로그 A8, 2026-08-09 최종 리뷰 검출).
describe("DirectionsView 계단 회피 토글 요약 수치(A8)", () => {
  afterEach(() => {
    localStorage.clear();
    __resetManualLocationForTest();
  });

  it("토글 재조회가 도보를 실패로 뒤집으면 요약도 성공 0으로 갱신된다", async () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    let walkCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/route/walk")) {
          walkCalls += 1;
          // 1회차(조회) 성공 → 2회차(토글 재조회) 실패.
          return walkCalls === 1
            ? ({ ok: true, json: async () => ({ result: { steps: [] } }) } as Response)
            : ({ ok: false, status: 502, json: async () => ({}) } as Response);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    render(
      <DirectionsView
        canShowWalk
        canShowTransit={false}
        canBriefCarRoute={false}
        initialTo={{ kind: "place", label: "잠실역", coord: { lat: 37.5, lng: 127.1 } }}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("readySummary");
    });
    fireEvent.click(screen.getByRole("button", { name: "stepFreeToggle" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("allFailed");
    });
  });
});

// 최근 경로(스펙 2026-08-10 §1). 저장 계층(recent-searches.ts)은 Task 1에서 검증
// 완료 — 여기서는 DirectionsView 결선(활성화 즉시 조회·삭제 포커스·기록 시점)만.
describe("최근 경로 섹션", () => {
  const ROUTES_KEY = "gildongmu:recent-routes:v1";
  const seedRoutes = () =>
    localStorage.setItem(
      ROUTES_KEY,
      JSON.stringify([
        {
          from: { label: "자택", lat: 37.535, lng: 127.145 },
          to: { label: "신명중학교", lat: 37.529, lng: 127.138 },
        },
        { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 } },
      ]),
    );

  function renderView() {
    return render(
      <DirectionsView
        canShowWalk={false}
        canShowTransit={true}
        canBriefCarRoute={false}
        onBack={() => {}}
      />,
    );
  }

  it("결과 없을 때 섹션·항목·전체 지우기가 보인다", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch();
    renderView();
    // ⚠ mock useTranslations는 네임스페이스를 무시하고 key만 돌려주므로 이 뷰의
    // 제목(t("title"), directions.title)과 이 섹션 제목(tRecentRoutes("title"))이
    // 둘 다 문자열 "title"이 된다 — level:3으로 h3만 골라 h2와의 동명 충돌을 피한다.
    expect(
      await screen.findByRole("heading", { name: "title", level: 3 }),
    ).toBeTruthy();
    expect(screen.getAllByText("item")).toHaveLength(2);
    expect(screen.getByText("clearAll")).toBeTruthy();
  });

  it("활성화: 즉시 조회 시작 + 조회 버튼 포커스 선점, settled 후 섹션 숨김·기록 끌어올림", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch(); // /api/route/* 미매핑 URL은 throw → 수단 error → settled(성공 0)
    // 두 번째 항목은 출발지가 "현재 위치"(null) — settled까지 도달해야 기록
    // 지점을 검증할 수 있으므로, 전역 mock(항상 error)을 이 조회 1건만 성공으로
    // 오버라이드한다(측위 실패 시 거동은 "측위 실패 조회는 기록하지 않는다"가 커버).
    vi.mocked(awaitGeolocation).mockResolvedValueOnce({
      status: "ready",
      coords: { lat: 37.5, lng: 127.0 },
    });
    renderView();
    const items = await screen.findAllByText("item");
    fireEvent.click(items[1]); // 두 번째 항목(강남역행)을 최신으로
    expect((document.activeElement as HTMLElement).textContent).toBe("submit");
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "title", level: 3 }),
      ).toBeNull(),
    );
    const stored = JSON.parse(localStorage.getItem(ROUTES_KEY)!);
    expect(stored[0].to.label).toBe("강남역"); // dedupe 끌어올림 = settled 기록 실행 증거
  });

  it("측위 실패 조회는 기록하지 않는다", async () => {
    localStorage.clear();
    stubFetch();
    // 도착지만 프리필, 출발지는 현재 위치 → geolocation mock이 error → geoError
    render(
      <DirectionsView
        canShowWalk={false}
        canShowTransit={true}
        canBriefCarRoute={false}
        initialTo={{ kind: "place", label: "강남역", coord: { lat: 37.497, lng: 127.027 } }}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("submit"));
    await waitFor(() => expect(localStorage.getItem(ROUTES_KEY)).toBeNull());
  });

  it("삭제: 항목 제거 + 마지막 항목 삭제 시 조회 버튼 포커스", async () => {
    localStorage.clear();
    localStorage.setItem(
      ROUTES_KEY,
      JSON.stringify([
        { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 } },
      ]),
    );
    stubFetch();
    renderView();
    const del = (await screen.findAllByText("delete")).at(-1)!; // 항목 삭제 버튼(mock은 네임스페이스를 벗긴다)
    fireEvent.click(del);
    expect(JSON.parse(localStorage.getItem(ROUTES_KEY)!)).toEqual([]);
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).textContent).toBe(
        "submit",
      ));
  });
});

// 최근 목록 고정(스펙 2026-08-12). 저장 계층은 recent-searches.test.ts가 검증 —
// 여기서는 결선(버튼 순서·라벨 접미사·화면 순서 유지·모두 지우기 보존 통지)만.
describe("최근 경로 고정", () => {
  const ROUTES_KEY = "gildongmu:recent-routes:v1";
  const seedRoutes = () =>
    localStorage.setItem(
      ROUTES_KEY,
      JSON.stringify([
        { from: null, to: { label: "잠실역", lat: 37.513, lng: 127.1 } },
        { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 } },
      ]),
    );

  function renderView() {
    return render(
      <DirectionsView
        canShowWalk={false}
        canShowTransit={true}
        canBriefCarRoute={false}
        onBack={() => {}}
      />,
    );
  }

  it("항목 버튼 순서는 [활성화, 고정, 삭제]다 — 고정이 삭제보다 앞", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch();
    renderView();
    const item = (await screen.findAllByText("item"))[0];
    const rowButtons = Array.from(item.closest("li")!.querySelectorAll("button"));
    expect(rowButtons.map((b) => b.textContent)).toEqual(["item", "pin", "delete"]);
  });

  it("고정 토글: 라벨 접미사·버튼 라벨 전환·화면 순서 유지, 저장은 고정 우선", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch();
    renderView();
    await screen.findAllByText("item");
    fireEvent.click(screen.getAllByText("pin")[1]); // 두 번째 항목(강남역행) 고정
    // 화면: 자리 유지(스펙 §4 — 정렬은 다음 로드부터), 접미사는 두 번째 행에
    const labels = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("button")!.textContent);
    expect(labels).toEqual(["item", "item, pinned"]);
    // 토글 버튼 라벨 전환 = 상태 신호
    expect(screen.getAllByText("unpin")).toHaveLength(1);
    // 통지는 항목명 포함 키(연속 고정 시 동일 문자열 bail out 침묵 방지 — a11y 감사)
    expect(screen.getByRole("status").textContent).toContain("pinnedItem");
    // 저장은 불변식 정렬(고정 블록이 앞)
    const stored = JSON.parse(localStorage.getItem(ROUTES_KEY)!);
    expect(stored[0].to.label).toBe("강남역");
    expect(stored[0].pinned).toBe(true);
    expect(stored[1].pinned).toBe(false);
  });

  it("모두 지우기는 고정을 남기고 clearedExceptPinned를 통지한다", async () => {
    localStorage.clear();
    localStorage.setItem(
      ROUTES_KEY,
      JSON.stringify([
        { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 }, pinned: true },
        { from: null, to: { label: "잠실역", lat: 37.513, lng: 127.1 } },
      ]),
    );
    stubFetch();
    renderView();
    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByText("clearAll"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toContain("clearedExceptPinned");
    expect(JSON.parse(localStorage.getItem(ROUTES_KEY)!)).toHaveLength(1);
  });
});
