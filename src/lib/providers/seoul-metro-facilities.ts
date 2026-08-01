import { env } from "../env";
import {
  normalizeStationName,
  parseStationQuery,
  lineHintMatches,
  stripStationDecorations,
} from "../station-match";
import { fetchDataGoKrJson, readItems, readTotalCount } from "./datagokr-envelope";
import { findVoiceGuides } from "../voice-guides";
import { findStationsByName } from "../subway-stations";
import { fetchSeoulElevators, composeElevatorItems } from "./seoul-elevator";
import { joinText } from "../format";
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
 * - envelope는 data.go.kr 표준(코레일과 동일) → 공용 readItems 재사용.
 * - 시설마다 필드가 달라 시설별 정규화 함수로 공통 코어(name/location/
 *   floors/operatingStatus/detail)에 투영한다.
 * - oprtngSitu: 관측값 M(정상)·S(점검·중지)뿐. M만 normal, 그 외 stopped
 *   (과소경고보다 안전). 엘리베이터·에스컬레이터에만 존재.
 * - 인증: DATA_GO_KR_API_KEY(코레일과 동일 키), 개발계정 일 10,000건/오퍼레이션.
 *
 * graceful degrade: 키 없음/전 종류 빈 결과(보강도 무실패) → null("정보 없음").
 * 주 fetch 장애는 throw → 라우트 502(미커버 null과 구분, 코레일과 동일 정책).
 *
 * Task 7(시설 패널 보강): wksn 주 조회 결과에 두 보강 그룹을 병합한다.
 * - voiceGuide(음성유도기, 정적 seed) — 키 유무와 무관하게 항상 시도.
 * - elevatorLocation(엘리베이터 위치, OA-21212) — wksn에 elevator 그룹이
 *   없을 때만(9호선 등 wksn 미커버 노선 폴백), 방위·거리 텍스트로 합성.
 * 보강 실패(elevatorLocation fetch reject)는 supplementFailed로 표기하고
 * 기존 wksn 그룹은 그대로 보존한다 — 무음 은폐 금지(스펙 §2-C). ⚠ groups가
 * 전멸(base=null+voiceGuide 미커버)이어도 supplementFailed=true면 null을
 * 반환하지 않는다 — "조회 실패"가 "정보 없음"으로 위장되는 것을 막는다.
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
 * lineHint가 있으면 동명이역(다른 노선의 같은 역명)까지 노선으로 좁힌다.
 */
export function parseFacilityGroup(
  kind: SeoulMetroFacilityKind,
  raw: unknown,
  normalizedTarget: string,
  lineHint?: string,
): SeoulMetroFacilityGroup | null {
  const items = readItems(raw).filter(
    (it) =>
      normalizeStationName(str(it.stnNm)) === normalizedTarget &&
      (!lineHint || lineHintMatches(str(it.lineNm), lineHint)),
  );
  if (items.length === 0) return null;
  return { kind, facilities: items.map((it) => toFacility(kind, it)) };
}

/**
 * 9종 raw 묶음을 SeoulMetroFacilities로. 데이터 있는 종류만 groups에.
 * 전부 비면 null(미커버 역).
 *
 * stationName에서 노선 힌트("강동역 5호선"의 "5호선")를 추출해 동명이역을
 * 좁힌다. line은 **정확매칭된 첫 그룹의 매칭 item**에서 lineNm을 뽑는다 —
 * 포함필터로 섞인 다른 역(강동구청)의 호선이 끼지 않도록 동일한 정확매칭
 * 필터를 다시 건다.
 */
export function parseSeoulMetroFacilities(
  raws: Record<SeoulMetroFacilityKind, unknown>,
  stationName: string,
): SeoulMetroFacilities | null {
  const { nameKey: target, lineHint } = parseStationQuery(stationName);
  if (!target) return null;
  const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
  const groups = kinds
    .map((k) => parseFacilityGroup(k, raws[k], target, lineHint))
    .filter((g): g is SeoulMetroFacilityGroup => g !== null);
  if (groups.length === 0) return null;
  // 첫 그룹의 raw에서 정확매칭된 첫 항목의 호선 — 다른 역(강동구청) 혼입 방지.
  // groups는 이 함수 안에서 kinds(wksn 9종)만으로 구성되므로 kind는 항상
  // SeoulMetroFacilityKind다(보강 그룹 voiceGuide/elevatorLocation은 병합
  // 단계(fetchSeoulMetroFacilities)에서만 추가되고 이 함수엔 섞이지 않는다).
  const firstMatched = readItems(raws[groups[0].kind as SeoulMetroFacilityKind]).find(
    (it) =>
      normalizeStationName(str(it.stnNm)) === target &&
      (!lineHint || lineHintMatches(str(it.lineNm), lineHint)),
  ) as RawItem | undefined;
  return {
    stationName: stripStationDecorations(stationName),
    line: firstMatched ? str(firstMatched.lineNm) || undefined : undefined,
    groups,
  };
}

/** 단일 요청으로 다 받는 상한. 초과하면 페이지 누락이므로 throw로 검증한다. */
const PAGE_SIZE = 300;

