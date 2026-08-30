import { describe, expect, it } from "vitest";
import { buildDisplayUnits, guideLiveRows, type LiveStepInput } from "../guide-live-rows";
import { TURN_APPROACH_M } from "../guide-live-rows";

function steps(
  ...defs: [number, string, { target?: string; anchor?: string; crossing?: true }?][]
): LiveStepInput[] {
  let d = 0;
  return defs.map(([len, description, extra]) => {
    const { crossing, ...live } = extra ?? {};
    const s: LiveStepInput = {
      description,
      startD: d,
      endD: d + len,
      ...(live.target || live.anchor ? { live } : {}),
      // 횡단 구간은 서버 플래그가 근거다(A26) — 문장의 "건너"로 판정하지 않는다.
      ...(crossing ? { crossing } : {}),
    };
    d += len;
    return s;
  });
}

describe("buildDisplayUnits (spec §4.1)", () => {
  it("행동 없는 경계는 이전 유닛에 흡수한다(F5)", () => {
    const u = buildDisplayUnits(
      steps(
        [40, "천중로를 따라 40m 이동"],
        [30, "30m 이동"],
        [35, "오른쪽으로 돌아 35m 이동"],
      ), "text");
    expect(u.map((x) => x.stepIndices)).toEqual([[0, 1], [2]]);
    expect(u[0].endD).toBe(70);
    expect(u[0].endAction).toBe("right");
    expect(u[1].endAction).toBeNull(); // 최종 유닛
  });

  it("횡단 스텝은 단독 유닛이고 흡수하지 않는다", () => {
    const u = buildDisplayUnits(
      steps(
        [58, "파리바게뜨까지 58m 이동", { target: "파리바게뜨" }],
        [21, "횡단보도를 건너세요, 횡단보도 길이 21m, 음향신호기 있음", { crossing: true }],
        [40, "40m 이동"],
      ), "text");
    expect(u.map((x) => x.stepIndices)).toEqual([[0], [1], [2]]);
    expect(u[0].endAction).toBe("crosswalk");
    expect(u[1].crossing).toBe(true);
    expect(u[1].crossingText).toBe("횡단보도를 건너세요, 횡단보도 길이 21m, 음향신호기 있음");
  });

  it("이름은 서버 조각에서만 온다 — target·endAnchor 배선", () => {
    const u = buildDisplayUnits(
      steps(
        [58, "파리바게뜨까지 58m 이동", { target: "파리바게뜨" }],
        [35, "약국 앞에서 오른쪽으로 돌아 35m 이동", { anchor: "약국" }],
      ), "text");
    expect(u[0].target).toBe("파리바게뜨");
    expect(u[0].endAnchor).toBe("약국");
  });

  it("지명 속 '횡단보도'(회전 문장)는 횡단 유닛이 아니다", () => {
    const u = buildDisplayUnits(
      steps([40, "직진 40m 이동"], [30, "천호역 횡단보도에서 왼쪽으로 돌아 30m 이동"]), "text");
    expect(u[1].crossing).toBe(false);
    expect(u[0].endAction).toBe("left");
  });
});

describe("guideLiveRows — 클램프·리셋(F4)", () => {
  const units = buildDisplayUnits(
    steps([100, "목적지까지 100m 이동", { target: "목적지" }]), "text");

  it("역행 잔여는 직전 표시값 유지, 국면도 클램프 값으로 판정", () => {
    const a = guideLiveRows(null, units, 30, 0, "following", TURN_APPROACH_M); // eff 40 → 60
    expect(a.top).toEqual({ kind: "straight", meters: 60, target: "목적지" });
    const b = guideLiveRows(a.state, units, 28, 0, "following", TURN_APPROACH_M); // raw 62 → 클램프 60
    expect(b.top).toEqual({ kind: "straight", meters: 60, target: "목적지" });
  });

  it("prev=null 리셋이면 새 기준으로 다시 계산한다", () => {
    const a = guideLiveRows(null, units, 50, 0, "following", TURN_APPROACH_M); // eff 60 → 40
    expect(a.top).toEqual({ kind: "straight", meters: 40, target: "목적지" });
    const r = guideLiveRows(null, units, 50, 50, "following", TURN_APPROACH_M); // 재조회: 램프인 재시작
    expect(r.top).toEqual({ kind: "straight", meters: 50, target: "목적지" });
  });

  it("이탈은 両행 처리 — top=offRoute, next=null, state 리셋", () => {
    const o = guideLiveRows({ unitIndex: 0, clamped: 60 }, units, 30, 0, "offRoute", TURN_APPROACH_M);
    expect(o).toEqual({ state: null, top: { kind: "offRoute" }, next: null });
  });
});
