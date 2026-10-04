import { describe, expect, it } from "vitest";
import { buildEnBriefing, roadNameKeysOf } from "../walk-guidance-en";
import type { WalkRouteBriefing } from "../types";

const NO_PARTS = { parts: false };
const PARTS = { parts: true };

const brief = (steps: WalkRouteBriefing["steps"]): WalkRouteBriefing => ({
  distanceMeters: 500,
  durationSeconds: 400,
  steps,
});

describe("buildEnBriefing", () => {
  it("행동절 + 거리 + 로마자 도로명", () => {
    const out = buildEnBriefing(
      brief([
        {
          description: "우회전 후 진황도로를 따라 294m 이동",
          turnType: 13,
          roadNameKo: "진황도로",
          distanceMeters: 294,
        },
      ]),
      new Map([["진황도로", "Jinhwangdo-ro"]]),
      NO_PARTS,
    );
    expect(out.steps[0].description).toBe("Turn right, then walk 294m along Jinhwangdo-ro");
  });

  it("문장 끝에 마침표를 두지 않는다(주석이 쉼표로 덧붙는다)", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 10m 이동", turnType: 11, distanceMeters: 10 }]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].description.endsWith(".")).toBe(false);
  });

  it("행동절이 없으면 Walk로 시작한다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 169m 이동", turnType: 11, distanceMeters: 169 }]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].description).toBe("Walk 169m");
  });

  it("도로명 로마자가 없으면 도로 절을 뺀다(비블로킹 열화)", () => {
    const out = buildEnBriefing(
      brief([
        {
          description: "좌측 횡단보도 후 14m 이동",
          turnType: 212,
          roadNameKo: "보행자도로",
          distanceMeters: 14,
        },
      ]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].description).toBe("Cross the crosswalk on your left, then walk 14m");
  });

  it("시설 문장도 원문 구조를 그대로 옮긴다", () => {
    const out = buildEnBriefing(
      brief([
        { description: "서울역 2번출구에서 지하보도 진입 후 72m 이동", turnType: 126, distanceMeters: 72 },
      ]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].description).toBe("Take the underpass, then walk 72m");
  });

  it("도착 스텝은 거리·도로명을 달지 않는다", () => {
    const out = buildEnBriefing(brief([{ description: "도착", turnType: 201 }]), new Map(), NO_PARTS);
    expect(out.steps[0].description).toBe("Arrive at your destination");
  });

  it("거리가 없으면 거리 절을 뺀다", () => {
    const out = buildEnBriefing(brief([{ description: "좌회전", turnType: 12 }]), new Map(), NO_PARTS);
    expect(out.steps[0].description).toBe("Turn left");
  });

  it("1km 이상은 formatDistance 표기를 쓴다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 1.1km 이동", turnType: 11, distanceMeters: 1100 }]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].description).toBe("Walk 1.1km");
  });

  it("미지 turnType은 throw — 행동절 없는 문장은 조용히 틀린 직진 지시다", () => {
    expect(() =>
      buildEnBriefing(brief([{ description: "무언가", turnType: 9999 }]), new Map(), NO_PARTS),
    ).toThrow(/미지/);
  });

  it("turnType이 아예 없는 스텝도 throw(카카오 스텝이 en 파이프라인에 새는 것 차단)", () => {
    expect(() => buildEnBriefing(brief([{ description: "무언가" }]), new Map(), NO_PARTS)).toThrow(/turnType/);
  });

  it("live 조각은 en에 싣지 않는다(고유명사 없음)", () => {
    const out = buildEnBriefing(
      brief([
        {
          description: "우회전 후 10m 이동",
          turnType: 13,
          distanceMeters: 10,
          live: { target: "파리바게뜨" },
        },
      ]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0].live).toBeUndefined();
  });

  it("좌표·행동 등 다른 필드는 보존한다", () => {
    const out = buildEnBriefing(
      brief([
        {
          description: "우회전 후 10m 이동",
          turnType: 13,
          action: "right",
          distanceMeters: 10,
          coord: { lat: 37.5, lng: 127.1 },
        },
      ]),
      new Map(),
      NO_PARTS,
    );
    expect(out.steps[0]).toMatchObject({ action: "right", coord: { lat: 37.5, lng: 127.1 } });
  });
});

describe("buildEnBriefing parts(A58 잔여 — 방향 구절을 가진 스텝에만, ko 판본 2와 같은 게이트)", () => {
  const steps: WalkRouteBriefing["steps"] = [
    { description: "직진 후 169m 이동", turnType: 11, distanceMeters: 169 },
    { description: "우회전 후 진황도로를 따라 294m 이동", turnType: 13, roadNameKo: "진황도로", distanceMeters: 294 },
    { description: "8시 방향 좌회전 후 20m 이동", turnType: 16, distanceMeters: 20 },
    { description: "좌측 횡단보도 후 14m 이동", turnType: 212, distanceMeters: 14 },
    { description: "10시 방향 횡단보도 후 30m 이동", turnType: 215, distanceMeters: 30 },
    { description: "횡단보도 후 12m 이동", turnType: 211, distanceMeters: 12 },
    { description: "지하보도 진입 후 72m 이동", turnType: 126, distanceMeters: 72 },
    { description: "좌회전", turnType: 12 },
    { description: "도착", turnType: 201 },
  ];
  const roads = new Map([["진황도로", "Jinhwangdo-ro"]]);

  it("회전은 본문이 이어지는 이동, 방향 박은 횡단은 방향을 뺀 횡단이 본문이다", () => {
    const out = buildEnBriefing(brief(steps), roads, PARTS).steps;
    expect(out[1].parts).toEqual({ turn: "Turn right", body: "Walk 294m along Jinhwangdo-ro" });
    expect(out[2].parts).toEqual({ turn: "Turn to your 8 o'clock", body: "Walk 20m" });
    expect(out[3].parts).toEqual({ turn: "Cross the crosswalk on your left", body: "Cross the crosswalk, then walk 14m" });
    expect(out[4].parts).toEqual({ turn: "Cross the crosswalk at 10 o'clock", body: "Cross the crosswalk, then walk 30m" });
  });

  it("방향 구절이 없는 스텝(직진·방향 없는 횡단·시설·도착)과 거리 없는 회전은 조각이 없다", () => {
    const out = buildEnBriefing(brief(steps), roads, PARTS).steps;
    for (const i of [0, 5, 6, 7, 8]) expect(out[i].parts, out[i].description).toBeUndefined();
  });

  it("문장은 조각 유무와 무관하게 같고, 게이트가 꺼지면 조각을 싣지 않는다(미지정 응답 불변)", () => {
    const on = buildEnBriefing(brief(steps), roads, PARTS).steps;
    const off = buildEnBriefing(brief(steps), roads, NO_PARTS).steps;
    expect(on.map((s) => s.description)).toEqual(off.map((s) => s.description));
    for (const s of off) expect(s.parts).toBeUndefined();
  });
});

describe("roadNameKeysOf", () => {
  it("중복 없이 도로명만 모은다", () => {
    expect(
      roadNameKeysOf(
        brief([
          { description: "a", turnType: 13, roadNameKo: "천호대로" },
          { description: "b", turnType: 13, roadNameKo: "천호대로" },
          { description: "c", turnType: 11 },
        ]),
      ),
    ).toEqual(["천호대로"]);
  });
});
