import { unstable_cache } from "next/cache";
import { env } from "../env";
import { readSeoulOpenJson } from "./seoul-open-json";

/**
 * 서울 실시간 인구 혼잡도 provider — `citydata_ppltn`.
 *
 * **봉투가 또 다르다.** `datagokr-envelope` 공용 파서(`response` 래퍼)와도,
 * 문화행사(`culturalEventInfo.RESULT.CODE` 중첩)와도 다르다:
 *
 *   정상: `{ "SeoulRtd.citydata_ppltn": [ { ... } ] }`   ← RESULT 자체가 없다
 *   오류: `{ "RESULT.CODE": "ERROR-500", "RESULT.MESSAGE": "..." }`
 *                ↑ 점이 들어간 **평면 키**(중첩 객체가 아니다)
 *
 * "봉투가 다르면 파서도 다르다"에 따라 공용 모듈에 넣지 않는다.
 *
 * 영역 판정은 `../congestion-area.ts`(순수)가 하고 여기는 호출만 한다.
 */

const BASE = "http://openapi.seoul.go.kr:8088";
/** 원본 갱신 주기에 맞춘 캐시. 좌표가 아니라 **영역 코드**로 캐시해야
 *  같은 영역 안 여러 좌표가 캐시를 공유한다(일 1,000회를 따릉이·문화행사와
 *  나눠 쓰므로 좌표별 캐시는 쿼터를 태운다). */
const CACHE_TTL_SECONDS = 300;

export interface CongestionForecast {
  /** `"2026-08-01 15:00"` */
  time: string;
  level: string;
}

export interface CongestionReading {
  /** `AREA_CONGEST_LVL` 원문. 4단계(여유·보통·약간 붐빔·붐빔)가 관측됐지만
   *  열거형으로 좁히지 않는다 — 서울시가 단계를 늘리면 조용히 빈 값이 된다. */
  level: string;
  /** `AREA_CONGEST_MSG` 완성 문장. 낭독 정본(재조합 금지). */
  message: string;
  /** `PPLTN_TIME`. 실시간 데이터의 신선도는 행동을 바꾸므로 표기한다. */
  asOf: string;
  /** 12시간 예보. **UI 미표기**, 채팅 도구의 `data`로만 나간다(스펙 §2-6). */
  forecast: CongestionForecast[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * 봉투 해석. 실패(throw)·데이터 없음(null)·정상을 구분한다 — 이 셋을
 * 뭉개면 시각장애 사용자에게 "조회 실패"가 "한산함"으로 낭독된다.
 */
export function parseCongestion(raw: unknown): CongestionReading | null {
  const d = raw as Record<string, unknown> | null | undefined;

  // 코드는 두 자리에 온다(실측): 정상은 `RESULT` **객체 안에** `INFO-000`,
  // 오류는 **최상위 평면 키** `"RESULT.CODE"`. 점이 든 평면 키라 옵셔널
  // 체이닝으로 파고들 수 없어 두 자리를 각각 읽는다. 둘 다 없으면 코드가
  // 없는 것이고, 그때는 아래 배열 검사가 판정한다.
  const nested = d?.RESULT as Record<string, unknown> | undefined;
  const code = str(d?.["RESULT.CODE"]) || str(nested?.["RESULT.CODE"]);
  if (code && code !== "INFO-000") {
    const message = str(d?.["RESULT.MESSAGE"]) || str(nested?.["RESULT.MESSAGE"]);
    throw new Error(`citydata_ppltn ${code}: ${message}`);
  }

  const rows = d?.["SeoulRtd.citydata_ppltn"];
  if (!Array.isArray(rows)) {
    throw new Error("citydata_ppltn 응답 구조 이상(SeoulRtd.citydata_ppltn 배열 아님)");
  }
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const level = str(row.AREA_CONGEST_LVL);
  if (!level) return null;

  const rawForecast = str(row.FCST_YN) === "Y" && Array.isArray(row.FCST_PPLTN)
    ? (row.FCST_PPLTN as Record<string, unknown>[])
    : [];

  return {
    level,
    message: str(row.AREA_CONGEST_MSG),
    asOf: str(row.PPLTN_TIME),
    forecast: rawForecast
      .map((f) => ({ time: str(f.FCST_TIME), level: str(f.FCST_CONGEST_LVL) }))
      .filter((f) => f.time && f.level),
  };
}

/**
 * 한 영역의 실시간 혼잡도 1회 호출. **캐시 밖**이라 테스트가 fetch를 목킹해
 * HTTP 계층 배선(비-JSON 감지가 실제로 걸리는지)을 검증할 수 있다 — `parseCongestion`만
 * fixture로 덮으면 그 앞단이 통째로 비어, 이 함수가 막으려는 회귀가 재발해도 아무도 못 잡는다.
 */
export async function fetchCongestion(areaCode: string): Promise<CongestionReading | null> {
  const key = env.SEOUL_OPEN_DATA_KEY!;
  const res = await fetch(`${BASE}/${key}/json/citydata_ppltn/1/5/${areaCode}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`citydata_ppltn HTTP ${res.status}`);
  return parseCongestion(await readSeoulOpenJson(res, "citydata_ppltn"));
}

/**
 * 영역 코드로 실시간 혼잡도. 키가 없으면 null(호출 0회 — 死기능).
 * `unstable_cache`는 예외를 캐시하지 않으므로 일시 장애가 굳지 않는다.
 */
export function loadCongestion(areaCode: string): Promise<CongestionReading | null> {
  if (!env.SEOUL_OPEN_DATA_KEY) return Promise.resolve(null);
  return unstable_cache(
    () => fetchCongestion(areaCode),
    ["seoul-congestion", areaCode],
    { revalidate: CACHE_TTL_SECONDS },
  )();
}
