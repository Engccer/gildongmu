import { getKakaoWalkBriefing } from "./providers/kakao-walk";
import { rewriteWalkBriefing } from "./walk-guidance";
import { attachStepActions } from "./walk-route";
import { haversineMeters } from "./geo";
import type { Coord, WalkRouteBriefing } from "./types";

/**
 * 카카오 도보 탐침 — 나들이 횡단보도·꺾임 지점 원천(E58 ①③, spec `2026-09-26-outing-mode-design.md` §6.6).
 *
 * 현재 좌표에서 진행 방위로 `PROBE_AHEAD_METERS` 간 지점까지 도보 경로를 한 번 묻고, 스텝 `action`(서버
 * `attachStepActions` — 도보 안내 결정 지점 큐와 같은 분류)에서 횡단보도 지점과 회전 지점만 뽑는다.
 *
 * ⚠ **결과를 저장하지 않는다**(연구 `RESEARCH-2026-10-02-outing-walk-network.md` §4.3 — 카카오 운영자 "실시간 호출이
 * 아닌 형태로는 이용할 수 없습니다"). upstream fetch는 `no-store`이고, 이 모듈·라우트에 캐시·로그 좌표가 없다.
 * 기기는 세션 메모리에서만 쓴다.
 *
 * ⚠ **카카오만 부른다(`getWalkRoute`를 타지 않는다)**: 그 파이프라인은 카카오 실패마다 Tmap 보행자로 폴백하는데,
 * Tmap은 자동차 ko 기본 경로와 일 1,000건을 공유한다 — 카카오 한도가 찬 저녁에 탐침 전부가 Tmap으로 가 자동차
 * 안내를 먹는다(설계 리뷰 M5). 탐침이 실패하면 정적 원천으로 강등될 뿐이다.
 *
 * 분류는 도보 안내와 같은 파이프라인(재작성 `rewriteWalkBriefing` → 행동 투영 `attachStepActions`)이다 — 분류기가
 * 재작성된 ko 문장을 받는 계약이라 앱 언어와 무관하게 ko다(문장은 쓰지 않는다). `SHORTEST`는 연구 탐침과 같은 축이다
 * (큰길 우선이면 경로가 골목을 피해 꺾임 지점이 덜 나온다). 좌표는 원좌표다(`no-store`라 반올림할 캐시 키가 없다).
 */

/** 탐침 도착점 거리(m). 앱은 방위만 보내고 이 거리는 서버만 안다. */
export const PROBE_AHEAD_METERS = 180;
/** 회전 지점의 갈래 점 거리(m) — 정적 seed 갈래(25m)와 같은 값. */
const TURN_BRANCH_METERS = 25;

export interface WalkProbe {
  /** 횡단보도 스텝의 첫 좌표. "2개의 횡단보도 이용"은 첫 횡단보도만이다(둘째 좌표가 응답에 없다). */
  crosswalks: Coord[];
  /** 회전 스텝의 첫 좌표(꺾는 자리) + 그 스텝 경로를 따라 25m 간 점(꺾어 들어가는 길). */
  turns: Array<Coord & { branch: Coord }>;
}

/** 방위로 m만큼 간 점(수백 m라 평면 근사). */
export function probeTarget(lat: number, lng: number, bearingDeg: number): Coord {
  const meters = PROBE_AHEAD_METERS;
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    lat: lat + (meters * Math.cos(rad)) / 111_320,
    lng: lng + (meters * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function alongPath(path: Coord[], meters: number): Coord {
  let acc = 0;
  for (let i = 1; i < path.length; i += 1) {
    const seg = haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    if (seg > 0 && acc + seg >= meters) {
      const f = (meters - acc) / seg;
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * f,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * f,
      };
    }
    acc += seg;
  }
  return path[path.length - 1];
}

/** 기하 응답 → 탐침 두 목록(순수). 좌표 없는 스텝은 건너뛴다. 갈래 점이 꺾는 자리와 같으면(경로 1점) 버린다. */
export function extractProbe(briefing: WalkRouteBriefing | null): WalkProbe {
  const probe: WalkProbe = { crosswalks: [], turns: [] };
  for (const step of briefing?.steps ?? []) {
    const path = step.pathCoords;
    if (!path || path.length === 0) continue;
    if (step.action === "crosswalk") {
      probe.crosswalks.push({ lat: path[0].lat, lng: path[0].lng });
    } else if (step.action === "left" || step.action === "right") {
      const branch = alongPath(path, TURN_BRANCH_METERS);
      if (haversineMeters(path[0].lat, path[0].lng, branch.lat, branch.lng) < 5) continue;
      probe.turns.push({ lat: path[0].lat, lng: path[0].lng, branch });
    }
  }
  return probe;
}

/** 탐침 1건. 경로 없음은 빈 목록, upstream 실패는 throw(라우트가 502). 게이트(`hasKakaoKey`)는 라우트 몫. */
export async function getWalkProbe(lat: number, lng: number, bearingDeg: number): Promise<WalkProbe> {
  const raw = await getKakaoWalkBriefing({
    origin: { lat, lng },
    dest: probeTarget(lat, lng, bearingDeg),
    routeMode: "SHORTEST",
    preciseCoords: true,
    noStore: true,
  });
  if (!raw) return { crosswalks: [], turns: [] };
  return extractProbe(attachStepActions(rewriteWalkBriefing(raw, true), true));
}
