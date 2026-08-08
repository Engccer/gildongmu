import { describe, expect, it } from "vitest";

// 가드를 테스트에서 재현하려면 빌드 스크립트를 그대로 import하는 것이 유일한 길이다
// (사본을 만들면 그 사본이 낡는다). mjs라 시그니처는 추론값이므로 여기서 좁혀 쓴다.
import {
  buildSeed as buildSeedJs,
  checkCollected as checkCollectedJs,
} from "../../../scripts/build-subway-quick-exit.mjs";
import seed from "../data/subway-quick-exit.json";
import rawRows from "./fixtures/subway-quick-exit-rows.json";

type Direction = { up: boolean; toward: string[]; elevator: string[]; stairs: string[] };
type Row = Record<string, string | null>;
type Seed = { meta: Record<string, unknown> & { stations: number }; stations: Record<string, Direction[]> };

const buildSeed = buildSeedJs as unknown as (
  rows: Row[],
  prev: unknown,
  today: string,
) => { seed: Seed };
const checkCollected = checkCollectedJs as unknown as (rows: Row[], total: number) => void;

const stations = seed.stations as Record<string, Direction[]>;
const build = (rows: Row[], prev: unknown = null) => buildSeed(rows, prev, "2026-08-08");
/** 픽스처는 실데이터 부분집합이다 — 합성 행으로는 가드가 무엇을 통과시키는지 알 수 없다. */
const rows = () => structuredClone(rawRows) as Row[];

describe("빠른하차 seed", () => {
  it("에스컬레이터를 싣지 않는다", () => {
    const all = Object.values(stations).flat();
    expect(all.every((d) => !("escalator" in d))).toBe(true);
  });

  it("NA-NA를 싣지 않는다", () => {
    const doors = Object.values(stations)
      .flat()
      .flatMap((d) => [...d.elevator, ...d.stairs]);
    expect(doors).not.toContain("NA-NA");
  });

  it("창동 4호선 상행은 NA-NA를 뺀 계단 2개를 남긴다", () => {
    const up = stations["창동|4호선"].find((d) => d.up);
    expect(up?.stairs).toEqual(["3-4", "7-3"]);
  });

  it("모든 문 번호가 화이트리스트 문법이다", () => {
    const doors = Object.values(stations)
      .flat()
      .flatMap((d) => [...d.elevator, ...d.stairs]);
    expect(doors.every((d) => /^\d+-\d+$/.test(d) || /^\d+-\d+,\d+-\d+ 사이$/.test(d))).toBe(true);
  });

  it("역 키가 정규화된 역명이다(역 접미·부역명 없음)", () => {
    expect(Object.keys(stations)).toContain("서울|1호선");
    expect(Object.keys(stations)).toContain("강변|2호선");
  });
});

/**
 * 가드가 있다는 사실과 가드가 실제로 잡는다는 사실은 다르다
 * ([[mutation-proves-test-detection-power]]). 여기서 red가 나지 않는 가드는 없는 것과 같다.
 */
describe("빠른하차 seed 가드 변이 주입", () => {
  it("변이 없는 픽스처는 통과한다", () => {
    const { seed: built } = build(rows());
    expect(built.meta.stations).toBeGreaterThan(20);
  });

  it("G1 수집 행 수가 totalCount와 다르면 중단", () => {
    const r = rows();
    expect(() => checkCollected(r, r.length)).not.toThrow();
    expect(() => checkCollected(r.slice(0, -1), r.length)).toThrow(/G1/);
  });

  it("G2 관리번호가 중복이면 중단", () => {
    const r = rows();
    r[1].qckgffMngNo = r[0].qckgffMngNo;
    expect(() => checkCollected(r, r.length)).toThrow(/G2/);
  });

  it("G3 기준일이 섞이면 중단", () => {
    const r = rows();
    r[0].crtrYmd = "20231231";
    expect(() => build(r)).toThrow(/G3/);
  });

  it("G4 미지 문 번호 형태면 중단", () => {
    const r = rows();
    r[0].qckgffVhclDoorNo = "6~4";
    expect(() => build(r)).toThrow(/G4/);
  });

  it("G5 미지 시설이면 중단", () => {
    const r = rows();
    r[0].plfmCmgFac = "무빙워크";
    expect(() => build(r)).toThrow(/G5/);
  });

  it("G6 미지 방향이면 중단", () => {
    const r = rows();
    r[0].upbdnbSe = "내선";
    expect(() => build(r)).toThrow(/G6/);
  });

  it("G7 노선이 사라지면 중단", () => {
    const r = rows().filter((x) => x.lineNm !== "3호선");
    expect(() => build(r)).toThrow(/G7/);
  });

  it("G7 예상 밖 노선이 생기면 중단", () => {
    const r = rows();
    r[0].lineNm = "9호선";
    expect(() => build(r)).toThrow(/G7/);
  });

  it("G8 역 seed에 없는 역이면 중단", () => {
    const r = rows();
    for (const x of r) if (x.stnNm === "안국") x.stnNm = "없는역";
    expect(() => build(r)).toThrow(/G8/);
  });

  it("G9 두 방향 방면이 겹치면 중단", () => {
    const r = rows();
    // 상행·하행이 같은 다음 역을 가리키면 직전역 대조가 양쪽을 배제하거나 반대를 고른다.
    // ⚠ 인접역이 픽스처에 있는 역을 고르면 G10이 먼저 잡아 G9가 검사되지 않는다 — 안국은
    //    3호선에서 홀로 있어 번호 대조가 성립하지 않으므로 G9까지 도달한다.
    for (const x of r) if (x.stnNm === "안국" && x.upbdnbSe === "상행") x.drtnInfo = "종로3가";
    expect(() => build(r)).toThrow(/G9/);
  });

  it("G10 화이트리스트 밖 방면 불일치면 중단", () => {
    const r = rows();
    for (const x of r) if (x.stnNm === "시청" && x.upbdnbSe === "하행") x.drtnInfo = "종각";
    expect(() => build(r)).toThrow(/G10/);
  });

  it("G10 응암순환·강동 분기는 화이트리스트라 통과한다", () => {
    // 변이 없는 픽스처에 이 4건이 실제로 들어 있어야 화이트리스트가 검사된 것이다.
    const exceptions = rows().filter(
      (x) =>
        (x.lineNm === "5호선" && x.stnNo === "548" && x.drtnInfo === "둔촌동") ||
        (x.lineNm === "6호선" && ["610", "615", "616"].includes(String(x.stnNo))),
    );
    expect(exceptions.length).toBeGreaterThan(0);
    expect(() => build(rows())).not.toThrow();
  });

  it("G11 직전 seed의 방향이 사라지면 중단", () => {
    const { seed: before } = build(rows());
    const r = rows().filter((x) => !(x.stnNm === "안국" && x.upbdnbSe === "하행"));
    expect(() => build(r, before)).toThrow(/G11/);
  });

  it("G11 시설 행 수가 줄면 중단", () => {
    const { seed: before } = build(rows());
    const inflated = {
      ...before,
      meta: { ...before.meta, facilityCounts: { 엘리베이터: 9999, 계단: 9999 } },
    };
    expect(() => build(rows(), inflated)).toThrow(/G11/);
  });
});
