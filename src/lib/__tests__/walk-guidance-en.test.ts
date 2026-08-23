import { describe, expect, it } from "vitest";
import { buildEnBriefing, roadNameKeysOf } from "../walk-guidance-en";
import type { WalkRouteBriefing } from "../types";

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
    );
    expect(out.steps[0].description).toBe("Turn right, then walk 294m along Jinhwangdo-ro");
  });

  it("문장 끝에 마침표를 두지 않는다(주석이 쉼표로 덧붙는다)", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 10m 이동", turnType: 11, distanceMeters: 10 }]),
      new Map(),
    );
    expect(out.steps[0].description.endsWith(".")).toBe(false);
  });

  it("행동절이 없으면 Walk로 시작한다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 169m 이동", turnType: 11, distanceMeters: 169 }]),
      new Map(),
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
    );
    expect(out.steps[0].description).toBe("Cross the crosswalk on your left, then walk 14m");
  });

  it("시설 문장도 원문 구조를 그대로 옮긴다", () => {
    const out = buildEnBriefing(
      brief([
        { description: "서울역 2번출구에서 지하보도 진입 후 72m 이동", turnType: 126, distanceMeters: 72 },
      ]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Take the underpass, then walk 72m");
  });

  it("도착 스텝은 거리·도로명을 달지 않는다", () => {
    const out = buildEnBriefing(brief([{ description: "도착", turnType: 201 }]), new Map());
    expect(out.steps[0].description).toBe("Arrive at your destination");
  });

  it("거리가 없으면 거리 절을 뺀다", () => {
    const out = buildEnBriefing(brief([{ description: "좌회전", turnType: 12 }]), new Map());
    expect(out.steps[0].description).toBe("Turn left");
  });

  it("1km 이상은 formatDistance 표기를 쓴다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 1.1km 이동", turnType: 11, distanceMeters: 1100 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Walk 1.1km");
  });

  it("미지 turnType은 throw — 행동절 없는 문장은 조용히 틀린 직진 지시다", () => {
    expect(() =>
      buildEnBriefing(brief([{ description: "무언가", turnType: 9999 }]), new Map()),
    ).toThrow(/미지/);
  });

  it("turnType이 아예 없는 스텝도 throw(카카오 스텝이 en 파이프라인에 새는 것 차단)", () => {
    expect(() => buildEnBriefing(brief([{ description: "무언가" }]), new Map())).toThrow(/turnType/);
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
    );
    expect(out.steps[0]).toMatchObject({ action: "right", coord: { lat: 37.5, lng: 127.1 } });
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
