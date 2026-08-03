import { describe, it, expect } from "vitest";
import {
  beaconStep,
  INITIAL_BEACON_STATE,
  type BeaconState,
  type BeaconFix,
} from "../beacon";

// 목적지: 서울시청 부근. 거리는 haversine 실제값을 쓰되, 같은 경도선에서
// 위도차로 거리를 만든다(위도 0.001° ≈ 111m). dest 기준 북쪽으로 떨어진 점.
const DEST = { lat: 37.5665, lng: 126.978 };
// dest에서 정북으로 d미터 떨어진 fix 생성(경도 고정, 위도만 가감).
function fixAt(metersNorth: number, accuracy = 10): BeaconFix {
  const dLat = metersNorth / 111_320; // 위도 1° ≈ 111.32km
  return { lat: DEST.lat + dLat, lng: DEST.lng, accuracy };
}

describe("beaconStep", () => {
  it("음수 accuracy(무효 좌표 신호)는 weak이고 앵커를 잡지 않는다", () => {
    // CoreLocation은 horizontalAccuracy < 0으로 좌표 무효를 신호한다. 웹 입력엔
    // 오지 않지만 가드가 갈리면 "두 플랫폼 단일 정본"이 거짓이 된다(spec §3.2).
    const { state, announce } = beaconStep(INITIAL_BEACON_STATE, fixAt(300, -1), DEST);
    expect(announce.kind).toBe("weak");
    expect(state.anchorDistance).toBeNull();
  });

  it("첫 fix는 first·speak=true·앵커 설정", () => {
    const { state, announce } = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST);
    expect(announce.kind).toBe("first");
    expect(announce.speak).toBe(true);
    expect(Math.round(announce.distance)).toBeGreaterThan(250);
    expect(state.anchorDistance).not.toBeNull();
  });

  it("데드밴드 내 미세 진동은 추세를 뒤집지 않는다(flapping 억제)", () => {
    let s: BeaconState = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    // ±10m 진동(데드밴드 15m 미만) → 전부 hold
    for (const d of [305, 295, 308, 293]) {
      const r = beaconStep(s, fixAt(d), DEST);
      expect(r.announce.kind).toBe("hold");
      s = r.state;
    }
  });

  it("앵커보다 deadBand 이상 줄면 closer", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(250), DEST); // 50m 감소 > 15
    expect(r.announce.kind).toBe("closer");
  });

  it("앵커보다 deadBand 이상 늘면 farther", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(350), DEST);
    expect(r.announce.kind).toBe("farther");
  });

  it("accuracy>100은 weak·추세 불변", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(200, 150), DEST);
    expect(r.announce.kind).toBe("weak");
    expect(r.state.anchorDistance).toBe(s.anchorDistance);
  });

  it("정확도가 크면 데드밴드가 커져 같은 변화도 hold", () => {
    // accuracy=60 → deadBand=60. 첫 fix도 accuracy 60으로.
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300, 60), DEST).state;
    const r = beaconStep(s, fixAt(260, 60), DEST); // 40m 감소 < 60
    expect(r.announce.kind).toBe("hold");
  });

  it("추세 flip이면 speak=true(마일스톤 미달이어도)", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    s = beaconStep(s, fixAt(280), DEST).state; // closer 확립
    const r = beaconStep(s, fixAt(300), DEST); // 다시 farther = flip
    expect(r.announce.kind).toBe("farther");
    expect(r.announce.speak).toBe(true);
  });

  it("farther 지속은 50m 마일스톤 유지(경고 축은 촘촘하게)", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state; // lastSpoken≈300
    let r = beaconStep(s, fixAt(330), DEST); // 30m 증가 < 50 → 침묵
    expect(r.announce.kind).toBe("farther");
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(355), DEST); // 누적 55m ≥ 50 → speak
    expect(r.announce.speak).toBe(true);
  });

  it("closer 지속은 300m 이내에서 100m 마일스톤(50m 누적으로는 침묵)", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state; // lastSpoken≈300
    let r = beaconStep(s, fixAt(280), DEST); // 20m
    expect(r.announce.kind).toBe("closer");
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(245), DEST); // 누적 55m — 종전 50m 정책이면 발화했다
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(195), DEST); // 누적 105m ≥ 100 → speak
    expect(r.announce.speak).toBe(true);
  });

  it("closer 지속은 1km 초과에서 500m 마일스톤", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(2000), DEST).state;
    let r = beaconStep(s, fixAt(1700), DEST); // 300m < 500 → 침묵
    expect(r.announce.kind).toBe("closer");
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(1450), DEST); // 누적 550m ≥ 500 → speak
    expect(r.announce.speak).toBe(true);
  });

  it("closer 지속은 5km 초과에서 1km 마일스톤(차량 이동 스팸 억제)", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(8000), DEST).state;
    let r = beaconStep(s, fixAt(7200), DEST); // 800m < 1000 → 침묵
    expect(r.announce.kind).toBe("closer");
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(6900), DEST); // 누적 1,100m ≥ 1000 → speak
    expect(r.announce.speak).toBe(true);
  });

  it("도착 임박은 nearby·정밀숫자 대신 ±accuracy·진입 시 1회 speak", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(15, 12), DEST); // 15m ≤ arrivalThreshold(max(20,12)=20)
    expect(r.announce.kind).toBe("nearby");
    expect(r.announce.speak).toBe(true);
    expect(r.state.nearby).toBe(true);
    // 머무는 동안 재발화 안 함
    const r2 = beaconStep(r.state, fixAt(14, 12), DEST);
    expect(r2.announce.kind).toBe("nearby");
    expect(r2.announce.speak).toBe(false);
  });

  it("nearby 이탈(threshold+deadBand 초과) 시 추세 재개", () => {
    const s0 = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const near = beaconStep(s0, fixAt(15, 10), DEST).state; // nearby, anchor≈15
    const r = beaconStep(near, fixAt(120, 10), DEST); // 120 > 20+10 → 이탈, farther
    expect(r.state.nearby).toBe(false);
    expect(r.announce.kind).toBe("farther");
  });

  it("hold는 speak=false", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(305), DEST);
    expect(r.announce.kind).toBe("hold");
    expect(r.announce.speak).toBe(false);
  });

  it("NaN 좌표는 weak로 graceful", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, { lat: NaN, lng: NaN, accuracy: 10 }, DEST);
    expect(r.announce.kind).toBe("weak");
    expect(r.state.anchorDistance).toBe(s.anchorDistance);
  });
});
