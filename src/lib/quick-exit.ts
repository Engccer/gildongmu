import type { QuickExit, QuickExitDoor } from "./types";
import seedJson from "./data/subway-quick-exit.json";
import { normalizeStationName } from "./station-match";

/**
 * 지하철 빠른하차 판정 — 하차역·노선·직전역으로 계단·엘리베이터에 가장 가까운 문을 고른다.
 * 설계 정본은 `docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md`.
 *
 * React/Next 비의존 순수 로직이지만 seed가 90KB라 **서버 전용 import**다
 * (`subway-stations` 동형 — 클라이언트 번들에 넣지 말 것).
 */

type SeedDirection = { up: boolean; toward: string[]; elevator: string[]; stairs: string[] };
const STATIONS = (seedJson as { stations: Record<string, SeedDirection[]> }).stations;

/** 서울 지하철 전동차의 칸당 문 수(실측: seed의 문 번호 분포가 1~4뿐). */
const DOORS_PER_CAR = 4;

/**
 * ⚠ ODsay는 `"수도권 5호선"`, 이 데이터는 `"5호선"`이다(실호출 확정). 역명 조인 100%는
 * 정적 역 seed와의 관계만 증명하고 런타임 ODsay 표기를 증명하지 않는다.
 *
 * 접두만 벗기고 **노선 화이트리스트는 두지 않는다**: 커버 범위의 정본은 seed 키 하나여야
 * 한다(9호선·신분당선은 키가 없어 다음 단계에서 걸리고, 1호선 코레일 구간은 노선명이
 * 통과해도 역명이 없어 걸린다). 화이트리스트를 병치하면 관측되지 않는 채로 seed와 어긋날
 * 수 있고, 노선이 늘 때 두 곳을 고쳐야 한다 — 변이 주입에서 검출 불가로 확인해 걷어냈다.
 */
function normalizeLine(lineName: string): string {
  return lineName.trim().replace(/^수도권\s+/, "");
}

/**
 * 열차 선형 위치. `pos("N-M") = (N-1)*4 + M`, 문 사이는 두 문의 중간값.
 *
 * ⚠ **(칸 차이, 문 차이) 사전순은 물리 거리가 아니다.** `1-4`와 `2-1`은 칸이 달라도 실제로는
 * 바로 옆 문(4와 5)인데, 사전순은 같은 칸 양끝(`2-1`·`2-4`, 5와 8)보다 멀다고 판정한다.
 */
export function doorPosition(door: string): number | null {
  const single = /^(\d+)-(\d+)$/.exec(door);
  if (single) return (Number(single[1]) - 1) * DOORS_PER_CAR + Number(single[2]);
  const between = /^(\d+)-(\d+),(\d+)-(\d+) 사이$/.exec(door);
  if (!between) return null;
  const a = (Number(between[1]) - 1) * DOORS_PER_CAR + Number(between[2]);
  const b = (Number(between[3]) - 1) * DOORS_PER_CAR + Number(between[4]);
  return (a + b) / 2;
}

type Candidate = { door: QuickExitDoor; pos: number };

function toCandidate(raw: string): Candidate | null {
  const pos = doorPosition(raw);
  if (pos === null) return null;
  const between = /^(\d+-\d+),(\d+-\d+) 사이$/.exec(raw);
  if (between) return { door: { kind: "between", doors: [between[1], between[2]] }, pos };
  return { door: { kind: "door", doors: [raw] }, pos };
}

const candidates = (doors: string[]): Candidate[] =>
  doors.map(toCandidate).filter((c): c is Candidate => c !== null);

/**
 * 두 시설을 병기하는 이유는 사용자가 *도착해서* 고르게 하려는 것이다. 둘이 멀면 *승차 전에*
 * 이미 골라야 해서 병기의 의미가 사라진다 — 그래서 각자 최저가 아니라 **쌍**을 최적화한다
 * (실측: 칸 차이 0~1이 91.0% vs 각자 최저 55.2%).
 *
 * 동률은 엘리베이터 위치 → 계단 위치 오름차순으로 자른다. 총정렬이라 원본 행 순서가
 * 바뀌어도 결과가 불변이다.
 */
export function selectQuickExitDoors(
  elevatorDoors: string[],
  stairsDoors: string[],
): QuickExit | null {
  const elevators = candidates(elevatorDoors);
  const stairs = candidates(stairsDoors);
  if (elevators.length && stairs.length) {
    let best: { e: Candidate; s: Candidate } | null = null;
    for (const e of elevators) {
      for (const s of stairs) {
        if (
          best === null ||
          Math.abs(e.pos - s.pos) < Math.abs(best.e.pos - best.s.pos) ||
          (Math.abs(e.pos - s.pos) === Math.abs(best.e.pos - best.s.pos) &&
            (e.pos < best.e.pos || (e.pos === best.e.pos && s.pos < best.s.pos)))
        ) {
          best = { e, s };
        }
      }
    }
    return { elevator: best!.e.door, stairs: best!.s.door };
  }
  // 쌍을 이룰 상대가 없으면 최적화할 축이 없다 — 그 시설의 선형 위치 최소값.
  const lowest = (list: Candidate[]) =>
    list.reduce((a, b) => (b.pos < a.pos ? b : a)).door;
  if (elevators.length) return { elevator: lowest(elevators) };
  if (stairs.length) return { stairs: lowest(stairs) };
  return null;
}

export function findQuickExit(input: {
  /** 하차역(ODsay 표기) */
  stationName: string;
  /** 노선(ODsay 표기 — "수도권 5호선") */
  lineName: string;
  /** 경로상 하차역 직전 정차역 */
  previousStopName: string | null;
}): QuickExit | null {
  const line = normalizeLine(input.lineName);
  const station = normalizeStationName(input.stationName);
  if (!station) return null;
  const directions = STATIONS[`${station}|${line}`];
  if (!directions) return null;

  const previous = input.previousStopName ? normalizeStationName(input.previousStopName) : "";
  if (!previous) return null;

  // 그 방향으로 갈 때 다음 역이 직전역과 같으면 반대 방향이다. 정확히 하나가 남고 그 방향의
  // 방면이 하나로 확정될 때만 진행한다 — 배제로 살아남은 것과 확인된 것은 다르므로,
  // 방면이 없거나(응암 6호선 상행) 둘인(분기) 방향은 남더라도 채택하지 않는다.
  const remaining = directions.filter((d) => !d.toward.includes(previous));
  if (remaining.length !== 1) return null;
  const direction = remaining[0];
  if (direction.toward.length !== 1) return null;

  return selectQuickExitDoors(direction.elevator, direction.stairs);
}
