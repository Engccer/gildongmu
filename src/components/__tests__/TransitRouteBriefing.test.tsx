// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { alternativeNameKey } from "@/lib/transit-alternative-name";
import type { TransitLeg, TransitRoute } from "@/lib/types";
import { TransitRouteBriefing, TransitRouteResult } from "../TransitRouteBriefing";
import messages from "../../../messages/ko.json";

/**
 * 대중교통 브리핑 표시 계층 계약(spec §4.1·§4.3·§3.4).
 * 문구는 실제 ko 메시지로 렌더해 "어떤 키를 골랐는가"를 결과 텍스트로 판정한다
 * (키 이름 단언은 오타난 키를 통과시킨다).
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.538, lng: 127.139 },
  })),
}));

// vitest 전역 자동 cleanup이 없어 렌더가 누적된다(PlaceDetail.test.tsx 관례)
afterEach(cleanup);

const BOARD: TransitLeg = {
  mode: "subway",
  lineName: "수도권 5호선",
  fromName: "길동",
  toName: "서울역",
  stationCount: 13,
  minutes: 26,
};

// TransitRouteResult는 t를 prop으로 받으므로 provider 안쪽에서 훅으로 만들어 넘긴다
function Harness({ legs, dest }: { legs: TransitLeg[]; dest: string }) {
  const t = useTranslations("route.transit");
  const route: TransitRoute = {
    summary: {
      totalMinutes: 45,
      fare: 1750,
      transfers: 1,
      walkMinutes: 6,
      arriveName: "서울역",
    },
    legs,
    routeKey: "p0",
  };
  return <TransitRouteResult route={route} t={t} locale="ko" dest={dest} />;
}

function renderRoute(legs: TransitLeg[], dest = "서울역광장") {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <Harness legs={legs} dest={dest} />
    </NextIntlClientProvider>,
  );
}

describe("도보 구간 문장", () => {
  it("행선지와 거리를 한 텍스트로 합쳐 낭독한다", () => {
    renderRoute([{ mode: "walk", minutes: 3, distanceMeters: 178, toName: "길동" }, BOARD]);
    const first = screen.getAllByRole("listitem")[0];
    expect(first.textContent).toBe("길동까지 도보 3분, 178m");
    // 한 줄 = 한 접근성 객체: 시각 목적 span으로 쪼개면 이 단언이 잡는다
    expect(first.querySelectorAll("*")).toHaveLength(0);
  });

  it("거리 필드가 없으면 거리 없는 문구로 떨어진다(0m 금지)", () => {
    renderRoute([{ mode: "walk", minutes: 3, toName: "길동" }, BOARD]);
    const first = screen.getAllByRole("listitem")[0];
    expect(first.textContent).toBe("길동까지 도보 3분");
    expect(first.textContent).not.toContain("0m");
  });

  it("거리는 formatDistance를 지난다(소수 km 직접 조립 금지)", () => {
    renderRoute([{ mode: "walk", minutes: 20, distanceMeters: 1500, toName: "길동" }, BOARD]);
    expect(screen.getAllByRole("listitem")[0].textContent).toBe("길동까지 도보 20분, 1.5km");
  });

  it("마지막 도보는 소비자가 아는 목적지 이름을 쓴다", () => {
    renderRoute([BOARD, { mode: "walk", minutes: 3, distanceMeters: 221 }]);
    const items = screen.getAllByRole("listitem");
    expect(items[items.length - 1].textContent).toBe("서울역광장까지 도보 3분, 221m");
  });

  it("목적지 이름을 모르면 '목적지까지'라는 구간 의미를 쓴다", () => {
    renderRoute([BOARD, { mode: "walk", minutes: 3, distanceMeters: 221 }], "");
    const items = screen.getAllByRole("listitem");
    expect(items[items.length - 1].textContent).toBe("목적지까지 도보 3분, 221m");
  });

  it("이름도 거리도 없으면 둘 다 없는 문구로 떨어진다", () => {
    renderRoute([BOARD, { mode: "walk", minutes: 3 }], "");
    const items = screen.getAllByRole("listitem");
    expect(items[items.length - 1].textContent).toBe("목적지까지 도보 3분");
  });
});

describe("도착 문구", () => {
  it("마지막 구간이 도보면 도착 문단을 내지 않는다", () => {
    const { container } = renderRoute([BOARD, { mode: "walk", minutes: 3, distanceMeters: 221 }]);
    // 마지막 도보가 이미 목적지 도착을 말한다. 하차역 이름으로 "도착"을 덧붙이면 순서가 거꾸로다
    expect(container.textContent).not.toContain("도착");
  });

  it("마지막 구간이 탑승이면 하차역 이름으로 도착을 말한다", () => {
    const { container } = renderRoute([{ mode: "walk", minutes: 3, toName: "길동" }, BOARD]);
    expect(container.textContent).toContain("서울역 도착");
  });
});

describe("alternativeNameKey", () => {
  const base: TransitRoute = {
    summary: { totalMinutes: 40, fare: 1500, transfers: 0, walkMinutes: 5 },
    legs: [],
    routeKey: "p1",
  };

  it("두 축이면 조합 키", () => {
    expect(
      alternativeNameKey({ ...base, highlight: ["fewestTransfers", "fastest"] }).key,
    ).toBe("alternativeFastestFewestTransfers");
  });

  it("환승 축만이면 환승 키", () => {
    expect(alternativeNameKey({ ...base, highlight: ["fewestTransfers"] }).key).toBe(
      "alternativeFewestTransfers",
    );
  });

  it("시간 축만이면 시간 키", () => {
    expect(alternativeNameKey({ ...base, highlight: ["fastest"] }).key).toBe("alternativeFastest");
  });

  it("축이 없으면 번호 키에 displayIndex를 넘긴다", () => {
    expect(alternativeNameKey({ ...base, displayIndex: 2 })).toEqual({
      key: "alternativeHeading",
      values: { index: 2 },
    });
  });
});

describe("채팅 카드 대안 라벨", () => {
  const alt = (over: Partial<TransitRoute>): TransitRoute => ({
    summary: { totalMinutes: 50, fare: 1750, transfers: 1, walkMinutes: 6 },
    legs: [BOARD],
    routeKey: "p1",
    ...over,
  });

  it("축 라벨과 번호를 공유 함수 산출대로 낸다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          recommended: alt({ routeKey: "p0", summary: { totalMinutes: 45, fare: 1750, transfers: 1, walkMinutes: 6 } }),
          alternatives: [
            alt({ routeKey: "p1", highlight: ["fastest"] }),
            alt({ routeKey: "p2", displayIndex: 1 }),
          ],
          totalCandidates: 9,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <TransitRouteBriefing dest={{ lat: 37.555, lng: 126.972, name: "서울역" }} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "여기까지 대중교통 길찾기" }));

    const axis = await screen.findByRole("button", { name: /가장 빠른 경로/ });
    // 라벨이 곧 요약 전문이다(joinText 한 줄 = 한 객체)
    expect(axis.textContent).toBe("가장 빠른 경로, 총 50분, 1,750원, 환승 1회, 도보 6분 포함");
    expect(screen.getByRole("button", { name: /대안 경로 1/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
