// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { awaitGeolocation } from "@/lib/geolocation";
import { NEARBY_INITIAL_VISIBLE, NEARBY_REVEAL_STEP } from "@/hooks/useRevealMore";
import { CultureEventsNearby } from "../CultureEventsNearby";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

const event = {
  id: "seoul-158804",
  title: "백제왕성 달빛 캠프",
  category: "교육/체험",
  place: "서울백제어린이박물관 잔디밭",
  district: "송파구",
  dateText: "2026-04-17~2026-11-27",
  timeText: "17:30 ~ 20:00",
  isFree: true,
  target: "유아·어린이 동반 30가족",
  link: "https://culture.seoul.go.kr/x?cultcode=158804",
  lat: 37.523991,
  lng: 127.124412,
  distanceMeters: 2310,
};

describeNearbyContract({
  name: "CultureEventsNearby",
  ns: "eventsNearby",
  renderComponent: () => <CultureEventsNearby />,
  triggerName: "eventsNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/events/nearby?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
  successBody: { events: [event], total: 1 },
  successProbe: "백제왕성 달빛 캠프",
  emptyBody: { events: [], total: 0 },
  hasCoverage: true,
  liveReadyOnDone: true,
});

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const geoMock = vi.mocked(awaitGeolocation);

/** 컴포넌트가 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response. */
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

function manyEvents(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...event,
    id: `seoul-${i}`,
    title: `행사${i}`,
  }));
}

async function renderDone(body: unknown) {
  geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
  const fetchMock = vi.fn<FetchFn>().mockResolvedValue(jsonResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  render(<CultureEventsNearby />);
  fireEvent.click(screen.getByRole("button", { name: "eventsNearby.button" }));
  await waitFor(() => expect(screen.getAllByRole("heading", { level: 4 }).length).toBeGreaterThan(0));
  return fetchMock;
}

describe("CultureEventsNearby 도메인 계약", () => {
  beforeEach(() => {
    geoMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("항목 이름은 h4 하나 — 제목·분류·거리가 단일 텍스트로 합쳐진다", async () => {
    await renderDone({ events: [event], total: 1 });
    const [h4] = screen.getAllByRole("heading", { level: 4 });
    // 세 조각이 각각 별도 접근성 객체(span)로 쪼개지지 않고 한 이름에 들어 있다.
    expect(h4.textContent).toContain("백제왕성 달빛 캠프");
    expect(h4.textContent).toContain("교육/체험");
    expect(h4.textContent).toContain("eventsNearby.distance");
    expect(h4.querySelectorAll("span")).toHaveLength(0);
  });

  it("무료 행사는 요금 문구를 싣지 않는다 (중복 낭독 금지)", async () => {
    await renderDone({ events: [event], total: 1 });
    expect(screen.getByText(/eventsNearby\.free/)).toBeTruthy();
    expect(screen.queryByText(/eventsNearby\.paid/)).toBeNull();
  });

  it("유료 행사는 요금 원문을 함께 낭독한다", async () => {
    await renderDone({
      events: [{ ...event, isFree: false, fee: "성인 15,000원" }],
      total: 1,
    });
    expect(screen.getByText(/성인 15,000원/)).toBeTruthy();
  });

  it("링크는 별도 객체로 남고 접근 가능한 이름에 행사명이 들어간다", async () => {
    await renderDone({ events: [event], total: 1 });
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(event.link);
    // 같은 목록에 "행사 상세" 링크가 여럿이라 이름으로 구분돼야 한다.
    expect(link.getAttribute("aria-label")).toContain("백제왕성 달빛 캠프");
  });

  it("link 없는 행사는 링크를 만들지 않는다 (빈 링크 금지)", async () => {
    await renderDone({ events: [{ ...event, link: undefined }], total: 1 });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("더 보기: 10개씩 단계 공개, 첫 새 항목으로 포커스, 마지막 배치에서 버튼 소멸", async () => {
    await renderDone({ events: manyEvents(25), total: 25 });
    const itemHeadings = () => screen.getAllByRole("heading", { level: 4 });
    const showMore = () => screen.getByRole("button", { name: "actions.showMore" });
    expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE);

    fireEvent.click(showMore());
    await waitFor(() =>
      expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE + NEARBY_REVEAL_STEP),
    );
    expect(document.activeElement).toBe(itemHeadings()[NEARBY_INITIAL_VISIBLE]);

    fireEvent.click(showMore());
    await waitFor(() => expect(itemHeadings()).toHaveLength(25));
    expect(screen.queryByRole("button", { name: "actions.showMore" })).toBeNull();
  });

  it("절단 수치(total)는 화면에 쓰지 않는다 (정직성 표기는 API 계층 몫)", async () => {
    await renderDone({ events: manyEvents(10), total: 84 });
    expect(screen.queryByText(/84/)).toBeNull();
  });
});
