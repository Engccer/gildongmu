/**
 * 방위 축 판정이 fix 도착 빈도에 좌우되지 않는지 못 박는다 — **유도 층까지**.
 * 관측을 주입하지 않고 같은 궤적을 cadence만 바꿔 유도기에 먹인다. 유도기의
 * timestamp 중복 교체·age 절단·전진 게이트(표 밀도를 이동 거리에 묶는다)가
 * cadence 불변의 실제 담당자다.
 *
 * ⚠ 최소 증거량을 **개수**로만 표현하면 이 불변이 깨진다 — 그래서 개수 하한과
 * 함께 **판정 가능 비율**·**시간 span**을 요구한다(`guide-course-axis.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  deriveCourse,
  INITIAL_DERIVATION_STATE,
  type CourseDerivationState,
} from "../course-derivation";
import {
  courseAxisVerdict,
  courseVote,
  recordVote,
  type CourseAxisVerdict,
  type CourseVoteSample,
} from "../guide-course-axis";
import { buildGuideRoute } from "../route-geometry";

// 남 → 북 직선 200m (접선은 어디서나 0도)
const route = buildGuideRoute([
  {
    description: "북진",
    pathCoords: [
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5 + 200 / 111320, lng: 127.1 },
    ],
  },
])!;
const M_LAT = 1 / 111320;

/**
 * bearingDeg 방향 1.2m/s 보행 40초를 hz cadence로 유도기→표결→창에 재생한다.
 * batchDup=true면 각 fix를 같은 timestamp로 두 번 배달한다(중복 교체 검증).
 */
function replay(hz: number, bearingDeg: number, batchDup = false): CourseAxisVerdict {
  const rad = (bearingDeg * Math.PI) / 180;
  let state: CourseDerivationState = INITIAL_DERIVATION_STATE;
  let samples: CourseVoteSample[] = [];
  let verdict: CourseAxisVerdict = "unknown";
  const n = Math.round(40 * hz);
  for (let i = 0; i <= n; i++) {
    const t = i / hz;
    const dist = 1.2 * t;
    const fix = {
      lat: 37.5 + (Math.cos(rad) * dist) * M_LAT,
      lng: 127.1 + ((Math.sin(rad) * dist) * M_LAT) / Math.cos((37.5 * Math.PI) / 180),
    };
    const deliveries = batchDup ? 2 : 1;
    for (let k = 0; k < deliveries; k++) {
      const r = deriveCourse(state, fix, t);
      state = r.state;
      if (r.obs !== null) {
        samples = recordVote(samples, t, courseVote(r.obs, route.polyline, 100));
      } else {
        samples = samples.filter((s) => s.at > t - 20);
      }
    }
    verdict = courseAxisVerdict(samples);
  }
  return verdict;
}

describe("cadence 불변 (유도 층 포함)", () => {
  it("1Hz와 10Hz가 같은 판정을 낸다", () => {
    expect(replay(1, 90)).toBe("off");
    expect(replay(10, 90)).toBe(replay(1, 90));
    expect(replay(1, 0)).toBe("on");
    expect(replay(10, 0)).toBe(replay(1, 0));
  });

  it("0.5Hz도 같은 판정을 낸다 — 느린 기기가 영영 미달이면 안 된다", () => {
    expect(replay(0.5, 90)).toBe("off");
    expect(replay(0.5, 0)).toBe("on");
  });

  it("cadence 하한이 있다 — 0.2Hz는 표가 모자라 영구 unknown", () => {
    // ⚠ 정직하게 적어 둔다: "cadence 불변"은 무제한이 아니다. 유도 관측의 표 밀도는
    //   전진 게이트(2m) 때문에 이동 거리에 묶이지만, fix 자체가 5초에 하나면 20초
    //   창에 표가 최대 4장이라 MIN_VOTES=8에 영영 못 미친다. iOS 표준 주기(~1Hz)는
    //   여유가 있지만 저전력 모드·실내에서 주기가 늘어지면 축이 조용히 죽는다는 뜻이다.
    expect(replay(0.2, 90)).toBe("unknown");
  });

  it("같은 시각에 중복 배달된 fix가 창을 장악하지 못한다 — 유도기가 교체 흡수", () => {
    expect(replay(1, 90, true)).toBe(replay(1, 90));
    expect(replay(1, 0, true)).toBe(replay(1, 0));
  });

  it("배치 도착(짧은 시간에 몰림)은 시간 span이 모자라 확정하지 못한다", () => {
    // 표결·창 층 단독 검증(기존 계약 유지): 2초 구간에 30표가 몰려도 span 미달.
    let s: CourseVoteSample[] = [];
    for (let i = 0; i < 30; i++) s = recordVote(s, i % 2, "mismatch");
    expect(courseAxisVerdict(s)).toBe("unknown");
  });
});
