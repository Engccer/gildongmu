import { env } from "../env";
import { normalizeStationName } from "../station-match";
import { parseStationItems } from "./korail-facilities";
import type {
  SeoulMetroFacilities,
  SeoulMetroFacility,
  SeoulMetroFacilityGroup,
  SeoulMetroFacilityKind,
} from "../types";

/**
 * 서울교통공사 교통약자이용정보 provider (data.go.kr B553766/wksn).
 *
 * 실 API 특성 (2026-06-17 실호출 확인):
 * - Base: https://apis.data.go.kr/B553766/wksn, 9 오퍼레이션(시설 종류별).
 * - stnNm은 "포함" 필터라 "강동"이 "강동구청"도 잡는다 → 받은 뒤
 *   normalizeStationName으로 **정확매칭**해 다른 역을 제외한다.
 * - envelope는 data.go.kr 표준(코레일과 동일) → parseStationItems 재사용.
 * - 시설마다 필드가 달라 시설별 정규화 함수로 공통 코어(name/location/
 *   floors/operatingStatus/detail)에 투영한다.
 * - oprtngSitu: 관측값 M(정상)·S(점검·중지)뿐. M만 normal, 그 외 stopped
 *   (과소경고보다 안전). 엘리베이터·에스컬레이터에만 존재.
 * - 인증: DATA_GO_KR_API_KEY(코레일과 동일 키), 개발계정 일 10,000건/오퍼레이션.
 *
 * graceful degrade: 키 없음/전 종류 빈 결과 → null("정보 없음"). 주 fetch
 * 장애는 throw → 라우트 502(미커버 null과 구분, 코레일과 동일 정책).
 */

const BASE = "https://apis.data.go.kr/B553766/wksn";

/** 시설 종류 → 오퍼레이션 경로. */
const OPERATIONS: Record<SeoulMetroFacilityKind, string> = {
  elevator: "getWksnElvtr",
  escalator: "getWksnEsctr",
  wheelchairLift: "getWksnWhcllift",
  movingWalk: "getWksnMvnwlk",
  wheelchairCharger: "getWksnWhclCharge",
  safetyPlatform: "getWksnSafePlfm",
  signLangPhone: "getWksnSlng",
  helper: "getWksnHelper",
  restroom: "getWksnRstrm",
};

type RawItem = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** "지하B3~지하B4" 형태의 층 문자열. 양끝 정보가 없으면 undefined. */
function floorRange(item: RawItem): string | undefined {
  const bg = `${str(item.bgngFlrGrndUdgdSe)}${str(item.bgngFlr)}`.trim();
  const en = `${str(item.endFlrGrndUdgdSe)}${str(item.endFlr)}`.trim();
  if (bg && en) return bg === en ? bg : `${bg}~${en}`;
  return bg || en || undefined;
}

/** oprtngSitu(M/S) → 가동현황. 없으면 undefined. */
function operating(item: RawItem): "normal" | "stopped" | undefined {
  const v = str(item.oprtngSitu);
  if (!v) return undefined;
  return v.toUpperCase() === "M" ? "normal" : "stopped";
}

