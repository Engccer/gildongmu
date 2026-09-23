// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import messages from "../../../messages/ko.json";

/**
 * E50 대안 이름 조립과 수단 재조회(spec 2026-09-24 §4.1·§4.3). 문구는 실제 ko 메시지로 렌더한다 —
 * 이름 조각이 한 줄(쉼표)로 이어지는지, 재조회 세 결과가 결과 요소로 포커스를 옮기는지를 본다.
 */

vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => ({ status: "idle" as const }),
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: ((snapshot) => () => snapshot)({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

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

function route(routeKey: string, totalMinutes: number, extra: Record<string, unknown> = {}) {
  return {
    summary: { totalMinutes, fare: 1500, transfers: 0, walkMinutes: 6 },
    legs: [{ mode: "walk", minutes: 3 }],
    routeKey,
    ...extra,
  };
}

type RequeryReply = "found" | "none" | "failed" | Promise<"found" | "none" | "failed">;

function stubFetch(opts: { requeryAxes?: string[]; replies?: RequeryReply[] }) {
  const replies = [...(opts.replies ?? [])];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/places")) {
      return { ok: true, json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }) } as Response;
    }
    if (url.startsWith("/api/address/search")) {
      return { ok: true, json: async () => ({ addresses: [] }) } as Response;
    }
    if (url.startsWith("/api/route/transit") && url.includes("pathType=")) {
      const reply = await (replies.shift() ?? "failed");
      if (reply === "failed") return { ok: false, json: async () => ({}) } as Response;
      if (reply === "none") return { ok: true, json: async () => ({ result: null }) } as Response;
      return {
        ok: true,
        json: async () => ({ result: { recommended: route("s0", 31), alternatives: [], totalCandidates: 1 } }),
      } as Response;
    }
    if (url.startsWith("/api/route/transit")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            recommended: route("p0", 43, { summary: { totalMinutes: 43, fare: 1750, transfers: 1, walkMinutes: 7 } }),
            alternatives: [route("p7", 71, { highlight: ["fewestTransfers", "busOnly"] })],
            totalCandidates: 10,
            ...(opts.requeryAxes ? { requeryAxes: opts.requeryAxes } : {}),
          },
        }),
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function queryTransit() {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <DirectionsView canShowWalk={false} canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  for (const [label, search] of [["출발지", "출발지 검색"], ["도착지", "도착지 검색"]] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: "강남" } });
    fireEvent.click(screen.getByRole("button", { name: search }));
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    fireEvent.click(document.activeElement as HTMLElement);
  }
  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
  await screen.findByRole("button", { name: /^추천 경로/ });
  // 조회 완료 착지(첫 성공 수단 heading, rAF)가 끝난 뒤에 누른다 — 실사용에서도 착지가 먼저다
  await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
}

const requeryCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("pathType="));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("대안 이름 조립(E50 §4.1)", () => {
  it("축 여럿은 조각을 쉼표로 이은 한 줄이 disclosure 이름이다", async () => {
    stubFetch({});
    await queryTransit();
    const disc = screen.getByRole("button", { name: /버스만 타는 경로/ });
    expect(disc.textContent).toBe("환승이 가장 적은 경로, 버스만 타는 경로, 총 71분, 1,500원, 환승 0회, 도보 6분 포함");
  });

  it("requeryAxes가 없으면 재조회 버튼이 없다", async () => {
    stubFetch({});
    await queryTransit();
    expect(screen.queryByRole("button", { name: /타는 경로 찾기/ })).toBeNull();
  });
});

