import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// 시간표·급행 정차역은 네트워크 provider라 빈 표로 고정한다(골든은 ODsay 응답 → 우리 파이프라인 출력만 잠근다).
vi.mock("../bus-service-hours", () => ({
  fetchServiceHoursMap: vi.fn(async () => new Map()),
}));
vi.mock("../subway-service-hours", () => ({
  fetchSubwayServiceHoursMap: vi.fn(async () => new Map()),
  subwayHoursKey: (r: { stationName: string; lineName: string; wayCode: number }) =>
    `${r.stationName}|${r.lineName}|${r.wayCode}`,
}));
vi.mock("../odsay-express-stops", () => ({
  fetchExpressStopsMap: vi.fn(async () => new Map()),
}));

import { getTransitCandidates, getTransitRoute } from "../odsay";

const FIXTURE_DIR = join(__dirname, "../../__tests__/fixtures/odsay-e70");
const load = (name: string) => readFileSync(join(FIXTURE_DIR, name), "utf8");

// 공개 일반 역 표본 두 쌍. 좌표는 입력 파일 이름의 SX/SY·EX/EY와 같은 값(응답은 URL이 아니라 파일로 정해진다).
const AHYEON = { lat: 37.5574, lng: 126.9561 };
const GWANGHWAMUN = { lat: 37.5716, lng: 126.9764 };
const SINCHON = { lat: 37.5597, lng: 126.9421 };
const SEOUL_STN = { lat: 37.556, lng: 126.9721 };

const PAIRS = {
  "ahyeon-gwanghwamun": {
    origin: AHYEON,
    dest: GWANGHWAMUN,
    all: "ahyeon-gwanghwamun.json",
    subway: "ahyeon-gwanghwamun-subway.json",
  },
  "sinchon-seoulstn": {
    origin: SINCHON,
    dest: SEOUL_STN,
    all: "sinchon-seoulstn.json",
    subway: undefined,
  },
} as const;

beforeAll(() => {
  // 시각 의존은 `annotateServiceStatus`의 현재 분뿐이다 — Date만 고정해 비동기 타이머는 건드리지 않는다.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T01:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  fetchMock.mockReset();
  // SearchPathType 유무로 파일을 고른다(수단 재조회 URL에만 있다).
  fetchMock.mockImplementation(async (url: string) => {
    const pair = Object.values(PAIRS).find((p) => {
      const q = new URL(url).searchParams;
      return q.get("SX") === String(p.origin.lng.toFixed(4)) && q.get("EY") === String(p.dest.lat.toFixed(4));
    });
    if (!pair) throw new Error(`골든 입력이 없는 좌표쌍: ${url}`);
    const subway = new URL(url).searchParams.has("SearchPathType");
    const file = subway ? pair.subway : pair.all;
    if (!file) throw new Error(`수단 재조회 입력이 없는 쌍: ${url}`);
    return { ok: true, json: async () => JSON.parse(load(file)) };
  });
});

const snapshotPath = (name: string) => `fixtures/odsay-golden/${name}.out.json`;
const dump = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("getTransitRoute 바이트 동일 골든(E70 후보 진입점 분리가 기존 출력을 바꾸지 않는다)", () => {
  for (const [pairName, pair] of Object.entries(PAIRS)) {
    for (const includeStops of [false, true]) {
      const name = `${pairName}-${includeStops ? "stops" : "plain"}`;
      it(`${pairName} includeStops=${includeStops}`, async () => {
        const result = await getTransitRoute({ origin: pair.origin, dest: pair.dest, includeStops });
        await expect(dump(result)).toMatchFileSnapshot(snapshotPath(name));
      });
    }
  }

  it("아현→광화문 지하철만 재조회", async () => {
    const pair = PAIRS["ahyeon-gwanghwamun"];
    const result = await getTransitRoute({ origin: pair.origin, dest: pair.dest, modeAxis: "subwayOnly" });
    await expect(dump(result)).toMatchFileSnapshot(snapshotPath("ahyeon-gwanghwamun-subwayOnly"));
  });
});

describe("getTransitCandidates", () => {
  it("아현→광화문 includeStops: 선정 전 전체 후보를 돌려주고 탈것 leg마다 stops가 있다", async () => {
    const pair = PAIRS["ahyeon-gwanghwamun"];
    const raw = JSON.parse(load(pair.all)) as { result: { path: unknown[] } };
    const candidates = await getTransitCandidates({ origin: pair.origin, dest: pair.dest, includeStops: true });
    expect(candidates!.ranked).toHaveLength(raw.result.path.length);
    for (const route of candidates!.ranked) {
      for (const leg of route.legs.filter((l) => l.mode !== "walk")) {
        expect(leg.stops?.length).toBeGreaterThan(1);
      }
    }
  });
});
