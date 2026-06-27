import { describe, it, expect } from "vitest";
import { buildLocationNarrative } from "../where-am-i";
import type { WhereAmI, SurroundingPlace } from "../types";

function lm(id: string, distanceMeters: number): SurroundingPlace {
  return {
    id,
    name: id,
    category: "convenience",
    categoryRaw: "가정,생활 > 편의점",
    distanceMeters,
    bearing: "n",
    lat: 37.5,
    lng: 127.1,
  };
}

const base: WhereAmI = {
  address: { road: "천호대로 1042", jibun: "길동 123" },
  region: "서울특별시 강동구 길동",
  nearestStation: { name: "굽은다리", line: "5호선", bearing: "se", distanceMeters: 250 },
  landmarks: [],
};

describe("buildLocationNarrative", () => {
  it("행정동과 도로명을 ', '로 합쳐 place를 만든다", () => {
    expect(buildLocationNarrative(base).place).toBe(
      "서울특별시 강동구 길동, 천호대로 1042",
    );
  });

  it("행정동만 있으면 행정동만, 도로명만 있으면 도로명만", () => {
    expect(
      buildLocationNarrative({ ...base, address: null }).place,
    ).toBe("서울특별시 강동구 길동");
    expect(
      buildLocationNarrative({ ...base, region: null, address: { road: "천호대로 1042" } }).place,
    ).toBe("천호대로 1042");
  });

  it("주소·행정동 모두 없으면 place는 null", () => {
    expect(
      buildLocationNarrative({ ...base, address: null, region: null }).place,
    ).toBeNull();
  });

  it("도로명이 없으면 지번으로 폴백한다", () => {
    expect(
      buildLocationNarrative({ ...base, region: null, address: { jibun: "길동 123" } }).place,
    ).toBe("길동 123");
  });

  it("도로명이 행정동의 시·구 접두로 시작하면 중복을 제거한다", () => {
    expect(
      buildLocationNarrative({
        ...base,
        region: "서울특별시 강동구 길동",
        address: { road: "서울특별시 강동구 천중로44길 74" },
      }).place,
    ).toBe("서울특별시 강동구 길동, 천중로44길 74");
  });

  it("접두가 겹치지 않는 도로명은 그대로 둔다", () => {
    expect(
      buildLocationNarrative({
        ...base,
        region: "서울특별시 강동구 길동",
        address: { road: "천호대로 1042" },
      }).place,
    ).toBe("서울특별시 강동구 길동, 천호대로 1042");
  });

  it("landmarks는 입력 순서를 유지하며 앞 6개로 자른다 (정렬 안 함)", () => {
    // buildLocationNarrative는 정렬하지 않고 slice만 한다. 정렬은 상류
    // rankSurroundings 책임이므로, 의도적으로 비오름차순 입력을 줘 계약을 고정.
    const distances = [50, 10, 30, 20, 40, 60, 80, 70, 90, 100];
    const many = distances.map((d, i) => lm(`p${i}`, d));
    const out = buildLocationNarrative({ ...base, landmarks: many });
    expect(out.landmarks).toHaveLength(6);
    expect(out.landmarks.map((l) => l.distanceMeters)).toEqual([50, 10, 30, 20, 40, 60]);
  });

  it("station은 그대로 통과시킨다", () => {
    expect(buildLocationNarrative(base).station?.name).toBe("굽은다리");
  });
});
