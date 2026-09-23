import { env } from "../env";
import { swopenResultCode } from "./seoul-subway-arrival";

/**
 * 서울 지하철 실시간 열차 위치 provider (swopenapi `realtimePosition`, E35).
 *
 * 실 API 특성 (2026-09-23 실호출, spec `2026-09-23-riding-current-station-design.md` §2):
 * - http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimePosition/{s}/{e}/{노선명}
 *   (도착 API와 같은 호스트·키·http 전용). 노선명은 서울 표기(`5호선`·`경의중앙선`).
 * - 봉투는 도착 API와 같은 계열 — 정상 `errorMessage.code`(중첩), 에러 최상위 `code`(평면).
 * - `trainNo` = 도착 API `btrainNo`(조인 8/8). `statnNm`은 부역명 포함(`군자(능동)`).
 * - `trainSttus`: 0 진입 · 1 도착 · 2 출발 · 3 전역 출발(직전 역을 떠나 `statnNm`으로 가는 중).
 *
 * ⚠ `updnLine`은 파싱하지 않는다 — 규격 문언과 실측 방향이 어긋난 기록이 있고(2026-08-03 조사)
 * 조인은 노선 + 열차번호로 충분하다. 소스에 이름이 없으면 나중에도 조용히 쓰이지 않는다.
 *
 * graceful degrade: 키 없음 → null. INFO-200 → 0행(운행 밖과 노선 미제공이 같은 코드라 가르지
 * 않는다 — 소비자가 "이 열차 없음"으로 말한다). 그 밖의 코드·HTTP 오류 → throw(라우트 502).
 */

const BASE = "http://swopenapi.seoul.go.kr/api/subway";

/**
 * 조회 창(행 수). 2026-09-23 15시(비혼잡) 1호선 69·4호선 37·2호선 36행 — 1호선 러시아워의 여유를 둔 값.
 * ⚠ 창 끝 번호가 곧 행 수다(`0/5` → 5행, 실측) — `0/{ROWS}`로 부른다.
 */
const ROWS = 200;

/** 노선 캐시 TTL(ms) — 세션들의 60초 주기 조회를 노선 단위로 합친다(spec §3.1). */
export const POSITION_CACHE_TTL_MS = 20_000;

export interface SubwayTrainPosition {
  trainNo: string;
  /** 현재역(부역명 포함 원문). */
  station: string;
  /** 0 진입 · 1 도착 · 2 출발 · 3 전역 출발. 결측은 undefined. */
  trainStatus?: string;
  /** recptnDt 원문(KST). 결측은 undefined. */
  receivedAt?: string;
}

export interface SubwayLinePositions {
  trains: SubwayTrainPosition[];
  /** upstream이 말한 전체 건수(INFO-200은 0). */
  total: number;
  /** 전체 건수가 받은 행 수보다 많다 — 조회 창 밖 열차는 "없음"으로 떨어진다. */
  truncated: boolean;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** 응답 정규화 — 열차번호·역명이 없는 행은 조인할 수 없어 버린다. */
export function parseSubwayPositions(raw: unknown): SubwayLinePositions {
  const code = swopenResultCode(raw);
  if (code === "INFO-200") return { trains: [], total: 0, truncated: false };
  if (code !== "INFO-000") {
    throw new Error(`서울 지하철 실시간 위치 오류: ${code || "unknown"}`);
  }
  const r = raw as { errorMessage?: { total?: unknown }; realtimePositionList?: unknown };
  const list = Array.isArray(r.realtimePositionList)
    ? (r.realtimePositionList as Record<string, unknown>[])
    : [];
  const trains: SubwayTrainPosition[] = [];
  for (const row of list) {
    const trainNo = str(row.trainNo);
    const station = str(row.statnNm);
    if (!trainNo || !station) continue;
    trains.push({
      trainNo,
      station,
      trainStatus: str(row.trainSttus) || undefined,
      receivedAt: str(row.recptnDt) || undefined,
    });
  }
  const reported = Number(str(r.errorMessage?.total));
  const total = Number.isFinite(reported) && reported > 0 ? reported : list.length;
  return { trains, total, truncated: total > list.length };
}

type CacheEntry = { at: number; value: SubwayLinePositions };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SubwayLinePositions>>();

/** 테스트 전용 — 모듈 수명 캐시를 비운다. */
export function resetSubwayPositionCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * 노선 하나의 운행 열차 위치. 키 없음 → null.
 *
 * 노선 단위 캐시(TTL 20초) + 비행 중 요청 공유: 같은 노선을 타는 세션들이 한 번의 upstream
 * 호출을 나눠 쓴다(spec §5 ② — 도착 조회는 역 단위라 못 합치지만 위치는 노선 단위라 합친다).
 * 실패는 캐시하지 않는다. Next 데이터 캐시를 쓰지 않는 이유: stale-while-revalidate라 한동안
 * 조회가 없던 노선의 첫 요청이 낡은 목록을 받는다 — 실시간 표식에선 그것이 곧 거짓 위치다.
 */
export async function fetchSubwayLinePositions(
  line: string,
  now: number = Date.now(),
): Promise<SubwayLinePositions | null> {
  const key = env.SEOUL_SUBWAY_REALTIME_KEY;
  if (!key) return null;
  const hit = cache.get(line);
  if (hit && now - hit.at < POSITION_CACHE_TTL_MS) return hit.value;
  const pending = inFlight.get(line);
  if (pending) return pending;

  const task = (async () => {
    const url = `${BASE}/${key}/json/realtimePosition/0/${ROWS}/${encodeURIComponent(line)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`서울 지하철 실시간 위치 조회 실패: HTTP ${res.status}`);
    const value = parseSubwayPositions(await res.json());
    if (value.truncated) {
      // 조회 창 밖이 있다 — 그 열차는 notFound로 떨어진다(조용한 은폐가 아니라 로그로 드러나는 한계).
      console.warn(`[seoul-subway-position] ${line} 조회 창 초과: total=${value.total}`);
    }
    cache.set(line, { at: now, value });
    return value;
  })();
  inFlight.set(line, task);
  try {
    return await task;
  } finally {
    inFlight.delete(line);
  }
}