describe("수단 재조회(E50 §4.3)", () => {
  it("찾음: 버튼이 사라지고 새 경로가 목록 끝에 붙어 포커스를 받는다", async () => {
    const fetchMock = stubFetch({ requeryAxes: ["subwayOnly"], replies: ["found"] });
    await queryTransit();
    const button = screen.getByRole("button", { name: "지하철만 타는 경로 찾기" });
    button.focus(); // 스크린 리더가 누르는 버튼은 포커스를 쥐고 있다
    fireEvent.click(button);
    const found = await screen.findByRole("button", { name: /^지하철만 타는 경로, 총 31분/ });
    await waitFor(() => expect(document.activeElement).toBe(found));
    expect(found.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "지하철만 타는 경로 찾기" })).toBeNull();
    expect(requeryCalls(fetchMock)).toHaveLength(1);
    expect(requeryCalls(fetchMock)[0]).toContain("pathType=1");
  });

  it("없음: 버튼 자리에 문장이 서고 그 문장이 포커스를 받는다", async () => {
    stubFetch({ requeryAxes: ["busOnly"], replies: ["none"] });
    await queryTransit();
    const button = screen.getByRole("button", { name: "버스만 타는 경로 찾기" });
    button.focus();
    fireEvent.click(button);
    const none = await screen.findByText("버스만 타는 경로가 없습니다.");
    await waitFor(() => expect(document.activeElement).toBe(none));
    expect(screen.queryByRole("button", { name: "버스만 타는 경로 찾기" })).toBeNull();
  });

  it("실패: 버튼이 남아 포커스를 쥐고, 화면 창구(상태 줄)에 실패 문장을 싣는다. 재시도된다", async () => {
    const fetchMock = stubFetch({ requeryAxes: ["busOnly"], replies: ["failed", "found"] });
    await queryTransit();
    // 사용자가 버튼으로 옮겨 간 상태를 만든다
    const button = screen.getByRole("button", { name: "버스만 타는 경로 찾기" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("버스만 타는 경로를 불러오지 못했습니다."));
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await screen.findByRole("button", { name: /^버스만 타는 경로, 총 31분/ });
    expect(requeryCalls(fetchMock)).toHaveLength(2);
    // 재시도가 성공하면 상태 줄에 실패 문장이 남지 않는다(화면과 반대를 말하지 않는다)
    expect(screen.getByRole("status").textContent).not.toContain("불러오지 못했습니다");
  });

  it("기다리는 사이 다른 곳으로 옮겨 갔으면 결과가 와도 포커스를 끌어오지 않는다", async () => {
    let release!: (v: "found") => void;
    stubFetch({ requeryAxes: ["busOnly"], replies: [new Promise((r) => (release = r))] });
    await queryTransit();
    const button = screen.getByRole("button", { name: "버스만 타는 경로 찾기" });
    button.focus();
    fireEvent.click(button);
    const recommended = screen.getByRole("button", { name: /^추천 경로/ });
    recommended.focus();
    release("found");
    await screen.findByRole("button", { name: /^버스만 타는 경로, 총 31분/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(recommended);
  });

  it("재조회가 떠 있는 동안 다시 조회하면 옛 응답은 버려지고 새 버튼은 바로 동작한다", async () => {
    let release!: (v: "failed") => void;
    const fetchMock = stubFetch({
      requeryAxes: ["busOnly"],
      replies: [new Promise((r) => (release = r)), "none"],
    });
    await queryTransit();
    fireEvent.click(screen.getByRole("button", { name: "버스만 타는 경로 찾기" }));
    // 옛 요청이 떠 있는 채로 새 조회
    fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
    const fresh = await screen.findByRole("button", { name: "버스만 타는 경로 찾기" });
    expect(fresh.getAttribute("aria-disabled")).toBeNull();
    // 새 세대의 같은 축 버튼은 옛 가드에 막히지 않는다
    fireEvent.click(fresh);
    await screen.findByText("버스만 타는 경로가 없습니다.");
    expect(requeryCalls(fetchMock)).toHaveLength(2);
    // 옛 응답(실패)이 늦게 와도 상태 줄·목록을 건드리지 않는다
    const before = document.activeElement;
    release("failed");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("status").textContent).not.toContain("불러오지 못했습니다");
    expect(document.activeElement).toBe(before);
  });

  it("조회 중 두 번 눌러도 한 번만 부른다(aria-disabled + in-flight 가드)", async () => {
    const fetchMock = stubFetch({ requeryAxes: ["busOnly"], replies: ["found"] });
    await queryTransit();
    const button = screen.getByRole("button", { name: "버스만 타는 경로 찾기" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole("button", { name: /^버스만 타는 경로, 총 31분/ });
    expect(requeryCalls(fetchMock)).toHaveLength(1);
  });

  it("다시 조회하면 재조회 결과는 버려지고 버튼이 돌아온다", async () => {
    stubFetch({ requeryAxes: ["busOnly"], replies: ["none"] });
    await queryTransit();
    fireEvent.click(screen.getByRole("button", { name: "버스만 타는 경로 찾기" }));
    await screen.findByText("버스만 타는 경로가 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
    await screen.findByRole("button", { name: "버스만 타는 경로 찾기" });
    expect(screen.queryByText("버스만 타는 경로가 없습니다.")).toBeNull();
  });
});