async function fetchOp(op: string, stationName: string, key: string): Promise<unknown> {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("stnNm", stationName);
  // 시설 현황은 분 단위로 안 바뀐다 — 하루 캐시로 쿼터를 아낀다(코레일과 동일).
  const raw = await fetchDataGoKrJson(url, `서울교통공사 시설 ${op}`, {
    next: { revalidate: 86_400 },
  });
  // 코레일은 필터 없이 전체(500)를 받지만, 이 provider는 stnNm "포함" 필터라
  // 환승역이 걸리면 totalCount가 커질 수 있다. PAGE_SIZE를 넘으면 뒤 페이지가
  // 조용히 잘리므로(접근성 정본상 silent truncation 금지) throw로 검증한다.
  const tc = readTotalCount(raw);
  if (tc > PAGE_SIZE) {
    throw new Error(
      `서울교통공사 ${op}: totalCount(${tc}) > numOfRows(${PAGE_SIZE}), 페이지 누락`,
    );
  }
  return raw;
}

/**
 * 역명으로 교통약자 시설을 가져와 보강 그룹(음성유도기·엘리베이터 위치)까지
 * 병합한다. wksn 9종은 stnNm 포함필터로 서버 1차 축소 후 정확매칭한다.
 *
 * - wksn 키 없음 / 전 종류 빈 결과 → base는 null이지만 보강 그룹만으로도
 *   비-null이 될 수 있다(voiceGuide는 키 무관 — 게이트는 wksn 부분에만).
 * - 주 fetch(9 병렬 중 하나라도) HTTP·네트워크 실패 → throw → 라우트 502.
 *   (일시 장애를 "정보 없음"으로 뭉개지 않는다 — 접근성 정본 원칙.)
 * - 보강(엘리베이터 위치) 실패는 throw하지 않고 supplementFailed로 표기한다
 *   (주 조회는 정상이었으므로 502로 전체를 죽이지 않는다).
 */
export async function fetchSeoulMetroFacilities(
  stationName: string,
): Promise<SeoulMetroFacilities | null> {
  const target = normalizeStationName(stationName);
  if (!target) return null;
  const { lineHint } = parseStationQuery(stationName);

  // 주 조회(wksn)와 보강(엘리베이터 위치)을 분리 — 주 실패는 throw(502) 유지,
  // 보강 실패는 supplementFailed로 표기(무음 은폐 금지, 스펙 §2-C).
  const key = env.DATA_GO_KR_API_KEY;
  let base: SeoulMetroFacilities | null = null;
  if (key) {
    // 포함필터 질의: 괄호·노선 토큰·"역"까지 벗긴 원문형("강동역 5호선"→"강동").
    // 카카오 장소명은 노선 토큰이 붙어 오므로(예: "강동역 5호선") 벗기지 않으면
    // stnNm 포함필터가 아무 것도 매칭하지 못해 섹션이 죽는다.
    const query = stripStationDecorations(stationName);
    const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
    const results = await Promise.all(
      kinds.map((k) => fetchOp(OPERATIONS[k], query, key)),
    );
    const raws = Object.fromEntries(
      kinds.map((k, i) => [k, results[i]]),
    ) as Record<SeoulMetroFacilityKind, unknown>;
    base = parseSeoulMetroFacilities(raws, stationName);
  }

  const groups: SeoulMetroFacilityGroup[] = base ? [...base.groups] : [];

  // 음성유도기(정적 seed — 키 무관·실패 경로 없음).
  const guides = findVoiceGuides(target);
  if (guides.length > 0) {
    // 노선이 여럿(환승역)일 때만 위치 뒤에 호선을 병기해 항목을 구분한다.
    const multiLine = new Set(guides.map((g) => g.line).filter(Boolean)).size > 1;
    groups.push({
      kind: "voiceGuide",
      facilities: guides.map((g) => ({
        name: joinText(g.location, multiLine && g.line ? `${g.line}호선` : ""),
        location: undefined,
        floors: undefined,
        operatingStatus: undefined,
        detail: undefined,
      })),
    });
  }

  // 엘리베이터 위치 폴백(OA-21212) — wksn elevator 그룹이 없을 때만(9호선 등
  // wksn 미커버 노선 보강). 실패해도 기존 그룹은 보존하고 supplementFailed만 표기.
  let supplementFailed = false;
  if (!groups.some((g) => g.kind === "elevator")) {
    const [settled] = await Promise.allSettled([fetchSeoulElevators()]);
    if (settled.status === "fulfilled") {
      const matched = settled.value.filter((e) => e.stationKey === target);
      if (matched.length > 0) {
        const seedRows = findStationsByName(stationName, lineHint);
        const items = composeElevatorItems(matched, seedRows);
        if (items.length > 0) groups.push({ kind: "elevatorLocation", facilities: items });
      }
    } else {
      supplementFailed = true;
    }
  }

  if (groups.length === 0) {
    // 보강 실패 사실만 있고 데이터가 전무해도 실패를 은폐하지 않는다(스펙 §2-C).
    // base=null(wksn 미커버) + voiceGuide 미커버 + 보강(OA-21212) fetch 실패가
    // 겹치면 여기서 그대로 base(null)를 반환해선 안 된다 — "조회 실패"가
    // "정보 없음"으로 위장된다.
    if (supplementFailed) {
      return {
        stationName: stripStationDecorations(stationName) || stationName,
        line: undefined,
        groups: [],
        supplementFailed: true as const,
      };
    }
    return base; // null(전부 없음, 보강도 무실패) 또는 기존 계약 그대로
  }
  return {
    stationName: base?.stationName || stripStationDecorations(stationName) || stationName,
    line: base?.line,
    groups,
    ...(supplementFailed ? { supplementFailed: true as const } : {}),
  };
}
