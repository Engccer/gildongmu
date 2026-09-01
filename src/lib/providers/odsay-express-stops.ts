import { unstable_cache } from "next/cache";
import { roundCoord } from "../coord-round";
import { env } from "../env";
import {
  extractExpressStops,
  type ExpressLineEntry,
  type ExpressResponseLike,
} from "../express-stops";
import { readOdsayError } from "./odsay-envelope";
import { fetchOdsayJson } from "./odsay-fetch";
import type { Coord } from "../types";

/**
 * 급행 정차역 집합 조회 + 장기 캐시(A16 L1, spec `2026-09-02-express-stops-data-design.md` §3.3).
 *
 * 노선 전 구간 OD를 **정·역방향 2콜**로 조회해 수락 판정(`extractExpressStops`)에 태운다. 급행 정차역은
 * 다이어 개정 때만 바뀌므로 7일 `unstable_cache`. 공개 저장소라 seed로 커밋하지 않는다(재배포 문제) —
 * 런타임 캐시가 정본이다.
 *
 * ⚠ **캐시 함수는 검증된 비어 있지 않은 집합만 정상 반환하고 그 외는 전부 throw**한다(HTTP·봉투 오류·
 *   수락 판정 부재). `unstable_cache`는 예외를 굳히지 않으므로 다음 요청이 재시도하고 소비자에겐 부재로
 *   떨어진다. 부재를 정상 반환하는 경로는 캐시 안에 없다 — 부재를 7일 굳히면 그 사이 급행 판정이 통째로
 *   비고, 거짓 집합을 굳히면 7일 동안 잘못 차단한다(설계 리뷰 #5).
 * ⚠ 재시도 억제는 캐시 **바깥** 두 겹: ①노선별 단일 실행(같은 인스턴스의 동시 요청이 probe를 중복 호출하지
 *   않게) ②실패 종류별 쿨다운 — 수락 판정 부재·봉투 오류(표기·스키마 드리프트 = 지속적) 6시간, HTTP·네트워크·
 *   타임아웃(일시적) 10분, ODsay 429(쿼터) 1시간. 프로세스 메모리라 인스턴스마다 따로지만 재시도는
 *   "includeStops 길찾기 요청 중 표 노선 leg가 있는 것"에서만 일어나 상한이 시간 창이 아니라 요청 수다.
 *   ([[cooldown-gate-belongs-after-cache]] — 캐시 히트 경로는 이 표를 보지 않는다.)
 */

const EXPRESS_STOPS_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 캐시 키 버전 — 필드 형태를 바꾸면 올려 구버전 배포의 캐시가 새 형태를 오염시키지 않게 한다. */
const CACHE_CONTRACT = "v1";
const PROBE_TIMEOUT_MS = 8_000;

export type ExpressStopsFailure = "rejected" | "quota" | "transient";
const COOLDOWN_MS: Record<ExpressStopsFailure, number> = {
  rejected: 6 * 60 * 60 * 1000,
  quota: 60 * 60 * 1000,
  transient: 10 * 60 * 1000,
};

export class ExpressStopsError extends Error {
  constructor(
    readonly kind: ExpressStopsFailure,
    message: string,
  ) {
    super(message);
    this.name = "ExpressStopsError";
  }
}

/** 노선별 마지막 실패(프로세스 수명). */
const lastFailure = new Map<string, { at: number; kind: ExpressStopsFailure }>();
/** 노선별 진행 중 조회(단일 실행). */
const inFlight = new Map<string, Promise<string[]>>();

async function probe(origin: Coord, dest: Coord): Promise<ExpressResponseLike> {
  const q = new URLSearchParams({
    SX: roundCoord(origin.lng, 4),
    SY: roundCoord(origin.lat, 4),
    EX: roundCoord(dest.lng, 4),
    EY: roundCoord(dest.lat, 4),
    OPT: "0",
    // 지하철만 — 버스 혼합 경로를 배제해 급행 leg가 한 path 안에서 전 구간을 덮게 한다.
    SearchPathType: "1",
  });
  let data: ExpressResponseLike & { error?: unknown };
  try {
    // 장기 캐시는 바깥 unstable_cache가 맡는다. fetch 캐시까지 겹치면 실패 응답(200 + error 봉투)이
    // fetch 층에 남아 재시도가 같은 실패를 되읽는다.
    data = await fetchOdsayJson("searchPubTransPathT", q, { revalidate: false, timeoutMs: PROBE_TIMEOUT_MS });
  } catch (e) {
    throw new ExpressStopsError("transient", e instanceof Error ? e.message : String(e));
  }
  const err = readOdsayError(data.error);
  if (err) {
    throw new ExpressStopsError(err.code === "429" ? "quota" : "rejected", `ODsay 오류 ${err.code} ${err.message}`);
  }
  return data;
}

/** 게이트 스크립트·테스트용 — 캐시 없이 정·역방향 조회. 실패·수락 판정 부재는 `ExpressStopsError` throw. */
export async function fetchExpressStopsUncached(entry: ExpressLineEntry): Promise<string[]> {
  const [forward, reverse] = await Promise.all([
    probe(entry.probe.origin, entry.probe.dest),
    probe(entry.probe.dest, entry.probe.origin),
  ]);
  const stops = extractExpressStops(forward, reverse, entry);
  if (!stops || stops.length === 0) {
    throw new ExpressStopsError("rejected", `급행 정차역 수락 판정 부재(${entry.line})`);
  }
  return stops;
}

function cachedFetcher(entry: ExpressLineEntry): () => Promise<string[]> {
  return unstable_cache(
    () => fetchExpressStopsUncached(entry),
    ["odsay-express-stops", CACHE_CONTRACT, entry.line],
    { revalidate: EXPRESS_STOPS_TTL_SECONDS },
  );
}

function failureKind(e: unknown): ExpressStopsFailure {
  return e instanceof ExpressStopsError ? e.kind : "transient";
}

/**
 * 노선별 집합. 실패는 그 노선만 부재(절대 throw하지 않는다 — 부가 정보가 길찾기 응답을 죽이면 안 된다).
 * 키 없으면 빈 Map(게이트 패턴). `now`는 테스트 주입용.
 */
export async function fetchExpressStopsMap(
  entries: ExpressLineEntry[],
  now: () => number = Date.now,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!env.ODSAY_API_KEY || entries.length === 0) return map;
  await Promise.all(
    entries.map(async (entry) => {
      const failed = lastFailure.get(entry.line);
      if (failed && now() - failed.at < COOLDOWN_MS[failed.kind]) return;
      let pending = inFlight.get(entry.line);
      if (!pending) {
        pending = cachedFetcher(entry)();
        inFlight.set(entry.line, pending);
        pending.finally(() => inFlight.delete(entry.line)).catch(() => {});
      }
      try {
        const stops = await pending;
        lastFailure.delete(entry.line);
        // 캐시가 옛 배포의 값을 돌려줄 가능성까지 막는 마지막 게이트 — 빈 배열은 절대 싣지 않는다.
        if (stops.length > 0) map.set(entry.line, stops);
      } catch (e) {
        lastFailure.set(entry.line, { at: now(), kind: failureKind(e) });
        console.warn(`[odsay] 급행 정차역 집합 부재(${entry.line}):`, e instanceof Error ? e.message : e);
      }
    }),
  );
  return map;
}

/** 테스트용 — 쿨다운·단일 실행 표 초기화. */
export function resetExpressStopsState(): void {
  lastFailure.clear();
  inFlight.clear();
}