/** 시설 종류별로 RawItem을 SeoulMetroFacility로 정규화한다. */
function toFacility(kind: SeoulMetroFacilityKind, item: RawItem): SeoulMetroFacility {
  const base: SeoulMetroFacility = {
    name: str(item.fcltNm),
    location: undefined,
    floors: undefined,
    operatingStatus: operating(item),
    detail: undefined,
  };
  switch (kind) {
    case "elevator":
      return { ...base, location: str(item.dtlPstn) || undefined, floors: floorRange(item) };
    case "escalator":
      return {
        ...base,
        // 에스컬레이터는 dtlPstn이 없고 시작/끝 층 위치를 쓴다.
        location:
          str(item.bgngFlrDtlPstn) || str(item.endFlrDtlPstn) || undefined,
        floors: floorRange(item),
        detail: str(item.upbdnbSe) || undefined, // 상/하행
      };
    case "wheelchairCharger":
      return {
        ...base,
        location: str(item.dtlPstn) || undefined,
        floors: str(item.stnFlr) || undefined,
        detail: str(item.cnnctrSe) || undefined, // 커넥터 종류
      };
    case "restroom":
      return {
        ...base,
        location: str(item.dtlPstn) || undefined,
        floors: str(item.stnFlr) || undefined,
        detail:
          [str(item.rstrmInfo), str(item.whlchrAcsPsbltyYn) === "Y" ? "휠체어 접근 가능" : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
      };
    case "safetyPlatform":
      // dtlPstn 없음 — 시설명만.
      return base;
    default:
      // 리프트·무빙워크·수어전화기·도우미: 공통 코어 + dtlPstn(있으면).
      return { ...base, location: str(item.dtlPstn) || undefined };
  }
}

/**
 * 한 시설 종류의 raw 응답을 정규화해 그룹으로. 정확매칭 후 비면 null.
 */
export function parseFacilityGroup(
  kind: SeoulMetroFacilityKind,
  raw: unknown,
  normalizedTarget: string,
): SeoulMetroFacilityGroup | null {
  const items = parseStationItems(raw).filter(
    (it) => normalizeStationName(str(it.stnNm)) === normalizedTarget,
  );
  if (items.length === 0) return null;
  return { kind, facilities: items.map((it) => toFacility(kind, it)) };
}

/**
 * 9종 raw 묶음을 SeoulMetroFacilities로. 데이터 있는 종류만 groups에.
 * 전부 비면 null(미커버 역).
 *
 * line은 **정확매칭된 첫 그룹의 매칭 item**에서 lineNm을 뽑는다 — 포함필터로
 * 섞인 다른 역(강동구청)의 호선이 끼지 않도록 동일한 정확매칭 필터를 다시 건다.
 */
export function parseSeoulMetroFacilities(
  raws: Record<SeoulMetroFacilityKind, unknown>,
  stationName: string,
): SeoulMetroFacilities | null {
  const target = normalizeStationName(stationName);
  if (!target) return null;
  const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
  const groups = kinds
    .map((k) => parseFacilityGroup(k, raws[k], target))
    .filter((g): g is SeoulMetroFacilityGroup => g !== null);
  if (groups.length === 0) return null;
  // 첫 그룹의 raw에서 정확매칭된 첫 항목의 호선 — 다른 역(강동구청) 혼입 방지.
  const firstMatched = parseStationItems(raws[groups[0].kind]).find(
    (it) => normalizeStationName(str(it.stnNm)) === target,
  ) as RawItem | undefined;
  return {
    stationName: stationName.replace(/역$/, ""),
    line: firstMatched ? str(firstMatched.lineNm) || undefined : undefined,
    groups,
  };
}

/** 단일 요청으로 다 받는 상한. 초과하면 페이지 누락이므로 throw로 검증한다. */
const PAGE_SIZE = 300;

/** data.go.kr 표준 envelope에서 totalCount를 안전하게 읽는다(없으면 0). */
function totalCount(raw: unknown): number {
  const tc = (raw as { response?: { body?: { totalCount?: unknown } } })?.response
    ?.body?.totalCount;
  const n = Number(tc);
  return Number.isFinite(n) ? n : 0;
}

async function fetchOp(op: string, stationName: string, key: string): Promise<unknown> {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("stnNm", stationName);
  // 시설 현황은 분 단위로 안 바뀐다 — 하루 캐시로 쿼터를 아낀다(코레일과 동일).
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`서울교통공사 시설 조회 실패: HTTP ${res.status} (${op})`);
  const raw = await res.json();
  // 코레일은 필터 없이 전체(500)를 받지만, 이 provider는 stnNm "포함" 필터라
  // 환승역이 걸리면 totalCount가 커질 수 있다. PAGE_SIZE를 넘으면 뒤 페이지가
  // 조용히 잘리므로(접근성 정본상 silent truncation 금지) throw로 검증한다.
  const tc = totalCount(raw);
  if (tc > PAGE_SIZE) {
    throw new Error(
      `서울교통공사 ${op}: totalCount(${tc}) > numOfRows(${PAGE_SIZE}), 페이지 누락`,
    );
  }
  return raw;
}

/**
 * 역명으로 9종 교통약자 시설을 가져온다. stnNm 포함필터로 서버 1차 축소 후
 * parseSeoulMetroFacilities가 정확매칭한다.
 *
 * - 키 없음 / 전 종류 빈 결과 → null(graceful "정보 없음").
 * - 주 fetch(9 병렬 중 하나라도) HTTP·네트워크 실패 → throw → 라우트 502.
 *   (일시 장애를 "정보 없음"으로 뭉개지 않는다 — 접근성 정본 원칙.)
 */
export async function fetchSeoulMetroFacilities(
  stationName: string,
): Promise<SeoulMetroFacilities | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const target = normalizeStationName(stationName);
  if (!target) return null;
  // 포함필터 정확도를 위해 접미사 제거 전 원문에서 "역"만 떼 서버에 보낸다.
  const query = stationName.replace(/\s*station$/i, "").replace(/역$/, "").trim();
  const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
  const results = await Promise.all(
    kinds.map((k) => fetchOp(OPERATIONS[k], query, key)),
  );
  const raws = Object.fromEntries(
    kinds.map((k, i) => [k, results[i]]),
  ) as Record<SeoulMetroFacilityKind, unknown>;
  return parseSeoulMetroFacilities(raws, stationName);
}
