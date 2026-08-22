import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import { buildOverviewLines } from "../overview-lines";
import type { NearbyOverview, OverviewBullet } from "../nearby-overview";

function translator(locale: "ko" | "en") {
  const messages = locale === "ko" ? ko : en;
  const t = createTranslator({ locale, messages, namespace: "whereAmI" });
  return (key: string, params?: Record<string, string | number>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t as any)(key, params) as string;
}

function overview(bullets: OverviewBullet[]): NearbyOverview {
  return { place: "서울특별시 강동구 길동", radiusMeters: 1000, bullets };
}

const station = { name: "길동", line: "5호선", bearing: "ne" as const, distanceMeters: 262 };
const stops = [
  { name: "길동사거리", distanceMeters: 80, bearing: "e" as const },
  { name: "길동역", distanceMeters: 120, bearing: "n" as const },
];

describe("buildOverviewLines (ko)", () => {
  const t = translator("ko");

  it("대중교통: 역·버스 둘 다 있으면 완성 문장 셋 — 조사는 받침에 따라 고른다", () => {
    const [line] = buildOverviewLines(
      overview([{ kind: "transit", state: "ok", station, busStops: { state: "ok", count: 5, nearest: stops } }]),
      t,
      "ko",
    );
    expect(line).toBe(
      "가장 가까운 지하철역은 5호선 길동으로 북동쪽 262m입니다. 버스 정류소가 5곳 있습니다. 가장 가까운 곳은 길동사거리로 동쪽 80m, 길동역으로 북쪽 120m입니다.",
    );
  });

  it("대중교통: 역 없음 + 버스 조각 없음(키 부재)이면 역 문장만", () => {
    const [line] = buildOverviewLines(
      overview([{ kind: "transit", state: "ok", station: null, busStops: null }]),
      t,
      "ko",
    );
    expect(line).toBe("1km 안에 지하철역이 없습니다.");
  });

  it("대중교통: 버스 none·uncovered·failed는 서로 다른 문장이다(3-state)", () => {
    const lines = (["none", "uncovered", "failed"] as const).map(
      (state) =>
        buildOverviewLines(
          overview([{ kind: "transit", state: "ok", station: null, busStops: { state } }]),
          t,
          "ko",
        )[0],
    );
    expect(new Set(lines).size).toBe(3);
    expect(lines[1]).toContain("이 지역에서 제공되지 않습니다");
    expect(lines[2]).toContain("가져오지 못했습니다");
  });

  it("장소 불릿: ok·capped·none·unavailable·failed 문장이 전부 다르다", () => {
    const nearest = [{ name: "봉래면옥", distanceMeters: 40, bearing: "s" as const }];
    const lines = buildOverviewLines(
      overview([
        { kind: "food", state: "ok", count: 12, countCapped: false, nearest },
        { kind: "cafe", state: "ok", count: 15, countCapped: true, nearest },
        { kind: "kids", state: "none" },
        { kind: "events", state: "unavailable", reason: "seoulOnly" },
        { kind: "barrierFree", state: "failed" },
      ]),
      t,
      "ko",
    );
    expect(lines).toEqual([
      "식당이 12곳 있습니다. 가장 가까운 곳은 봉래면옥으로 남쪽 40m입니다.",
      "카페가 15곳 이상 있습니다. 가장 가까운 곳은 봉래면옥으로 남쪽 40m입니다.",
      "아이 놀 곳은 1km 안에 없습니다.",
      "문화 행사는 서울에서만 안내합니다.",
      "무장애 관광지 정보를 가져오지 못했습니다.",
    ]);
  });

  it("비한글 장소명은 조사 대신 쉼표로 물러난다", () => {
    const [line] = buildOverviewLines(
      overview([
        { kind: "food", state: "ok", count: 1, countCapped: false, nearest: [{ name: "GS25", distanceMeters: 40, bearing: "s" }] },
      ]),
      t,
      "ko",
    );
    expect(line).toContain("GS25, 남쪽 40m");
  });
});

describe("buildOverviewLines (en)", () => {
  it("조사 없이 템플릿 그대로 — 이름·거리·방향만 채운다", () => {
    const [line] = buildOverviewLines(
      overview([
        { kind: "kids", state: "ok", count: 3, countCapped: false, nearest: [{ name: "길동어린이공원", distanceMeters: 300, bearing: "w" }] },
      ]),
      translator("en"),
      "en",
    );
    expect(line).toBe("Places for kids: 3. The nearest are 길동어린이공원, 300m to the west.");
  });
});
