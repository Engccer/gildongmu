import { env } from "../env";
import type { SubwayArrival, SubwayStationArrivals } from "../types";

/**
 * 서울 지하철 실시간 도착 provider (서울 열린데이터광장 OA-12764, swopenapi).
 *
 * 실 API 특성 (2026-06-17 실호출 확인):
 * - http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/{s}/{e}/{역명}
 *   (http만 제공 — https 미지원).
 * - 키는 SEOUL_SUBWAY_REALTIME_KEY(서울 "실시간 데이터 인증키", 일반키와 별도
 *   계열). 일반키(SEOUL_OPEN_DATA_KEY)로는 ERROR-338. 일 1,000회/키.
 * - **응답 envelope가 정상/에러에서 다름**:
 *   정상      { errorMessage:{ code:"INFO-000", total }, realtimeArrivalList:[...] }
 *   데이터없음 { status:500, code:"INFO-200", message:"해당하는 데이터가 없습니다." }
 *   → 정상은 errorMessage.code(중첩), 에러는 최상위 code(평면). 둘 다에서 읽는다.
 * - INFO-000 파싱 / INFO-200 → null(미커버 역, graceful) / 그 외 코드 → throw.
 *
 * graceful degrade: 키 없음 → null. 실시간이라 캐시하지 않는다(no-store).
 * 서울 도시철도(1~9호선 + 연계)만 커버 — 비서울역·코레일역은 INFO-200 → null.
 * en 로케일의 영문 역명은 swopenapi가 인식 못 해 INFO-200 → 조용히 숨김(한계).
 */

const BASE = "http://swopenapi.seoul.go.kr/api/subway";

/** 한 번에 받을 도착 건수 상한 — 한 역의 상/하행을 합쳐도 충분. */
const ROWS = 20;

/** subwayId(호선 코드) → 노선명. 서울 열린데이터광장 표준 코드. 미매핑은 undefined. */
const SUBWAY_LINES: Record<string, string> = {
  "1001": "1호선",
  "1002": "2호선",
  "1003": "3호선",
  "1004": "4호선",
  "1005": "5호선",
  "1006": "6호선",
  "1007": "7호선",
  "1008": "8호선",
  "1009": "9호선",
  "1032": "GTX-A",
  "1061": "중앙선",
  "1063": "경의중앙선",
  "1065": "공항철도",
  "1067": "경춘선",
  "1075": "수인분당선",
  "1077": "신분당선",
  "1081": "경강선",
  "1092": "우이신설선",
  "1093": "서해선",
  "1094": "신림선",
};

type RawArrival = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** 역명 정규화 — 접미사(역/station) 제거, trim. swopenapi 조회 키이자 표시명. */
function cleanName(name: string): string {
  return name.replace(/\s*station$/i, "").replace(/역$/, "").trim();
}

/** 응답에서 결과 코드를 읽는다 — 정상은 errorMessage.code(중첩), 에러는 최상위 code(평면). */
function resultCode(raw: unknown): string {
  const r = raw as { errorMessage?: { code?: unknown }; code?: unknown };
  return str(r?.errorMessage?.code) || str(r?.code);
}

/** RawArrival 한 건을 SubwayArrival로 정규화. */
function toArrival(item: RawArrival): SubwayArrival {
  const seconds = Number(str(item.barvlDt));
  return {
    line: SUBWAY_LINES[str(item.subwayId)],
    direction: str(item.updnLine),
    trainLineNm: str(item.trainLineNm),
    destination: str(item.bstatnNm),
    message: str(item.arvlMsg2),
    currentLocation: str(item.arvlMsg3) || undefined,
    arrivalSeconds: Number.isFinite(seconds) ? seconds : 0,
    express: /급행/.test(str(item.btrainSttus)),
  };
}

/**
 * 실시간 도착 응답을 정규화한다.
 * - INFO-000 → SubwayStationArrivals(빈 리스트면 arrivals []).
 * - INFO-200(데이터 없음) → null(미커버 역, graceful).
 * - 그 외 코드(인증·쿼터·서버) → throw(일시 장애 ≠ 정보 없음 — 접근성 정본 원칙).
 */
export function parseSubwayArrivals(
  raw: unknown,
  stationName: string,
): SubwayStationArrivals | null {
  const code = resultCode(raw);
  if (code === "INFO-200") return null; // 해당 데이터 없음 — 미커버 역
  if (code !== "INFO-000") {
    throw new Error(`서울 지하철 실시간 도착 오류: ${code || "unknown"}`);
  }
  const list = (raw as { realtimeArrivalList?: unknown }).realtimeArrivalList;
  const items = Array.isArray(list) ? (list as RawArrival[]) : [];
  return {
    stationName: cleanName(stationName),
    arrivals: items.map(toArrival),
  };
}

/**
 * 역명으로 실시간 도착정보를 가져온다.
 * - 키 없음 / 빈 역명 → null(graceful).
 * - INFO-200 → null(미커버 역, 서울 도시철도 외).
 * - HTTP·네트워크·기타 코드 → throw → 라우트 502.
 */
export async function fetchSubwayArrivals(
  stationName: string,
): Promise<SubwayStationArrivals | null> {
  const key = env.SEOUL_SUBWAY_REALTIME_KEY;
  if (!key) return null;
  const query = cleanName(stationName);
  if (!query) return null;
  const url = `${BASE}/${key}/json/realtimeStationArrival/0/${ROWS}/${encodeURIComponent(query)}`;
  // 실시간이라 캐시하지 않는다(초 단위 변동).
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`서울 지하철 실시간 도착 조회 실패: HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseSubwayArrivals(raw, query);
}
