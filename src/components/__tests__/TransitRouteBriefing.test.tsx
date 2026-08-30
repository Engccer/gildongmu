// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("탑승 구간 문장", () => {
  // 위원장이 실사용에서 본 값 그대로(천호대로 1201 → 강동역, 2026-08-07).
  const BUS: TransitLeg = {
    mode: "bus",
    lineName: "370",
    fromName: "강동자이.프라자아파트",
    toName: "강동역",
    stationCount: 3,
    minutes: 9,
  };

  it("버스는 번호만 두지 않는다(그대로면 '370'이 무엇인지 알 수 없다)", () => {
    renderRoute([BUS]);
    expect(screen.getAllByRole("listitem")[0].textContent).toBe(
      "강동자이.프라자아파트에서 370번 버스 승차, 3 정거장",
    );
  });

  it("지하철 노선명은 원문 그대로다(수단이 이미 이름에 드러난다)", () => {
    renderRoute([BOARD]);
    const text = screen.getAllByRole("listitem")[0].textContent;
    expect(text).toBe("길동에서 수도권 5호선 승차, 13 정거장");
    expect(text).not.toContain("번 버스");
  });

  it("버스 표기에는 lang을 씌우지 않는다(번역문이라 en에서 'bus'까지 한국어로 읽힌다)", () => {
    renderRoute([BUS]);
    const marked = [...screen.getAllByRole("listitem")[0].querySelectorAll("[lang]")].map(
      (e) => e.textContent,
    );
    // lang 경계는 ODsay 원문(정류장명)에만 — 노선 자리는 번역문이라 밖에 둔다
    expect(marked).toEqual(["강동자이.프라자아파트"]);
  });

  it("지하철은 노선명도 원문이라 lang 경계가 둘이다", () => {
    renderRoute([BOARD]);
    const marked = [...screen.getAllByRole("listitem")[0].querySelectorAll("[lang]")].map(
      (e) => e.textContent,
    );
    expect(marked).toEqual(["길동", "수도권 5호선"]);
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

describe("빠른하차 문장", () => {
  const withQuickExit: TransitLeg = {
    ...BOARD,
    quickExit: {
      elevator: { kind: "door", doors: ["4-4"] },
      stairs: { kind: "door", doors: ["4-2"] },
    },
  };

  it("탑승 구간 아래 별도 줄로 나온다", () => {
    renderRoute([withQuickExit]);
    const item = screen.getAllByRole("listitem")[0];
    // 같은 줄에 이어붙이지 않는다 — 별도 문장이라 별도 블록이 옳다.
    const line = item.querySelector("p");
    expect(line?.textContent).toBe("서울역 하차, 엘리베이터 4-4 문, 계단 4-2 문");
  });

  it("한 줄을 시각 목적으로 쪼개지 않는다", () => {
    renderRoute([withQuickExit]);
    const line = screen.getAllByRole("listitem")[0].querySelector("p")!;
    expect(line.querySelectorAll("*")).toHaveLength(0);
  });

  it("값이 없으면 아무것도 나오지 않는다(문구 없음)", () => {
    renderRoute([BOARD]);
    const item = screen.getAllByRole("listitem")[0];
    expect(item.querySelector("p")).toBeNull();
    expect(item.textContent).not.toContain("하차,");
  });

  it("live region으로 복제하지 않는다", () => {
    renderRoute([withQuickExit]);
    const line = screen.getAllByRole("listitem")[0].querySelector("p")!;
    expect(line.closest("[aria-live]")).toBeNull();
  });

  it("한쪽 시설만 있으면 있는 것만 말한다", () => {
    renderRoute([{ ...BOARD, quickExit: { stairs: { kind: "door", doors: ["3-1"] } } }]);
    const line = screen.getAllByRole("listitem")[0].querySelector("p")!;
    expect(line.textContent).toBe("서울역 하차, 계단 3-1 문");
  });
});

describe("오류 낭독은 서버 문자열이 아니라 t() 문장(A26)", () => {
  async function requestWith(status: number, body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: status < 400, status, json: async () => body })),
    );
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <TransitRouteBriefing dest={{ lat: 37.555, lng: 126.972, name: "서울역" }} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "여기까지 대중교통 길찾기" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));
    const text = screen.getByRole("status").textContent;
    vi.unstubAllGlobals();
    return text;
  }

  it("503(키 없음)은 서버 한국어 문장 대신 notConfigured", async () => {
    const text = await requestWith(503, { error: "대중교통 길찾기는 API 키 등록 후 사용할 수 있습니다." });
    expect(text).toBe(messages.route.transit.notConfigured);
  });

  it("502는 일반 오류 문장(서버 문자열 무시)", async () => {
    const text = await requestWith(502, { error: "서버가 보낸 임의의 한국어 문장" });
    expect(text).toBe(messages.route.transit.error);
  });
});
