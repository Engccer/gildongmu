"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowUpDown, MapPinPlus } from "lucide-react";
import type {
  CarRouteBriefing,
  Coord,
  JusoAddress,
  Place,
  PlaceSearchResult,
  TransitLeg,
  TransitModeAxis,
  TransitRoute,
  TransitRouteResult as TransitData,
  WalkLineKind,
  WalkRouteLine,
} from "@/lib/types";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import { parseDir, serializeDir, type DirEndpoint } from "@/lib/directions-state";
import {
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS,
  getGeolocationSnapshot,
} from "@/lib/geolocation";
import { awaitEffectiveLocation } from "@/lib/effective-location";
import { staleAgeMessage, staleFixOf, type StaleAgeMessage } from "@/lib/stale-origin";
import { useClockWhile } from "@/hooks/useClockWhile";
import { useCurrentAddress } from "@/hooks/useCurrentAddress";
import { useGeolocation } from "@/hooks/useGeolocation";
import { bilingualName } from "@/lib/bilingual-name";
import { useManualLocation, useManualLocationLabel } from "@/hooks/useManualLocation";
import type { RouteGuideVia } from "@/hooks/useRouteGuide";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { durationToMinutes, formatDistance, joinText, normalizeVoiceQuery } from "@/lib/format";
import { objectParticle } from "@/lib/korean-particle";
import { alternativeName } from "@/lib/transit-alternative-name";
import { shouldCollapseWalk } from "@/lib/walk-collapse";
import { orderDirectionsModes, type DirectionsModeKey } from "@/lib/directions-order";
import { walkRouteUrl } from "@/lib/walk-route-url";
import { walkLineAxis, walkLineNameKey, walkLineStartKey } from "@/lib/walk-line";
import {
  clearRecentEndpoints,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  setRecentEndpointPinned,
  loadRecentRoutes,
  recordRecentRoute,
  removeRecentRoute,
  clearRecentRoutes,
  setRecentRoutePinned,
  type RecentEndpoint,
  type RecentEndpointField,
  type RecentRoute,
} from "@/lib/recent-searches";
import { TransitRouteResult } from "./TransitRouteBriefing";
import { WalkRouteResult } from "./WalkRouteBriefing";
import { CarRouteResult } from "./CarRouteBriefing";
import { carStepItems, walkStepItems } from "@/lib/route-step-items";
import { hasActiveGuideSession, stopActiveGuideSession } from "@/lib/guide-session-store";
import { alightLineText, boardExitAfterWalk, boardExitOnBoardLine } from "@/lib/transit-exit-lines";
import { isUnwinding, publishView, withdrawView } from "@/lib/webmcp/view-registry";
import type {
  DirectionsBridge,
  DirectionsSnapshot,
  ModeOutcomeKind,
  PlanRequest,
  PlanTransitRoute,
  QueryOutcome,
  ToolPlan,
} from "@/lib/webmcp/tools/context";
import { buildRouteRefTable } from "@/lib/webmcp/route-refs";
import { DistanceBeacon } from "./DistanceBeacon";
import { TransitGuidePanel } from "./TransitGuidePanel";
import { buildTransitGuideRoute } from "@/lib/transit-guide";
import { VoiceRecordButton } from "./VoiceRecordButton";
import { KoTail, langFor, useBilingualName } from "./BilingualName";

type ModeKey = DirectionsModeKey;

/** 수단 하나의 조회 결과 3-state: 성공 ≠ 경로 없음 ≠ 오류(게이트 미노출은 렌더 자체가 없음).
    outOfCoverage는 서버 마커 이중 방어용 — origin/dest 중 하나가 한국 밖일 때(주로
    ?dir= 딥링크로 좌표를 직접 조작한 경로)만 도달, 발견 시 폼 전체를 outOfCoverage
    phase로 전환한다(개별 수단 렌더 아님). */
type ModeOutcome =
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "outOfCoverage" }
  /** 경유지 조회의 대중교통(N4): ODsay에 경유지가 없어 호출하지 않는다 — 실패도 경로 없음도 아니다. */
  | { kind: "unsupportedWaypoint" }
  | { kind: "done"; mode: "transit"; result: TransitData }
  /**
   * 도보는 `lines=1`의 줄 목록(E42) — 서버 순서가 화면 순서, 첫 줄이 기본 펼침. 비어 있으면
   * `empty`로 접으므로 done은 1줄 이상이다. 줄들은 **같은 응답에서 온 것만** 그린다(스냅샷 교체).
   */
  | { kind: "done"; mode: "walk"; lines: WalkRouteLine[] }
  | { kind: "done"; mode: "car"; result: CarRouteBriefing };

type QueryResults = {
  /** 조회 시점의 도착 표시명(대중교통 "도착" 문장용), 필드 편집과 무관한 스냅샷 */
  destLabel: string;
  /** 조회 시점의 도착 좌표 스냅샷 — 실시간 안내 진입점의 목적지(렌더 중 ref 접근 금지). */
  destCoord: Coord;
  /**
   * 조회 시점의 출발 좌표 스냅샷 — 수단 재조회(E50)가 **같은 출발지**로 한 번 더 부른다. 현재 위치를
   * 다시 재면 본 조회와 다른 출발지의 경로가 한 목록에 섞이고 캐시 키도 갈린다.
   */
  originCoord: Coord;
  /** 조회 시점의 데이터 언어 — 수단 재조회가 같은 언어로 부른다(한 목록에 두 언어 경로가 섞이지 않게). */
  dataLang: "ko" | "en";
  outcomes: Partial<Record<ModeKey, ModeOutcome>>;
  /** 조회 시점의 경유지 라벨(결과 구획 "경유지 C 도착"용, N4). 없으면 null. */
  viaLabel: string | null;
  /**
   * 조회 시점의 경유지 스냅샷(도보 실시간 안내 입력, N4) — 목적지(`destCoord`)처럼 폼이 아니라 조회 결과에서
   * 읽어, 안내가 화면에 보이는 경로와 같은 경유지를 싣는다. 경유지 칸을 고치면 결과가 폐기되고 세션도 멈춘다.
   */
  via: RouteGuideVia | null;
  /** 표시 순서 스냅샷(spec 2026-08-12 §2) — settled 커밋 시 1회 확정. */
  orderedModes: ModeKey[];
  /**
   * 출발지가 "현재 위치"였을 때 그 좌표의 출처. `from`이 특정 장소면 null(실시간
   * 안내는 항상 실좌표에서 시작하므로 이 브리핑의 출발지 출처와 무관하다).
   * "manual"이면 이 브리핑은 지정 위치 기준이지만, 실시간 안내 시작은 실좌표를
   * 다시 조회한다 — 두 출발지가 달라질 수 있음을 안내 시작 버튼 근처에서 말한다.
   */
  originSource: "gps" | "manual" | "stale" | null;
  /**
   * 현재 위치 끝점이 옛 위치(spec 2026-09-23 stale-origin)로 풀렸으면 조회 시점의 경과 표현.
   * 완료 통지 뒷문장의 재료다 — 문구 키로 굳혀 두어 시계가 흘러도 통지 문장이 바뀌지 않는다
   * (live region 문장이 1분마다 바뀌면 그때마다 다시 낭독된다).
   */
  staleAge: StaleAgeMessage | null;
  /**
   * 세대 토큰(WebMCP spec §3.4) — settled 커밋마다 `p{gen}`. 도구는 이 값으로 옛 결과 참조를
   * `stalePlan`으로 거른다.
   */
  planId: string;
  /**
   * 조회 시점의 출발·도착 입력 라벨(도구 `resolved` — 승격본이 아니라 원명). null = "현재 위치" 끝점이고,
   * 도구 출력 시점의 파생 라벨(`currentLabel`)로 푼다 — 옛 위치 판정·주소 병기는 조회 **안에서** 정해져
   * 조회를 시작한 렌더의 클로저 값에는 아직 없다(stale-origin 설계 리뷰 H4).
   */
  fromLabel: string | null;
  toLabel: string | null;
};

/** 필드 원자 상태: 라벨 텍스트를 편집하면 resolved(좌표 포함)가 즉시 무효화된다. */
type FieldState = {
  text: string;
  resolved: DirEndpoint | null;
};

type Phase =
  | { kind: "idle" }
  | { kind: "needEndpoints" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "geoError" }
  | { kind: "outOfCoverage" }
  | { kind: "settled" };

function endpointToField(ep: DirEndpoint, currentLabel: string): FieldState {
  return {
    text: ep.kind === "current" ? currentLabel : ep.label,
    resolved: ep,
  };
}

/**
 * `?dir=`의 세 번째 토막(경유지, N4)을 렌더 시점에 동기로 읽는다(lazy useState 초기화 —
 * `dir` 동기화 effect가 같은 커밋에서 URL을 다시 쓰기 전에 읽어야 한다).
 * `PlaceSearch`의 `initialFrom/To` 경로를 넓히지 않는 이유: 그 경로는 from·to만 나르고,
 * 경유지는 이 뷰의 관심사라 여기서 닫는다.
 */
function readViaFromUrl(): DirEndpoint | null {
  if (typeof window === "undefined") return null;
  return parseDir(new URLSearchParams(window.location.search).get("dir"))?.via ?? null;
}

/**
 * 목적지 출입구 승격 조회(A11, spec 2026-08-16).
 *
 * 넓은 부지(학교·아파트단지)는 검색이 주는 대표 좌표가 본관이고 도보 경로는 정문에서
 * 끝나, 그 차이가 통째로 종점 오프셋이 되어 도착 판정이 성립하지 않는다(등교 실보행
 * 실측 58.8m → 승격 후 4.5m).
 *
 * ⚠ 실패·시간 초과는 **조용히 null**이다. 승격 부재와 조회 실패는 사용자 행동이 같고
 * (대표 좌표로 안내), 여기서 오류를 말하면 길찾기 자체가 실패한 것으로 들린다. 이 조용함이
 * 정직한 이유는 승격이 한 번 성립하면 그 조회 안에서 되돌아가지 않기 때문이다(§5.1).
 *
 * ⚠ 예산 2초. 대부분의 목적지는 출입구 POI가 없으므로(실측) 이 조회는 **다수 조회에
 * 아무 이득 없이 붙는 지연**이다 — 상한을 짧게 두는 이유다.
 */
async function fetchEntrance(
  name: string,
  dest: Coord,
  origin: Coord,
): Promise<{ name: string; lat: number; lng: number } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2_000);
  try {
    const params = new URLSearchParams({
      name,
      lat: String(dest.lat),
      lng: String(dest.lng),
      fromLat: String(origin.lat),
      fromLng: String(origin.lng),
    });
    const res = await fetch(`/api/places/entrance?${params}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      entrance?: { name: string; lat: number; lng: number } | null;
    };
    return body.entrance ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 수단 1개 조회(순수 fetch 래퍼). 실패는 throw 대신 error 반환으로 뭉쳐
 * Promise.allSettled 소비를 단순화한다. transit·walk는 `{result: X|null}`
 * envelope(null=경로 없음), car는 브리핑 객체 직접 응답(경로 없음 상태 없음).
 */
async function fetchMode(
  mode: ModeKey,
  origin: Coord,
  dest: Coord,
  lang: "ko" | "en",
  signal: AbortSignal,
  /**
   * 경유지(N4). ⚠ 위와 같은 이유로 선택 인자가 아니다 — 빠뜨리면 오류 없이 경유하지
   * 않는 경로가 온다. 대중교통은 경유지가 있으면 호출하지 않는다(ODsay에 경유지 없음).
   */
  via: Coord | null,
): Promise<ModeOutcome> {
  const qs = `origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  const viaQs = via ? `&via=${via.lat},${via.lng}` : "";
  if (mode === "transit" && via) return { kind: "unsupportedWaypoint" };
  if (mode === "car") {
    const res = await fetch(`/api/route/car?${qs}${viaQs}&lang=${lang}`, { signal });
    if (!res.ok) return { kind: "error" };
    const body = await res.json();
    if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
    return { kind: "done", mode, result: body as CarRouteBriefing };
  }
  // 대중교통은 경유 정류장 옵트인(B2 §7) — 실시간 안내(승차·하차 정류소 ID·좌표)의
  // 유일한 데이터원이고, 시작 시 재조회 없이 브리핑과 같은 경로를 안내한다(§2).
  if (mode === "walk") {
    // 도보는 줄 목록을 한 조회로 받는다(`lines=1`, E42). `walkRouteUrl`의 인자(안전 인자 전부
    // required)에 올리지 않고 여기서 덧붙인다 — 조회 화면만 쓰는 단독 옵트인이라 계단 회피·경로
    // 축·기하와 조합하면 서버 400이다(줄 종류가 그 축들을 이미 담는다).
    const res = await fetch(
      `${walkRouteUrl({ origin, dest, accessible: false, includeGeometry: false, via, lang, variant: null })}&lines=1`,
      { signal },
    );
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { lines?: WalkRouteLine[] };
    if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
    // 모르는 종류의 줄은 이름을 붙일 수 없어 뺀다(서버가 종류를 더해도 화면이 거짓 이름을 달지 않는다).
    const lines = (body.lines ?? []).filter((l) => walkLineNameKey(l.kind) !== null);
    return lines.length > 0 ? { kind: "done", mode, lines } : { kind: "empty" };
  }
  const res = await fetch(`/api/route/transit?${qs}&includeStops=1&lang=${lang}`, { signal });
  if (!res.ok) return { kind: "error" };
  const body = (await res.json()) as { result: unknown };
  if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
  if (!body.result) return { kind: "empty" };
  return { kind: "done", mode, result: body.result as TransitData };
}

/** 수단 재조회(E50 판정 2)의 결과. 3-state: 찾음(경로) · 없음 · 실패. */
type TransitRequeryOutcome = { kind: "found"; route: TransitRoute } | { kind: "none" } | { kind: "failed" };

/**
 * 수단 재조회 1회 — 사용자가 버튼을 눌렀을 때만(ODsay는 호출당 과금이라 자동 추가 조회 금지, 위원장 기각).
 * 서버가 그 수단만 타는 경로 중 1순위 하나를 `recommended`로 준다(spec §3.2). 이름은 서버 파라미터가
 * 이미 판정했으므로 그 축을 `highlight`로 싣기만 한다.
 */
async function fetchTransitRequery(
  origin: Coord,
  dest: Coord,
  lang: "ko" | "en",
  axis: TransitModeAxis,
  signal: AbortSignal,
): Promise<TransitRequeryOutcome> {
  const qs = `origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  try {
    const res = await fetch(
      `/api/route/transit?${qs}&includeStops=1&lang=${lang}&pathType=${axis === "busOnly" ? "2" : "1"}`,
      { signal },
    );
    if (!res.ok) return { kind: "failed" };
    const body = (await res.json()) as { result?: TransitData | null };
    const found = body.result?.recommended;
    return found ? { kind: "found", route: { ...found, highlight: [axis] } } : { kind: "none" };
  } catch {
    return { kind: "failed" };
  }
}

/** 재조회 문구 키(축마다 버튼·없음·실패). 동적 키를 한 표에 모아 로케일 누락을 한 곳에서 본다. */
const REQUERY_KEYS: Record<TransitModeAxis, { button: string; none: string; failed: string }> = {
  busOnly: { button: "requeryBusOnly", none: "requeryBusOnlyNone", failed: "requeryBusOnlyFailed" },
  subwayOnly: { button: "requerySubwayOnly", none: "requerySubwayOnlyNone", failed: "requerySubwayOnlyFailed" },
};

/**
 * 길찾기 뷰: 출발지·도착지를 정해 3수단(대중교통·자동차·도보)을 한 번에 비교하는
 * 텍스트 브리핑 화면. 시각장애인 1급 시민 계약:
 * - 결과는 수단별 h3(tabIndex=-1) heading + 기존 결과 렌더 컴포넌트 재사용.
 * - 통지는 폼 근처 단일 polite live region 1개 뿐(수단별 개별 통지 금지, 합산 1문장).
 * - 조회 완료 시 첫 "성공" 수단 heading으로 1회 포커스(성공 0건이면 이동 없음).
 * - 필드 흐름 전진 포커스: 후보 검색 완료 → 첫 후보, 출발지 확정 → 도착지 입력,
 *   도착지 확정 → 조회 버튼(다음 행동이 있는 곳으로 — 스와이프 탐색 왕복 제거).
 * - 조회 버튼은 disabled 금지: aria-disabled + in-flight ref 가드.
 * - `?dir=` 동기화: 확정(resolved) 상태만 직렬화, 현재 위치는 좌표 없는 `cur` 토큰
 *   (프라이버시), 복원 시 재측위.
 */
export function DirectionsView({
  canShowWalk,
  canShowTransit,
  canBriefCarRoute,
  initialFrom,
  initialTo = null,
  prefill = false,
  onBack,
}: {
  canShowWalk: boolean;
  canShowTransit: boolean;
  canBriefCarRoute: boolean;
  initialFrom?: DirEndpoint;
  initialTo?: DirEndpoint | null;
  /**
   * 장소 상세의 "여기까지/여기부터 길찾기"로 들어온 **프리필 진입** 표식(B10).
   * `initialFrom`·`initialTo`는 `?dir=` 복원과 공유하는 prop이라 값만으로는 두
   * 진입을 가를 수 없다 — 이 표식이 있는 진입에서만 마운트 1회 자동 조회가 돈다.
   */
  prefill?: boolean;
  onBack: () => void;
}) {
  const t = useTranslations("directions");
  const tRoute = useTranslations("route");
  const tTransit = useTranslations("route.transit");
  const tPed = useTranslations("route.pedestrian");
  const tCar = useTranslations("route.briefing");
  const tCommon = useTranslations("common");
  const tBeacon = useTranslations("beacon");
  // 출구 문구는 안내 세션·화면 브리핑과 같은 키를 쓴다(E25) — 도구 출력이 화면과 갈리지 않게.
  const tTransitGuide = useTranslations("transitGuide");
  const tManual = useTranslations("manualLocation");
  const locale = useLocale();
  const manual = useManualLocation();
  // 검증 가능/불가 판정은 표시줄과 한 훅을 공유한다(판정선이 갈리면 화면으로 확인 불가).
  const manualLabel = useManualLocationLabel();

  // "현재 위치" 칸의 위치 주장은 공유 위치 스토어에서 **파생**한다 — 신선한 좌표, 옛 위치
  // (spec 2026-09-23 stale-origin), 없음. 칸이 따로 상태를 들면 다른 화면의 측위 성공·실패를
  // 못 따라가 표시줄과 같은 좌표를 반대로 말하고, 늦은 역지오코딩 응답이 신선/옛 판정을 뒤집는다
  // (구현 리뷰 M-1·M-2). 주소는 표시줄과 같은 좌표 키 캐시(`useCurrentAddress`) — 좌표가 다르면
  // 그 주소를 흘리지 않고, 비-ko는 영문·로마자가 1순위다(E28).
  const geo = useGeolocation();
  const liveStale = manual ? null : staleFixOf(geo);
  const currentAddr = useCurrentAddress(
    manual ? null : geo.status === "ready" ? geo.coords : liveStale,
    prefersEnglish(locale) ? "en" : "ko",
  );
  const currentAddress = currentAddr
    ? bilingualName(locale, currentAddr.address, { en: currentAddr.english }).primary
    : null;
  // "현재 위치 사용" 강제 재측위 진행 신호(버튼 라벨 전환용) + 재진입 ref 가드.
  const [refreshingCurrent, setRefreshingCurrent] = useState(false);
  const refreshCurrentRef = useRef(false);
  // 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다(LocationBar와 동형 —
  // GPS가 알아낸 위치와 사용자가 지정한 위치는 다른 것이고 시각장애 사용자는 화면으로
  // 구분할 수 없다). 수동 위치가 이기므로 GPS 역지오코딩 주소는 조회조차 하지 않는다.
  // 옛 위치 표기는 열어 둔 동안 시각을 다시 계산한다(표시줄과 같은 키 — 판정선 하나).
  const now = useClockWhile(liveStale !== null);
  const staleAge = liveStale ? staleAgeMessage(liveStale.at, now) : null;
  const currentLabel =
    manualLabel ??
    (staleAge
      ? currentAddress
        ? tManual("gpsStale", { address: currentAddress, age: tManual(staleAge.key, { count: staleAge.count }) })
        : tManual("gpsStaleNoAddress", { age: tManual(staleAge.key, { count: staleAge.count }) })
      : currentAddress
        ? t("currentLocationNear", { address: currentAddress })
        : t("currentLocation"));
  const [fromField, setFromField] = useState<FieldState>(() =>
    endpointToField(initialFrom ?? { kind: "current" }, currentLabel),
  );
  const [toField, setToField] = useState<FieldState>(() =>
    initialTo
      ? endpointToField(initialTo, currentLabel)
      : { text: "", resolved: null },
  );
  // 경유지 필드(N4): null = 접힘("경유지 추가" 버튼만). ?dir= 세 번째 토막이 있으면 펼친 채 복원.
  const [viaField, setViaField] = useState<FieldState | null>(() => {
    const via = readViaFromUrl();
    return via ? endpointToField(via, currentLabel) : null;
  });
  const viaInputRef = useRef<HTMLInputElement | null>(null);
  const [recentVia, setRecentVia] = useState<RecentEndpoint[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [results, setResults] = useState<QueryResults | null>(null);
  // 대중교통 경로 disclosure(W3C APG)의 펼침 상태. 키는 배열 인덱스도 표시
  // 번호도 아닌 `routeKey`다. 표시 번호는 축 라벨이 붙은 대안을 건너뛰므로
  // 인덱스와 다른 좌표계이고, 인덱스는 순서가 바뀌면 다른 경로를 가리킨다(§4.2).
  // ⚠ 담기는 것은 "펼쳐진 것"이 아니라 **"기본값에서 뒤집힌 것"**이다 — 추천은
  // 기본 펼침, 대안은 기본 접힘이라 한 집합으로 둘을 다루려면 이 의미여야 한다.
  // 새 조회 결과는 다른 경로들인데, 비워 두면 그대로 각자의 기본 상태가 된다.
  const [toggledRoutes, setToggledRoutes] = useState<Set<string>>(new Set());
  // 안내 세션이 살아 있는 경로의 routeKey(M5 선행분). 세션 중 disclosure가 접혀
  // 패널이 unmount되면 세션이 조용히 죽으므로, 활성 경로는 강제 펼침 유지.
  const [activeGuideAlt, setActiveGuideAlt] = useState<string | null>(null);
  /**
   * 수단 재조회 상태(E50 §4.3). 조회 세대(`planId`)에 귀속된다 — 새 조회가 오면 옛 세대의 결과를 쓰지
   * 않는다(키가 다르면 없는 것으로 읽는다). `loading`은 버튼 `aria-disabled`, 나머지는 3-state 결과다.
   */
  const [requery, setRequery] = useState<{
    planId: string;
    byAxis: Partial<Record<TransitModeAxis, TransitRequeryOutcome | { kind: "loading" }>>;
  } | null>(null);
  /**
   * 세대·축별 in-flight 가드(`${planId}:${axis}` — 더블 탭 중복 호출 차단, 호출당 과금이라 클로저 가드만으론
   * 부족하다). ⚠ 축만 키로 쓰면 옛 세대 요청이 살아 있는 동안 새 조회의 같은 버튼이 조용히 무시된다.
   */
  const requeryInFlight = useRef(new Set<string>());
  /**
   * 재조회가 끝난 뒤 포커스를 옮길 요소 id와, 그 이동의 조건이 되는 버튼 id(커밋 뒤 effect가 소비한다 — 결과
   * 요소는 그 커밋에서 생긴다). 포커스가 아직 그 버튼에 있었을 때만 옮긴다 — 기다리는 사이 사용자가 다른 곳을
   * 듣고 있으면 옮기는 것은 이득 없이 탐색만 끊는다(헌장 §5 ⓑ는 "쥔 요소가 사라질 때"의 규칙).
   */
  const requeryFocusRef = useRef<{ target: string; button: string } | null>(null);
  const requeryIdPrefix = useId();
  /** 지금 화면 결과의 세대(비동기 재조회가 끝났을 때 옛 세대인지 가른다 — 클로저의 `results`는 낡는다). */
  const planIdRef = useRef<string | null>(null);
  useEffect(() => {
    planIdRef.current = results?.planId ?? null;
  }, [results]);
  // 언마운트 뒤 끝난 재조회는 어떤 세대에도 속하지 않는다(통지·상태 커밋 없음).
  useEffect(() => () => {
    planIdRef.current = null;
  }, []);
  useEffect(() => {
    const pending = requeryFocusRef.current;
    if (!pending) return;
    requeryFocusRef.current = null;
    // 버튼이 사라지면 포커스는 body로 떨어진다 — 그 경우와 버튼이 아직 쥔 경우만 결과로 옮긴다.
    const active = document.activeElement;
    if (active && active !== document.body && active.id !== pending.button) return;
    document.getElementById(pending.target)?.focus();
  }, [requery]);
  function routeExpanded(routeKey: string, defaultExpanded: boolean) {
    return toggledRoutes.has(routeKey) ? !defaultExpanded : defaultExpanded;
  }
  function toggleRoute(routeKey: string) {
    // 세션 활성 경로의 접힘 클릭은 기록하지 않는다(감사 HIGH): 뒤집어 두면
    // 세션 종료 순간 뒤늦게 접히며 패널(live region·트리거)이 unmount돼 중지
    // 통지가 무발화되고 포커스가 body로 이탈한다. 무시하면 종료 후에도 펼침이
    // 유지돼 통지·트리거 복귀 포커스가 모두 산다(접기는 종료 후 다시 누르면 됨).
    if (routeKey === activeGuideAlt) return;
    setToggledRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeKey)) next.delete(routeKey);
      else next.add(routeKey);
      return next;
    });
  }
  /**
   * 도보 첫 줄 펼침 상태. null = 자동(장거리 접힘 문턱 판정), boolean = 사용자 조작.
   * 사용자 조작이 자동 판정을 이긴다.
   */
  const [walkExpanded, setWalkExpanded] = useState<boolean | null>(null);
  // 둘째 줄 펼침(E42). 기본 접힘이라 null 3-state가 필요 없고, 리셋은 walkExpanded와
  // 같은 자리(resetWalkExpansion)에서 함께 — 스냅샷 교체 시 이전 세대의 펼침이 남지 않게.
  const [walkSecondExpanded, setWalkSecondExpanded] = useState(false);
  /**
   * 안내 세션이 살아 있는 도보 줄(대중교통 `activeGuideAlt` 동형). 안내 시작 버튼이 줄 **안**에
   * 있어 그 줄을 접으면 패널이 unmount되며 세션이 조용히 죽는다 — 활성 줄은 강제 펼침.
   */
  const [activeWalkLine, setActiveWalkLine] = useState<WalkLineKind | null>(null);
  /** 결과 폐기·새 조회 시 도보 両줄 펼침을 함께 되돌린다(한쪽만 되돌리면 다음 세대 둘째 줄이 펼쳐진 채 나온다). */
  function resetWalkExpansion() {
    setWalkExpanded(null);
    setWalkSecondExpanded(false);
  }
  /** 결과 폐기 한 곳(편집·스왑·경유지 조작·새 조회 공용). */
  function discardResults() {
    setResults(null);
    setToggledRoutes(new Set());
    setActiveGuideAlt(null);
    setActiveWalkLine(null);
    resetWalkExpansion();
  }
  /**
   * **이 뷰의 단일 polite 창구**(A40). 게시자는 셋 — 폼 보조 통지(후보 수·최근 장소
   * 조작·안내 중지), 조회 국면 파생 문구(`phaseMessage`), 그리고 화면 아래 실시간 안내
   * 세션(대중교통 패널·거리 비콘)이다. 종전엔 세 번째 게시자가 **자기 region을 따로**
   * 들고 있었는데, 그 채널은 폴 타이머가 돌리고 이 채널은 사용자 조작이 돌려서 둘이
   * 겹치면 한쪽이 잘리거나 순서가 뒤집힌다(같은 경합의 실측 기록 = `PlaceSearch`의
   * `useHeldValue` 주석). 채널을 나누는 것은 직렬화가 아니라 경합의 원인이다.
   *
   * `seq`는 **같은 문장 재게시**용이다 — 문자열이 같으면 DOM이 안 바뀌어 aria-live가
   * 침묵하므로(React 동일 값 bail out), 텍스트 노드를 key로 갈아 끼워 "추가"로 낸다.
   * 그래서 훅들의 `"" → 같은 문장` 되돌림 우회는 이 층에선 불필요하다(비어 있는 게시는
   * "말할 것이 없다"이므로 게시자에서 걸러 내보낸다).
   *
   * 우선순위는 종전과 같다: 최근 게시 1건이 `phaseMessage`를 덮고, 빈 게시가 그것을 푼다.
   */
  const [live, setLive] = useState<{ text: string; lang?: "ko"; seq: number }>({
    text: "",
    seq: 0,
  });
  /**
   * 한 사건에 문장이 둘인 유일한 자리(안내 시작 = 세션 시작 문장 + 수동 위치 고지)를
   * **한 문장으로 합치기 위한 대기 꼬리**. 창구가 하나면 나중 게시가 앞 게시를 덮으므로,
   * 고지를 따로 게시하지 않고 바로 다음 게시에 공백으로 이어 붙인다(§12.3 완성 문장
   * 공백 연결). 한 커밋 안에서만 살아 있다.
   */
  const pendingSuffixRef = useRef("");
  const announce = useCallback((text: string, lang?: "ko") => {
    if (!text) {
      pendingSuffixRef.current = "";
      setLive((prev) => (prev.text ? { text: "", seq: prev.seq + 1 } : prev));
      return;
    }
    const suffix = pendingSuffixRef.current;
    pendingSuffixRef.current = "";
    setLive((prev) => ({
      text: suffix ? `${text} ${suffix}` : text,
      lang,
      seq: prev.seq + 1,
    }));
  }, []);


  // 최근 장소(스펙 2026-07-26) — 출발지·도착지 **분리** 목록(위원장 지시 2026-07-26:
  // 출발지에서 검색한 곳이 도착지 기록에 뜨는 공유 목록 폐기). 마운트 후 로드(SSR 가드).
  const [recentFrom, setRecentFrom] = useState<RecentEndpoint[]>([]);
  const [recentTo, setRecentTo] = useState<RecentEndpoint[]>([]);
  const tRecent = useTranslations("recent");
  const setRecentFor = (field: RecentEndpointField) =>
    field === "from" ? setRecentFrom : setRecentTo;

  // 최근 경로(스펙 2026-08-10): 출발·도착 쌍. 결과 없는 화면에서만 노출.
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const tRecentRoutes = useTranslations("recentRoutes");
  const visibleRecentRoutes = recentRoutes.slice(0, 5); // 웹 최근 목록 관례(상위 5)
  const routeDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const routeFocusIndexRef = useRef<number | null>(null);
  const [routeRevision, setRouteRevision] = useState(0);
  useEffect(() => {
    const idx = routeFocusIndexRef.current;
    if (idx === null) return;
    routeFocusIndexRef.current = null;
    routeDeleteRefs.current[idx]?.focus();
  }, [routeRevision]);

  useEffect(() => {
    // react-hooks/set-state-in-effect 회피: 동기 setState 대신 콜백으로 한 틱 미룬다
    // (PlaceSearch 최근 검색 로드 effect와 동형).
    queueMicrotask(() => {
      setRecentFrom(loadRecentEndpoints("from"));
      setRecentTo(loadRecentEndpoints("to"));
      setRecentVia(loadRecentEndpoints("via"));
      setRecentRoutes(loadRecentRoutes());
    });
  }, []);

  // 프리필 끝점(장소 상세 "여기까지/여기부터 길찾기")도 확정 경로와 동일하게 그
  // 필드의 스코프에 기록(마운트 1회) — 기록하지 않으면 같은 장소를 그 자리에 다시
  // 넣을 때 검색부터 해야 한다. ?dir= 복원의 재기록은 dedupe 끌어올림이라 무해.
  const recordedInitialRef = useRef(false);
  useEffect(() => {
    if (recordedInitialRef.current) return;
    recordedInitialRef.current = true;
    for (const [field, ep] of [
      ["from", initialFrom],
      ["to", initialTo],
    ] as const) {
      if (ep?.kind !== "place") continue;
      const place = ep;
      queueMicrotask(() =>
        setRecentFor(field)(
          recordRecentEndpoint(field, {
            label: place.label,
            lat: place.coord.lat,
            lng: place.coord.lng,
          }),
        ),
      );
    }
  }, [initialFrom, initialTo]);

  /** endpoint 확정 공용 기록 지점(현재 위치 제외 — kind:"place"만). 필드별 분리 기록. */
  function recordResolved(field: RecentEndpointField, ep: DirEndpoint) {
    if (ep.kind === "place")
      setRecentFor(field)(
        recordRecentEndpoint(field, {
          label: ep.label,
          lat: ep.coord.lat,
          lng: ep.coord.lng,
        }),
      );
  }

  const titleRef = useRef<HTMLHeadingElement>(null);
  // 사용 흐름 전진 포커스: 출발지 확정 → 도착지 입력, 도착지 확정 → 조회 버튼.
  const toInputRef = useRef<HTMLInputElement | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  /** 결과 영역(수단 섹션 전부) — 도구 조회가 폐기하기 전 포커스 선점 판정용. */
  const resultsRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const genRef = useRef(0);
  /**
   * WebMCP 세대 결박 대기자(spec §3.4·§8.3) — 단일 슬롯. 도구가 시작한 조회의 세대에 결박되고
   * 그 세대의 종단 phase 전이에서만 resolve된다. 다른 세대의 조회 시작은 `superseded`,
   * 언마운트·실행 signal은 `aborted`.
   */
  const queryWaiterRef = useRef<{ gen: number; resolve: (o: QueryOutcome) => void } | null>(null);
  function settleWaiter(gen: number, outcome: QueryOutcome) {
    const w = queryWaiterRef.current;
    if (!w || w.gen !== gen) return;
    queryWaiterRef.current = null;
    w.resolve(outcome);
  }
  /**
   * 종단 phase(settled·geoError·outOfCoverage)는 **커밋 뒤에** resolve한다(spec §3.4 "useEffect가
   * 슬롯을 본다"): 동기로 풀면 도구가 아직 렌더되지 않은 옛 화면(`results` null)을 읽어 `superseded`로
   * 오판한다. 슬롯에 적어 두고 아래 effect(브리지 갱신 effect **뒤**에 선언)가 푼다.
   */
  const pendingOutcomeRef = useRef<{ gen: number; outcome: QueryOutcome } | null>(null);
  function settleAfterCommit(gen: number, outcome: QueryOutcome) {
    if (queryWaiterRef.current?.gen !== gen) return;
    pendingOutcomeRef.current = { gen, outcome };
  }
  /** 새 세대가 시작될 때 앞 세대에 결박된 대기자를 `superseded`로 끝낸다(사용자를 막지 않는다). */
  function supersedeWaiter(newGen: number) {
    const w = queryWaiterRef.current;
    if (!w || w.gen === newGen) return;
    queryWaiterRef.current = null;
    w.resolve({ kind: "superseded" });
  }
  useEffect(() => {
    return () => {
      const w = queryWaiterRef.current;
      queryWaiterRef.current = null;
      w?.resolve({ kind: "aborted" });
    };
  }, []);
  const transitHeadingRef = useRef<HTMLHeadingElement>(null);
  const walkHeadingRef = useRef<HTMLHeadingElement>(null);
  const carHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingRefs = {
    transit: transitHeadingRef,
    walk: walkHeadingRef,
    car: carHeadingRef,
  } as const;

  /**
   * 프리필 진입이 마운트에서 할 일(B10·E32). **첫 렌더 값으로 굳힌다** — 이후
   * 사용자가 필드를 고쳐도 다시 판정하지 않는다(1회 소비, iOS
   * `runPrefillQueryIfPending`과 같은 계약).
   * - `query`: 양끝이 다 있다("여기까지 길찾기" — 출발지는 기본값 현재 위치).
   * - `landOnTo`: 출발지만 채웠다("여기부터 길찾기") → 조회하지 않고 다음 행동인
   *   도착지 입력에 착지한다.
   */
  const prefillActionRef = useRef<"query" | "landOnTo" | null>(
    prefill ? (initialTo ? "query" : "landOnTo") : null,
  );

  // 뷰 진입 시 제목으로 포커스(장소 상세와 동형), 새 화면 맥락 통지.
  useEffect(() => {
    // 도구 언와인드 중의 재마운트(앞으로가기 복원 등)는 착지하지 않는다(spec §6.1).
    if (isUnwinding()) return;
    if (prefillActionRef.current === "landOnTo") toInputRef.current?.focus();
    else titleRef.current?.focus();
  }, []);

  // 프리필 진입 자동 조회(B10): 장소 상세의 "여기까지 길찾기"는 도착지 채움과
  // 조회가 한 동작이다(iOS 2026-09-03 선행). ⚠ `?dir=` 복원(새로고침·URL 직진입·
  // 앞으로가기)에는 `prefill` 표식이 없어 여기 걸리지 않는다 — 걸리면 URL을 여는
  // 것만으로 측위 팝업이 뜬다. 조회는 화면 정본 트랜잭션 `runQuery`를 그대로 지나
  // 세대(`genRef`)를 발급하므로 WebMCP 대기자 계약도 어기지 않는다.
  useEffect(() => {
    if (prefillActionRef.current !== "query") return;
    // 착지 억제와 같은 가드를 받는다(위 effect와 짝) — 조회가 성공하면 종단에서
    // 첫 성공 수단 heading으로 포커스가 가므로, 언와인드 중에 돌면 "도구는 착지를
    // 옮기지 않는다"(spec §6.1)가 제목에서만 지켜지고 결과에서 깨진다.
    if (isUnwinding()) return;
    void runQuery();
    // 첫 렌더의 필드 스냅샷(= initialFrom·initialTo)으로 도는 마운트 1회 조회다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 게이트 통과 수단만 — **조회 대상 결정 전용**(E11부터 표시 순서는
  // results.orderedModes가 정본이고, 이 배열 순서는 각 군 안의 타이브레이커로만
  // 쓰인다). 도보의 ko 전용 게이트는 E16 축3으로 사라졌다 — 서버가 Tmap 구조화
  // 필드에서 en 문장을 만든다. 로케일별 키 게이트는 `canShowWalk`가 이미 든다
  // (`hasWalkRouteKeyFor` — en은 Tmap 단독).
  const activeModes: ModeKey[] = [
    ...(canShowTransit ? (["transit"] as const) : []),
    ...(canBriefCarRoute ? (["car"] as const) : []),
    ...(canShowWalk ? (["walk"] as const) : []),
  ];

  // `?dir=` 동기화: 확정(resolved) 필드만 직렬화한다. 편집 중(coord 무효) 상태는
  // URL에 싣지 않고 마지막 확정 상태를 유지한다. replaceState라 히스토리 스택은
  // 늘지 않고, 뒤로가기 시 브라우저가 이전 엔트리의 URL(dir 없음)을 복원한다.
  useEffect(() => {
    const from = fromField.resolved;
    if (!from) return;
    const url = new URL(window.location.href);
    url.searchParams.set("dir", serializeDir(from, toField.resolved, viaField?.resolved));
    window.history.replaceState(window.history.state, "", url);
    // LanguageSwitcher가 쿼리 변경을 href에 반영하도록 통지(?q= 동기화와 동형).
    window.dispatchEvent(new Event("gildongmu:locationchange"));
  }, [fromField.resolved, toField.resolved, viaField?.resolved]);

  // 현재 위치 필드의 표시 텍스트는 확정 시점 스냅샷이 아니라 파생 라벨을 쓴다
  // (주소 병기·새로고침이 라벨에 즉시 반영, 편집 시작 시엔 resolved가 풀려 원문 유지).
  const displayField = (field: FieldState): FieldState =>
    field.resolved?.kind === "current" ? { ...field, text: currentLabel } : field;

  /**
   * "현재 위치" 재선택(F-B) = 강제 재측위. 갱신 신호는 라벨(주소)의 변화 자체이고 진행
   * 신호는 해당 버튼의 라벨 전환뿐(별도 통지 중복 금지). 라벨은 스토어에서 파생되므로
   * 성공이면 새 주소, 취득 실패면 옛 위치, 권한 거부면 "현재 위치"로 스스로 바뀐다.
   */
  async function selectCurrentFrom() {
    setFromField(endpointToField({ kind: "current" }, currentLabel));
    if (refreshCurrentRef.current) return;
    refreshCurrentRef.current = true;
    setRefreshingCurrent(true);
    try {
      // force:true는 수동 위치가 있어도 판정을 동반한다(이동했으면 GPS로 복귀).
      await awaitEffectiveLocation({ force: true });
    } finally {
      refreshCurrentRef.current = false;
      setRefreshingCurrent(false);
    }
  }

  function swapFields() {
    // 패널 언마운트 전 활성 안내 세션 명시 중지 + 중지 통지(a11y 감사 HIGH —
    // 언마운트 정리는 톤·통지 없이 자원만 회수해 "살아 있다고 믿는 안내"가 남는다).
    const stopped = stopActiveGuideSession();
    setFromField(toField);
    setToField(fromField);
    discardResults();
    announce(stopped ? tBeacon("stopped") : "");
  }

  /**
   * 조회 트랜잭션(WebMCP spec §3.4 "runQuery(request)"). `request`는 **완전한 요청 스냅샷**
   * (출발·도착·경유지)이고, 최근 경로 활성화·도구 호출이 쓴다 — setFromField/setToField의
   * setState는 비동기라 같은 틱에 이어지는 조회가 옛 `fromField.resolved`를 읽으므로,
   * 확정할 endpoint를 직접 넘겨 그 경합을 우회한다. 조회 버튼 클릭은 인자 없이 호출한다
   * (기존 필드 상태 그대로). 필드 상태 갱신과 조회 시작은 호출자가 같은 틱에 한다.
   */
  async function runQuery(request?: { from: DirEndpoint; to: DirEndpoint; via: DirEndpoint | null }) {
    if (inFlight.current) return;
    const from = request ? request.from : fromField.resolved;
    const to = request ? request.to : toField.resolved;
    // 경유지 필드가 펼쳐져 있는데 미확정(텍스트만)이면 도착지 미확정과 같은 통지다 —
    // 반쯤 적힌 경유지를 조용히 버리고 조회하지 않는다(N4 spec §3).
    const viaEp = request ? request.via : viaField?.resolved ?? null;
    const viaPending = !request && viaField !== null && !viaField.resolved;
    announce("");
    if (!from || !to || viaPending) {
      setPhase({ kind: "needEndpoints" });
      return;
    }
    // 경유지는 장소만(현재 위치 불가 — parseDir·폼이 막지만 타입상 좁힌다).
    const via: Coord | null = viaEp?.kind === "place" ? viaEp.coord : null;
    const viaLabel = viaEp?.kind === "place" ? viaEp.label : null;
    inFlight.current = true;
    const myGen = ++genRef.current;
    supersedeWaiter(myGen);
    try {
      // 재조회는 패널을 언마운트시키므로 활성 세션을 먼저 명시 중지·통지한다
      // (a11y 감사 HIGH). 이후 종단 phase 통지 시점에 notice를 비워 경합을 푼다.
      const stoppedGuide = stopActiveGuideSession();
      if (stoppedGuide) announce(tBeacon("stopped"));
      // 새 조회는 도보 접힘을 자동 판정으로 되돌린다(전이표 §4.4). 사용자가
      // 펼쳐 둔 것은 그 경로에 대한 조작이지 다음 경로에 대한 조작이 아니다.
      discardResults();
      // 현재 위치 endpoint는 조회 시점마다 공유 스토어로 측위한다(권한 팝업 세션 1회).
      // 캐시를 재사용하되 **나이 상한**을 건다(A7) — 이 스토어에는 TTL이 없어서 앱을
      // 켜고 처음 잰 좌표가 세션 내내 출발지가 되고, 그 좌표는 경로 origin이자 네이티브
      // 지도 앱 딥링크 출발지로 그대로 나간다. 이동한 뒤 조회하면 오류도 빈 결과도 아닌
      // **옛 자리에서 출발하는 그럴듯한 경로**가 오므로 실패가 보이지 않는다.
      // `?dir=` 복원 경로도 같은 재측위를 탄다.
      let cur: Coord | null = null;
      // "from"이 "현재 위치"였을 때 그 좌표의 출처(gps·manual). 안내 시작 순간
      // "현재 위치에서 시작한다"를 알려야 할지 판단하는 근거
      // (`announceGuideStart`). 도착지만 현재 위치인 조회는 대상이 아니다 — 안내
      // 출발지는 그때도 실좌표라 화면과 어긋나는 것이 없다.
      let originSource: "gps" | "manual" | "stale" | null = null;
      // 현재 위치 끝점이 옛 위치로 풀렸으면 그 시점의 경과 표현(완료 통지 뒷문장).
      let staleAgeAtQuery: StaleAgeMessage | null = null;
      if (from.kind === "current" || to.kind === "current") {
        setPhase({ kind: "locating" });
        const acquired = await awaitEffectiveLocation({
          force: false,
          maxAgeSeconds: DIRECTIONS_ORIGIN_MAX_AGE_SECONDS,
        });
        if (myGen !== genRef.current) return;
        // 재측위가 취득 실패로 끝났고 직전 좌표가 있으면 그 옛 위치로 계속한다(위원장 판정
        // 2026-09-23). `acquired`가 null이면 수동 위치도 없다(있으면 그것이 답이다).
        const stale = acquired ? null : staleFixOf(getGeolocationSnapshot());
        const effective: { lat: number; lng: number; source: "gps" | "manual" | "stale" } | null =
          acquired ?? (stale ? { lat: stale.lat, lng: stale.lng, source: "stale" } : null);
        if (stale) staleAgeAtQuery = staleAgeMessage(stale.at, Date.now());
        if (!effective) {
          announce(""); // 중지 통지가 종단 phase 통지를 가리지 않게
          setPhase({ kind: "geoError" });
          // 도구 대기자에게는 사유를 세분해 준다(스토어가 `denied`에 남긴 부가 필드).
          const geo = getGeolocationSnapshot();
          settleAfterCommit(myGen, {
            kind: "geoError",
            reason: geo.status === "denied" ? (geo.reason ?? "unavailable") : "unavailable",
          });
          return;
        }
        // cur 토큰 해석 시점 선분기 — 현재 위치가 한국 밖이면 조회 자체를 중단한다
        // (수단별 fetch를 하나도 쏘지 않음). 오류가 아니라 커버리지 안내이므로
        // 일반 phase로 표기. 수동 위치도 같은 판정을 받는다(해외 지정도 정직하게).
        if (!isInKorea(effective.lat, effective.lng)) {
          announce("");
          setPhase({ kind: "outOfCoverage" });
          settleAfterCommit(myGen, { kind: "outOfCoverage" });
          return;
        }
        cur = { lat: effective.lat, lng: effective.lng };
        if (from.kind === "current") originSource = effective.source;
      }
      const origin = from.kind === "current" ? (cur as Coord) : from.coord;
      let dest = to.kind === "current" ? (cur as Coord) : to.coord;
      let destLabel = to.kind === "current" ? currentLabel : to.label;
      // A11 출입구 승격 — 이름 있는 장소 목적지에만, ko 데이터 로케일에서만
      // (도보 경로 자체가 ko 전용이고 카카오 출입구 이름은 한국어 고유명사다).
      // 승격본은 여기서 확정되어 전 수단 조회·안내 세션·계단 회피 재조회가 **같은
      // 목적지**를 쓰게 한다(§5.1 — 조회마다 다른 목적지를 갖지 않는다).
      // ⚠ 승격 조회 **전에** loading으로 넘긴다. 이 왕복(최대 2초)도 이 조회의 일부라
      // 그 사이 화면이 직전 phase에 머물면 결과는 이미 비웠는데 상태 줄만 빈 채로
      // 남는다(장소→장소 조회에서 settled가 남아 있는 창).
      setPhase({ kind: "loading" });
      if (to.kind === "place" && dataLocale(locale) === "ko") {
        const entrance = await fetchEntrance(to.label, dest, origin);
        if (myGen !== genRef.current) return;
        if (entrance) {
          dest = { lat: entrance.lat, lng: entrance.lng };
          destLabel = entrance.name;
        }
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled(
        activeModes.map((m) =>
          fetchMode(m, origin, dest, dataLocale(locale), ctrl.signal, via),
        ),
      );
      clearTimeout(timer);
      if (myGen !== genRef.current) return;

      const outcomes: Partial<Record<ModeKey, ModeOutcome>> = {};
      activeModes.forEach((m, i) => {
        const s = settled[i];
        outcomes[m] = s.status === "fulfilled" ? s.value : { kind: "error" };
      });
      // 서버 마커 이중 방어 — "cur" 선분기를 통과했어도 place 종단점(검색 선택 또는
      // ?dir= 딥링크로 직접 조작된 좌표)이 한국 밖일 수 있다. 한 수단이라도 감지하면
      // 나머지 수단 결과를 버리고 폼 전체를 outOfCoverage로 전환한다.
      if (activeModes.some((m) => outcomes[m]?.kind === "outOfCoverage")) {
        announce("");
        setPhase({ kind: "outOfCoverage" });
        settleAfterCommit(myGen, { kind: "outOfCoverage" });
        return;
      }
      const walkOutcome = outcomes.walk;
      const orderedModes = orderDirectionsModes(
        activeModes,
        Object.fromEntries(
          activeModes.map((m) => [m, outcomes[m]?.kind === "done"]),
        ),
        walkOutcome?.kind === "done" && walkOutcome.mode === "walk"
          ? walkOutcome.lines[0].route.durationSeconds
          : null,
      );
      const planId = `p${myGen}`;
      setResults({
        destLabel,
        destCoord: dest,
        originCoord: origin,
        dataLang: dataLocale(locale),
        outcomes,
        viaLabel,
        via: via && viaLabel !== null ? { lat: via.lat, lng: via.lng, label: viaLabel } : null,
        orderedModes,
        originSource,
        staleAge: staleAgeAtQuery,
        planId,
        fromLabel: from.kind === "current" ? null : from.label,
        toLabel: to.kind === "current" ? null : to.label,
      });
      announce(""); // 중지 통지 해제 — settled 합산 통지가 이 커밋에서 발화된다
      setPhase({ kind: "settled" });
      settleAfterCommit(myGen, { kind: "settled", planId });
      // 최근 경로 기록(스펙 §1.2): settled 도달 시 1곳. 실패 phase·outOfCoverage·취소 경로는
      // 여기 도달하지 않아 자연 배제된다. current는 null 투영(실좌표를 굳히지 않는다).
      setRecentRoutes(
        recordRecentRoute({
          from: from.kind === "current" ? null : { label: from.label, lat: from.coord.lat, lng: from.coord.lng },
          to: to.kind === "current" ? null : { label: to.label, lat: to.coord.lat, lng: to.coord.lng },
          ...(viaEp?.kind === "place"
            ? { via: { label: viaEp.label, lat: viaEp.coord.lat, lng: viaEp.coord.lng } }
            : {}),
        }),
      );
      // 첫 성공 수단 heading으로 1회 포커스. 성공 0건이면 이동 없음(통지만).
      // 성공군이 앞이므로 새 순서에서 첫 성공 = 사용자가 처음 만나는 유용한 섹션.
      const first = orderedModes.find((m) => outcomes[m]?.kind === "done");
      if (first) {
        requestAnimationFrame(() => headingRefs[first].current?.focus());
      }
    } finally {
      if (myGen === genRef.current) inFlight.current = false;
      // 예외·세대 폐기 등 위의 종단점을 지나지 않은 경로 — 대기자를 매달아 두지 않는다
      // (커밋 뒤 resolve가 예약돼 있으면 그쪽이 답이다).
      if (pendingOutcomeRef.current?.gen !== myGen) settleWaiter(myGen, { kind: "aborted" });
    }
  }

  const busy = phase.kind === "locating" || phase.kind === "loading";
  // 요약 수치는 저장하지 않고 results에서 파생한다(A8 + 독립 리뷰 2026-08-11) —
  // phase에 successCount를 들고 다니면 outcomes만 바꾸는 경로가 생길 때마다
  // 동기화가 필요하고(종전 계단 회피 토글 재조회가 그 경로였다), 편집 경로가 results를 리셋하는 15초 창에서 낡은 클로저로
  // 커밋되는 상태 불일치가 재발한다. 낭독되는 수치라 시각으로 반증되지 않으므로
  // 진실원을 하나(results.outcomes)로 줄이는 것이 수정이다. settled인데 results가
  // 없으면(재조회 중 편집으로 리셋) 요약도 없다 — 없는 경로를 세지 않는다.
  const settledCount = results
    ? results.orderedModes.filter((m) => results.outcomes[m]?.kind === "done").length
    : null;
  const settledBase =
    phase.kind === "settled" && settledCount !== null
      ? settledCount > 0
        ? t("readySummary", { count: settledCount })
        : t("allFailed")
      : "";
  // 옛 위치로 찾았으면 그 사실을 같은 통지의 뒷문장으로(출발지 칸에만 있으면 조회 버튼을
  // 누른 사용자는 칸으로 되돌아가야 안다). 한 사건이라 한 문장 묶음으로 낸다. 경로를 하나도
  // 못 찾았으면 붙이지 않는다 — "찾지 못했습니다. … 찾았습니다."가 되어 앞뒤가 모순된다(위원장
  // 판정 2026-09-23, 단서는 출발지 칸에 남는다).
  const settledSummary =
    settledBase && settledCount && results?.staleAge
      ? `${settledBase} ${t("staleOriginNotice", {
          age: tManual(results.staleAge.key, { count: results.staleAge.count }),
        })}`
      : settledBase;
  const phaseMessage =
    phase.kind === "settled"
      ? settledSummary
      : phase.kind === "idle"
        ? ""
        : phase.kind === "outOfCoverage"
          ? tCommon("outOfCoverage")
          : t(phase.kind);
  const liveMessage = live.text || phaseMessage;

  // 안내 시작의 직접 응답: 이 결과가 수동 위치에서 계산됐다면 "현재 위치에서
  // 시작한다"를 그 순간에만 말한다(spec 2026-08-09 §4 "안내 시작 통지").
  // 조회 결과 화면에 상시 고지로 두지 않는 이유 — 그 정보로 갈리는 행동은 안내
  // 시작뿐이라, 안내를 시작하지 않는 사용자(실내에서 미리 경로만 듣는 수동 위치의
  // 주 용도)에겐 매 조회마다 지나가야 하는 잡음이었다(위원장 판정 2026-08-17).
  // BeaconModel/useRouteGuide는 여전히 실좌표만 쓰므로(소스 가드) 차단이 아니라 고지다.
  // ⚠ **게시하지 않고 대기 꼬리에 넣는다**(A40): 이 고지와 안내 세션의 시작 문장은
  // 같은 클릭 핸들러에서 같은 커밋에 나오므로, 창구 하나에 따로 게시하면 나중 것이
  // 앞 것을 덮어 한쪽이 통째로 사라진다. 한 사건이므로 한 문장으로 합쳐 내보낸다.
  function announceGuideStart() {
    // 옛 위치로 계산한 경로도 같다 — 안내는 실좌표를 새로 재서 시작한다.
    if (results?.originSource !== "manual" && results?.originSource !== "stale") return;
    pendingSuffixRef.current = tManual("guideStartsFromCurrent");
  }

  function modeHeading(mode: ModeKey): string {
    if (mode === "transit") return tRoute("public");
    if (mode === "walk") return tPed("heading");
    return tRoute("car");
  }

  // 수단별 실시간 안내 진입점(B1 §3.1·B2 §3.1). 게이트 = "그 수단으로 시작 가능한
  // 안내가 있는가": 도보는 경로 성공 ∧ ko, 자동차는 경로 성공 ∧ ko ∧ provider
  // tmap(카카오 폴백은 기하 미지원이라 누르자마자 강등되는 죽은 버튼 — 판별자가
  // 사전 차단), 대중교통은 경로 성공 ∧ ko ∧ 탑승 leg ≥ 1(도보 전용 경로 제외 —
  // 추적 불가 leg는 게이트 축이 아니라 세션 안의 정직 상태).
  const carOutcome = results?.outcomes.car;
  // 경유지 조회(N4)에서 도보 안내는 경유지를 실어 시작한다(판정 ③ — 훅이 경유지를 조회에 싣고, 경유지
  // 경로가 없으면 빼고 안내한다고 말한다). 자동차는 여전히 시작하지 않는다 — 자동차 훅은 경유지를 싣지
  // 않아 경유지가 조용히 빠진 경로를 안내하게 된다(자동차 경유지 개방은 BACKLOG N4 별건).
  const hasVia = results?.viaLabel != null;
  // 도보 상세 안내는 전 로케일에서 시작할 수 있다(E16 축3) — 문장을 서버가 만든다.
  const walkGuideStartable = results?.outcomes.walk?.kind === "done";
  /**
   * 도보 줄 버튼 문장(E42 위원장 확정 렌더: "최단 경로, 총 850m, 약 12분") — 화면과 WebMCP
   * `plan.walk.lines[].label`의 정본. 한 줄 = 한 접근성 객체(joinText, 쉼표). 모르는 종류는
   * null — 이름을 지어 붙이지 않는다(`fetchMode`가 이미 거르지만 이 함수가 폴백 이름을 갖지 않는다).
   */
  const walkLineLabel = (line: WalkRouteLine): string | null => {
    const nameKey = walkLineNameKey(line.kind);
    return nameKey
      ? joinText(
          t(nameKey),
          tPed("summary", {
            distance: formatDistance(line.route.distanceMeters),
            minutes: Math.round(line.route.durationSeconds / 60),
          }),
        )
      : null;
  };
  const carGuideStartable =
    carOutcome?.kind === "done" &&
    carOutcome.mode === "car" &&
    carOutcome.result.provider === "tmap" &&
    !prefersEnglish(locale) &&
    !hasVia;
  const guideDest = results
    ? {
        lat: results.destCoord.lat,
        lng: results.destCoord.lng,
        name: results.destLabel,
      }
    : null;
  const guideDestKey = guideDest ? `${guideDest.lat},${guideDest.lng}` : "";

  /** 대중교통 disclosure 라벨(이름 + 요약) — 화면과 도구 `oneLine`이 같은 함수를 쓴다(WebMCP spec §4.3). */
  function transitRouteLabel(route: TransitRoute, name: string): string {
    return joinText(
      name,
      tTransit("summary", {
        minutes: route.summary.totalMinutes,
        fare: route.summary.fare.toLocaleString(locale),
        transfers: route.summary.transfers,
      }),
      route.summary.walkMinutes > 0
        ? tTransit("walkSummary", { minutes: route.summary.walkMinutes })
        : null,
    );
  }
  /**
   * 이 세대의 재조회 상태(세대가 다르면 없는 것 — 새 조회가 옛 결과를 버리는 유일한 장치다).
   * ⚠ 이 대조를 지우면 새 조회 목록에 옛 세대의 재조회 경로·"없습니다" 문장이 남는다.
   */
  function requeryOf(axis: TransitModeAxis) {
    return requery && results && requery.planId === results.planId ? requery.byAxis[axis] : undefined;
  }
  /** 이 화면이 아는 재조회 축만(서버가 축을 더해도 문구 키 없는 버튼을 그리다 죽지 않게 — Kit `knownRequeryAxes` 동형). */
  function knownRequeryAxes(result: TransitData): TransitModeAxis[] {
    return (result.requeryAxes ?? []).filter((axis): axis is TransitModeAxis => Object.hasOwn(REQUERY_KEYS, axis));
  }
  /**
   * 추천·대안을 한 목록으로(이름 산출은 채팅 카드와 공유 — `alternativeName`). 수단 재조회로 찾은 경로는
   * 목록 끝에 대안으로 붙는다(E50 §4.3) — 화면·WebMCP 계획·안내 세션 추적이 모두 이 목록을 읽는다.
   */
  function transitEntries(result: TransitData): Array<{ route: TransitRoute; name: string; defaultExpanded: boolean }> {
    const requeried = knownRequeryAxes(result).flatMap((axis) => {
      const r = requeryOf(axis);
      return r?.kind === "found" ? [r.route] : [];
    });
    return [
      // 1순위는 축 라벨을 갖지 않는다(annotateHighlights: "자기보다 나은 자기는 없다") — 고정 이름.
      { route: result.recommended, name: tTransit("recommended"), defaultExpanded: true },
      ...[...result.alternatives, ...requeried].map((alt) => ({
        route: alt,
        name: alternativeName(alt, (key, values) => tTransit(key, values)),
        defaultExpanded: false,
      })),
    ];
  }
  /**
   * 수단 재조회 버튼(E50 §4.3). 찾음·없음은 포커스를 쥔 버튼이 사라지는 전이라 결과 요소로 선점 이동하고
   * (헌장 §5 ⓑ, 결과 요소가 포커스를 받아 읽히므로 별도 통지 없음), 실패는 버튼이 남으므로 포커스를 두고
   * (헌장 §5 ⓐ 유지 우선) 이 화면의 창구(`announce`, 보이는 상태 줄)에 실패 문장을 게시한다.
   */
  async function runRequery(axis: TransitModeAxis) {
    if (!results) return;
    const { planId, originCoord, destCoord, dataLang } = results;
    const guardKey = `${planId}:${axis}`;
    if (requeryInFlight.current.has(guardKey)) return;
    requeryInFlight.current.add(guardKey);
    // 직전 실패 문장을 상태 줄에서 푼다(빈 게시는 발화되지 않는다) — 재시도가 성공한 뒤에도 "불러오지
    // 못했습니다"가 남으면 화면과 상태 줄이 반대를 말한다.
    announce("");
    setRequery((prev) => ({
      planId,
      byAxis: { ...(prev?.planId === planId ? prev.byAxis : {}), [axis]: { kind: "loading" } },
    }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let outcome: TransitRequeryOutcome;
    try {
      outcome = await fetchTransitRequery(originCoord, destCoord, dataLang, axis, ctrl.signal);
    } finally {
      clearTimeout(timer);
      requeryInFlight.current.delete(guardKey);
    }
    // 그 사이 새 조회가 왔으면(세대가 다르면) 옛 세대 결과는 버린다(통지·포커스 이동도 하지 않는다).
    if (planIdRef.current !== planId) return;
    if (outcome.kind === "failed") announce(tTransit(REQUERY_KEYS[axis].failed));
    else {
      requeryFocusRef.current = {
        target: outcome.kind === "found" ? `${requeryIdPrefix}-route-${outcome.route.routeKey}` : `${requeryIdPrefix}-${axis}-none`,
        button: `${requeryIdPrefix}-${axis}-button`,
      };
    }
    setRequery((prev) => (prev?.planId === planId ? { planId, byAxis: { ...prev.byAxis, [axis]: outcome } } : prev));
  }
  /**
   * WebMCP 도구 계획(spec §3.4·§8.3) — 화면 상태(`results`)에서 **같은 i18n 키**로 조립한 투영.
   * leg 한 줄은 화면 leg 문장의 평문판(`t.markup`), 스텝은 화면 `StepList`와 같은 배열이다.
   * 렌더마다 다시 만들지만 `planId`가 세대를 대표하므로 객체 정체성은 계약이 아니다.
   */
  const kindOf = (o: ModeOutcome): ModeOutcomeKind => (o.kind === "outOfCoverage" ? "error" : o.kind);
  function transitLegLine(legs: TransitLeg[], index: number, boardSeen: number, destName: string): string {
    const leg = legs[index];
    if (leg.mode === "walk") {
      const name = leg.toName ?? destName;
      const distance = leg.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
      // 승차 출구(E25)는 화면 브리핑과 같은 규칙으로 이 줄이 싣는다.
      const boardExit = name ? boardExitAfterWalk(legs, index) : null;
      const key = name
        ? boardExit
          ? distance
            ? "legWalkToExit"
            : "legWalkToExitNoDistance"
          : distance
            ? "legWalkTo"
            : "legWalkToNoDistance"
        : distance
          ? "legWalkToDest"
          : "legWalkToDestNoDistance";
      return tTransit(key, {
        minutes: leg.minutes,
        ...(name ? { name } : {}),
        ...(distance ? { distance } : {}),
        ...(boardExit ? { exit: boardExit } : {}),
      });
    }
    const lineLabel =
      leg.mode === "bus" && leg.lineName ? tTransit("busNo", { route: leg.lineName }) : (leg.lineName ?? "");
    const line = tTransit.markup(boardSeen === 0 ? "legBoard" : "legTransfer", {
      line: () => lineLabel,
      from: () => leg.fromName ?? "",
      count: leg.stationCount ?? 0,
    });
    // 앞 도보 줄이 없을 때만 이 줄이 승차 출구를 싣는다(두 줄에 겹치지 않는다).
    const boardExitTail = boardExitOnBoardLine(legs, index);
    return boardExitTail ? joinText(line, tTransit("legBoardExit", { exit: boardExitTail })) : line;
  }
  // 경로 순번 표(착지·트리거 속성용)는 렌더에서, 문장 조립은 도구 호출 시점(`read()`)에 한다 —
  // 문장은 도구가 부를 때만 필요하고, 렌더마다 수십 문장을 만드는 비용을 치를 이유가 없다.
  const transitOutcomeNow = results?.outcomes.transit;
  const routeRefs = buildRouteRefTable(
    transitOutcomeNow?.kind === "done" && transitOutcomeNow.mode === "transit"
      ? transitEntries(transitOutcomeNow.result).map((e) => e.route.routeKey)
      : [],
  );
  function buildToolPlan(): ToolPlan | null {
    if (!results) return null;
    const transitOutcome = results.outcomes.transit;
    const entries =
      transitOutcome?.kind === "done" && transitOutcome.mode === "transit"
        ? transitEntries(transitOutcome.result)
        : [];
    const routes: PlanTransitRoute[] = entries.map(({ route, name }) => {
      const ref = routeRefs.refOf(route.routeKey) ?? "0";
      let boardSeen = 0;
      const legLines = route.legs.map((leg, i) => {
        const line = transitLegLine(route.legs, i, boardSeen, results.destLabel);
        if (leg.mode !== "walk") boardSeen += 1;
        return line;
      });
      return {
        routeKey: route.routeKey,
        routeRef: ref,
        name,
        oneLine: transitRouteLabel(route, name),
        highlight: route.highlight,
        // E27 잔여 ①(2026-09-01): en 게이트 해제. 서버가 영문 조각을 싣고 표시 계층이
        // 줄 단위로 고르므로 비-ko에서도 시작할 수 있다. ⚠ 같은 파일의 자동차
        // (`carGuideStartable`) 게이트는 **다른 축**이라 그대로다.
        startable: buildTransitGuideRoute(route) !== null,
        summary: {
          totalMinutes: route.summary.totalMinutes,
          transfers: route.summary.transfers,
          fare: route.summary.fare,
          walkMinutes: route.summary.walkMinutes,
        },
        legLines,
        legs: route.legs.map((leg, i) => ({
          n: i + 1,
          mode: leg.mode,
          lineName: leg.lineName,
          fromName: leg.fromName,
          toName: leg.toName,
          stationCount: leg.stationCount,
          distanceMeters: leg.distanceMeters,
          quickExit:
            leg.mode !== "walk"
              ? (alightLineText(tTransit, tTransitGuide, leg.toName ?? "", leg.quickExit, leg.exit?.alight) ??
                undefined)
              : undefined,
        })),
      };
    });
    const walkOutcome = results.outcomes.walk;
    const walk =
      walkOutcome === undefined
        ? null
        : walkOutcome.kind === "done" && walkOutcome.mode === "walk"
          ? {
              outcome: "done" as const,
              // 화면 줄과 같은 순서·같은 문장(E42) — 도구가 돌려준 n번 문장 = 커서가 착지한 n번 항목.
              lines: walkOutcome.lines.flatMap((line) => {
                const label = walkLineLabel(line);
                return label
                  ? [{
                      kind: line.kind,
                      label,
                      distanceMeters: line.route.distanceMeters,
                      durationSeconds: line.route.durationSeconds,
                      steps: walkStepItems(line.route, true).items,
                    }]
                  : [];
              }),
              startable: walkGuideStartable,
            }
          : { outcome: kindOf(walkOutcome), lines: [], startable: false };
    const car =
      carOutcome === undefined
        ? null
        : carOutcome.kind === "done" && carOutcome.mode === "car"
          ? {
              outcome: "done" as const,
              summary: tCar("summary", {
                distance: formatDistance(carOutcome.result.distanceMeters),
                minutes: durationToMinutes(carOutcome.result.durationSeconds),
                taxi: carOutcome.result.taxiFare.toLocaleString(locale),
              }),
              distanceMeters: carOutcome.result.distanceMeters,
              durationSeconds: carOutcome.result.durationSeconds,
              steps: carStepItems(carOutcome.result),
              startable: carGuideStartable,
            }
          : { outcome: kindOf(carOutcome), steps: [], startable: false };
    return {
      planId: results.planId,
      destination: results.destLabel,
      resolved: {
        from: results.fromLabel ?? currentLabel,
        to: results.toLabel ?? currentLabel,
        via: results.viaLabel,
      },
      routeRefs,
      transit: transitOutcome === undefined ? null : { outcome: kindOf(transitOutcome), routes },
      walk,
      car,
      modes: results.orderedModes,
    };
  }

  /**
   * 도구 `plan_directions`의 조회(spec §3.4): **완전 교체** — 생략된 출발지는 현재 위치,
   * 경유지는 없음으로 한 번에 설정하고, 그 요청 스냅샷으로 정본 조회를
   * 돌린다. 완료는 세대 결박 대기자가 알린다. 조회 중이면 `busy`(reject-while-busy).
   */
  function runQueryForTool(request: PlanRequest, signal: AbortSignal): Promise<QueryOutcome> {
    if (inFlight.current) return Promise.resolve({ kind: "busy" });
    // 사용자 버튼은 새 조회로 세션을 끝내지만, 에이전트 한 마디로 걷는 중인 안내가 끊기면 안 된다 —
    // 중지는 사용자 버튼뿐이다(a11y 리뷰 HIGH).
    if (hasActiveGuideSession()) return Promise.resolve({ kind: "sessionActive" });
    // 결과 영역 안에 커서가 있으면(도구가 착지시킨 스텝·heading) 그 서브트리가 통째로 사라진다 —
    // 항상 존재하는 조회 버튼으로 선점 이동한다(헌장 §5). 사용자 클릭 경로는 커서가 이미 그 버튼이다.
    if (resultsRef.current?.contains(document.activeElement)) submitRef.current?.focus();
    setFromField(endpointToField(request.from, currentLabel));
    setToField(endpointToField(request.to, currentLabel));
    setViaField(request.via ? endpointToField(request.via, currentLabel) : null);
    const gen = genRef.current + 1;
    const onAbort = () => settleWaiter(gen, { kind: "aborted" });
    const promise = new Promise<QueryOutcome>((resolve) => {
      queryWaiterRef.current = { gen, resolve };
    });
    signal.addEventListener("abort", onAbort, { once: true });
    void runQuery({ from: request.from, to: request.to, via: request.via });
    return promise.finally(() => signal.removeEventListener("abort", onAbort));
  }
  const readSnapshot = (): DirectionsSnapshot => ({
    fields: {
      from: displayField(fromField).text,
      to: toField.text,
      via: viaField ? viaField.text : null,
    },
    phase: phase.kind,
    plan: buildToolPlan(),
    lang: dataLocale(locale) === "ko" ? "ko" : "en",
  });
  // 도구 `execute`는 ref로 최신 화면을 읽는다(등록은 마운트 1회, 재등록 0 — spec §5.1).
  // ⚠ ref 갱신은 렌더가 아니라 effect에서(useRouteGuide 미러 관례 동형).
  const bridgeRef = useRef<DirectionsBridge>({ read: readSnapshot, runQuery: runQueryForTool });
  useEffect(() => {
    bridgeRef.current = { read: readSnapshot, runQuery: runQueryForTool };
  });
  // 종단 phase의 대기자 resolve — 브리지 갱신 effect 뒤에 두어야 도구가 커밋된 화면을 읽는다.
  useEffect(() => {
    const pending = pendingOutcomeRef.current;
    if (!pending) return;
    // ⚠ 동시 렌더: 슬롯이 채워지기 전에 시작된 렌더가 먼저 커밋되면 이 effect는 **옛 화면**에서
    // 돈다(실측 — 앞 세대 `planId`가 읽혔다). 커밋된 상태가 그 결과와 일치할 때만 푼다.
    const o = pending.outcome;
    const committed =
      o.kind === "settled"
        ? results?.planId === o.planId && phase.kind === "settled"
        : o.kind === "geoError"
          ? phase.kind === "geoError"
          : o.kind === "outOfCoverage"
            ? phase.kind === "outOfCoverage"
            : true;
    if (!committed) return;
    pendingOutcomeRef.current = null;
    settleWaiter(pending.gen, pending.outcome);
  });
  // W2(spec §5.2): 도구를 등록하지 않고 브릿지를 뷰 레지스트리에 게시한다 — 도구는 루트가 상시
  // 등록하고 실행 시점에 이 브릿지를 읽는다. 게시 객체는 마운트 1회 고정이고 내용은 ref로 최신이다.
  useEffect(() => {
    const bridge: DirectionsBridge = {
      read: () => bridgeRef.current.read(),
      runQuery: (request, signal) => bridgeRef.current.runQuery(request, signal),
    };
    publishView("directions", bridge);
    return () => withdrawView("directions", bridge);
  }, []);

  function modeErrorText(mode: ModeKey): string {
    if (mode === "transit") return tTransit("error");
    if (mode === "walk") return tPed("error");
    return tCar("error");
  }
  function modeNoRouteText(mode: ModeKey): string {
    // car는 경로 없음 상태가 없으므로(브리핑 직접 응답) 도달하지 않는다.
    if (mode === "transit") return tTransit("noRoute");
    return tPed("noRoute");
  }

  function routeEndpoint(side: RecentEndpoint | null): DirEndpoint {
    return side
      ? { kind: "place", label: side.label, coord: { lat: side.lat, lng: side.lng } }
      : { kind: "current" };
  }
  function routeItemLabel(r: RecentRoute): string {
    const side = (s: RecentEndpoint | null) => (s ? s.label : t("currentLocation"));
    // ko 목적격 조사는 라벨 받침에 따라 갈려 문자열 자원에 박을 수 없다("강동역을"/
    // "경복궁을"·"학교를"). 호출부가 붙이고, 한글이 아닌 이름은 조사 없이 물러난다.
    const viaLabel =
      r.via && locale === "ko" ? r.via.label + (objectParticle(r.via.label) ?? "") : r.via?.label;
    return r.via
      ? tRecentRoutes("itemVia", { from: side(r.from), to: side(r.to), via: viaLabel ?? "" })
      : tRecentRoutes("item", { from: side(r.from), to: side(r.to) });
  }
  /** 활성화 = 두 필드 원자 확정 + 즉시 조회(스펙 §1.4). 결과 도착 시 이 섹션이 통째로
   * 사라지므로 포커스를 먼저 조회 버튼으로 선점한다(헌장 §5). endpoint 최근 목록도
   * 확정 경로와 동일하게 기록(iOS setEndpoint 경유와 대칭). */
  function activateRecentRoute(r: RecentRoute) {
    submitRef.current?.focus();
    const fromEp = routeEndpoint(r.from);
    const toEp = routeEndpoint(r.to);
    const viaEp: DirEndpoint | null = r.via ? routeEndpoint(r.via) : null;
    setFromField(endpointToField(fromEp, currentLabel));
    setToField(endpointToField(toEp, currentLabel));
    setViaField(viaEp ? endpointToField(viaEp, currentLabel) : null);
    if (r.from) setRecentFrom(recordRecentEndpoint("from", r.from));
    if (r.to) setRecentTo(recordRecentEndpoint("to", r.to));
    if (r.via) setRecentVia(recordRecentEndpoint("via", r.via));
    void runQuery({ from: fromEp, to: toEp, via: viaEp });
  }
  function deleteRecentRoute(r: RecentRoute, index: number) {
    const next = removeRecentRoute(r);
    setRecentRoutes(next);
    announce(tRecent("deleted"));
    const visibleCount = Math.min(next.length, 5);
    if (visibleCount === 0) {
      submitRef.current?.focus();
      return;
    }
    routeFocusIndexRef.current = Math.min(index, visibleCount - 1);
    setRouteRevision((v) => v + 1);
  }
  /** 고정 토글(스펙 2026-08-12 §4): 화면 순서는 그대로(정렬은 다음 로드부터),
   *  로컬 상태만 in-place 교체 — 토글 순간 항목이 이동하면 탐색 맥락이 깨진다.
   *  통지는 항목명 포함 — 연속 고정 시 동일 문자열 bail out으로 두 번째부터
   *  침묵하는 것을 막는다(a11y 감사 실측 2026-08-12, PlaceSearch 동형). */
  function togglePinRoute(r: RecentRoute) {
    const pinned = !r.pinned;
    setRecentRoutePinned(r, pinned);
    setRecentRoutes((prev) => prev.map((x) => (x === r ? { ...x, pinned } : x)));
    announce(
      tRecent(pinned ? "pinnedItem" : "unpinnedItem", { name: routeItemLabel(r) }),
    );
  }
  function clearRoutes() {
    const kept = clearRecentRoutes();
    setRecentRoutes(kept);
    if (kept.length === 0) {
      announce(tRecentRoutes("cleared"));
      submitRef.current?.focus(); // 섹션 소멸 — 기존 계약
    } else {
      // 고정이 남아 섹션·버튼이 그대로다 — 포커스 무이동.
      announce(tRecent("clearedExceptPinned"));
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("back")}
      </button>

      <h2 ref={titleRef} tabIndex={-1} className="mt-2 text-2xl font-bold">
        {t("title")}
      </h2>

      <EndpointField
        label={t("from")}
        searchLabel={t("searchFrom")}
        field={displayField(fromField)}
        onTextChange={(text) => {
          if (stopActiveGuideSession()) announce(tBeacon("stopped"));
          setFromField({ text, resolved: null });
          discardResults();
        }}
        onResolve={(ep) => {
          recordResolved("from", ep);
          setFromField(endpointToField(ep, currentLabel));
        }}
        onUseCurrent={() => void selectCurrentFrom()}
        useCurrentBusy={refreshingCurrent}
        focusAfterResolve={() => toInputRef.current?.focus()}
        announce={announce}
        locale={locale}
        t={t}
        recentEndpoints={recentFrom}
        onDeleteRecent={(e) => {
          const next = removeRecentEndpoint("from", e);
          setRecentFrom(next);
          return next;
        }}
        onClearRecent={() => {
          const kept = clearRecentEndpoints("from");
          setRecentFrom(kept);
          return kept;
        }}
        onTogglePinRecent={(e, pinned) => {
          setRecentEndpointPinned("from", e, pinned);
          // 화면 순서 유지 계약(스펙 §4) — 참조 동일 항목만 in-place 교체
          setRecentFrom((prev) => prev.map((x) => (x === e ? { ...x, pinned } : x)));
        }}
        tRecent={tRecent}
      />

      <button
        type="button"
        onClick={swapFields}
        className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-700 underline dark:text-blue-300"
      >
        <ArrowUpDown aria-hidden="true" className="h-4 w-4" />
        {t("swap")}
      </button>

      <EndpointField
        label={t("to")}
        searchLabel={t("searchTo")}
        field={displayField(toField)}
        onTextChange={(text) => {
          if (stopActiveGuideSession()) announce(tBeacon("stopped"));
          setToField({ text, resolved: null });
          discardResults();
        }}
        onResolve={(ep) => {
          // 목적지 확정도 텍스트 변경과 같은 무효화 축(리뷰 MAJOR): "최근 장소"
          // 직행 선택은 onTextChange를 거치지 않아 활성 세션이 옛 목적지를 향해
          // 조용히 계속 추적했다(iOS는 .onChange(of: endpoint(.to))의 모델 레벨
          // 방어가 있어 웹만의 구멍). 결과도 옛 목적지의 산물이라 함께 비운다.
          if (stopActiveGuideSession()) announce(tBeacon("stopped"));
          recordResolved("to", ep);
          setToField(endpointToField(ep, currentLabel));
          discardResults();
        }}
        registerInput={(el) => {
          toInputRef.current = el;
        }}
        focusAfterResolve={() => submitRef.current?.focus()}
        announce={announce}
        locale={locale}
        t={t}
        recentEndpoints={recentTo}
        onDeleteRecent={(e) => {
          const next = removeRecentEndpoint("to", e);
          setRecentTo(next);
          return next;
        }}
        onClearRecent={() => {
          const kept = clearRecentEndpoints("to");
          setRecentTo(kept);
          return kept;
        }}
        onTogglePinRecent={(e, pinned) => {
          setRecentEndpointPinned("to", e, pinned);
          // 화면 순서 유지 계약(스펙 §4) — 참조 동일 항목만 in-place 교체
          setRecentTo((prev) => prev.map((x) => (x === e ? { ...x, pinned } : x)));
        }}
        tRecent={tRecent}
      />

      {/* 경유지(N4, 선택 사항): 도착지와 조회 버튼 사이. 버튼을 누르면 그 자리가 필드로
          바뀌므로 포커스를 새 입력으로 선점 이동한다(헌장 §5). 도착지 확정 뒤 포커스는
          종전대로 조회 버튼이다 — 선택 사항이 기본 흐름을 늘리지 않는다. 현재 위치는
          경유지가 될 수 없다(onUseCurrent 미제공). */}
      {viaField === null ? (
        <button
          type="button"
          onClick={() => {
            setViaField({ text: "", resolved: null });
            requestAnimationFrame(() => viaInputRef.current?.focus());
          }}
          className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-700 underline dark:text-blue-300"
        >
          <MapPinPlus aria-hidden="true" className="h-4 w-4" />
          {t("addVia")}
        </button>
      ) : (
        <>
          <EndpointField
            label={t("via")}
            searchLabel={t("searchVia")}
            field={viaField}
            onTextChange={(text) => {
              if (stopActiveGuideSession()) announce(tBeacon("stopped"));
              setViaField({ text, resolved: null });
              discardResults();
            }}
            onResolve={(ep) => {
              if (stopActiveGuideSession()) announce(tBeacon("stopped"));
              if (ep.kind === "place") {
                setRecentVia(
                  recordRecentEndpoint("via", { label: ep.label, lat: ep.coord.lat, lng: ep.coord.lng }),
                );
              }
              setViaField(endpointToField(ep, currentLabel));
              discardResults();
            }}
            registerInput={(el) => {
              viaInputRef.current = el;
            }}
            focusAfterResolve={() => submitRef.current?.focus()}
            announce={announce}
            locale={locale}
            t={t}
            recentEndpoints={recentVia}
            onDeleteRecent={(e) => {
              const next = removeRecentEndpoint("via", e);
              setRecentVia(next);
              return next;
            }}
            onClearRecent={() => {
              const kept = clearRecentEndpoints("via");
              setRecentVia(kept);
              return kept;
            }}
            onTogglePinRecent={(e, pinned) => {
              setRecentEndpointPinned("via", e, pinned);
              setRecentVia((prev) => prev.map((x) => (x === e ? { ...x, pinned } : x)));
            }}
            tRecent={tRecent}
          />
          {/* 삭제하면 이 버튼과 필드가 함께 사라진다 — 조회 버튼으로 선점 이동. */}
          <button
            type="button"
            onClick={() => {
              submitRef.current?.focus();
              if (stopActiveGuideSession()) announce(tBeacon("stopped"));
              setViaField(null);
              discardResults();
            }}
            className="mt-2 min-h-11 text-sm underline"
          >
            {t("removeVia")}
          </button>
        </>
      )}

      {/* disabled 금지: aria-disabled + in-flight ref 가드로 포커스를 지킨다 */}
      <button
        type="button"
        ref={submitRef}
        onClick={() => runQuery()}
        aria-disabled={busy}
        aria-busy={busy}
        className="mt-4 min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("submit")}
      </button>

      {/* 이 뷰의 유일한 live region(A40). 수단별 개별 통지 금지, 합산 1문장
          (phaseMessage). 게시(`announce` — 폼 보조 통지·안내 중지·**실시간 안내 세션
          문장**)는 같은 채널을 잠시 우선 점유한다. 별도 정적 텍스트를 두지 않는다 —
          두 곳에 같은 문장을 두면 회전자에서 이중 낭독된다.
          ⚠ 아래 패널·비콘은 자기 region을 두지 않는다(`announce` prop으로 여기 게시).
          상시 표시(구간·잔여·최신 문장)는 종전대로 각 패널 안에 남는다 — 그것은
          live region 밖이라 이 계약의 대상이 아니다. */}
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm" lang={live.lang}>
        <span key={live.seq}>{liveMessage}</span>
      </p>

      {/* 최근 경로(스펙 2026-08-10 §1.3): 결과 없는 화면에서만 — 결과 아래 20행은 탐색 방해.
          조용히 나타나는 목록이라 heading이 발견 경로. 항목 한 줄 = 한 객체(라벨 문장이
          곧 버튼 이름), 삭제 버튼은 인터랙티브라 별도 객체가 정상. */}
      {!results && !busy && visibleRecentRoutes.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-semibold">{tRecentRoutes("title")}</h3>
          <ul className="mt-1">
            {visibleRecentRoutes.map((r, i) => {
              const label = routeItemLabel(r);
              return (
                <li
                  key={`${r.from?.lat ?? "cur"},${r.from?.lng ?? ""}→${r.to?.lat ?? "cur"},${r.to?.lng ?? ""}${r.via ? `@${r.via.lat},${r.via.lng}` : ""}`}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => activateRecentRoute(r)}
                    className="min-h-11 flex-1 text-left text-sm underline"
                  >
                    {/* 고정 항목은 라벨 접미사 하나로 시각·낭독 동시 전달(한 줄 = 한 객체) */}
                    {r.pinned ? joinText(label, tRecent("pinned")) : label}
                  </button>
                  {/* 고정이 삭제보다 앞(위원장 지시 2026-08-12) */}
                  <button
                    type="button"
                    aria-label={tRecent(r.pinned ? "unpinItem" : "pinItem", {
                      name: label,
                    })}
                    onClick={() => togglePinRoute(r)}
                    className="min-h-11 rounded-md border border-border px-3 text-sm"
                  >
                    {tRecent(r.pinned ? "unpin" : "pin")}
                  </button>
                  <button
                    type="button"
                    ref={(el) => {
                      routeDeleteRefs.current[i] = el;
                    }}
                    aria-label={tRecent("deleteItem", { name: label })}
                    onClick={() => deleteRecentRoute(r, i)}
                    className="min-h-11 rounded-md border border-border px-3 text-sm"
                  >
                    {tRecent("delete")}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={clearRoutes}
            className="mt-1 min-h-11 text-sm underline"
          >
            {tRecentRoutes("clearAll")}
          </button>
        </section>
      )}

      {results && (
        <div ref={resultsRef} className="mt-2">
          {results.orderedModes.map((mode) => {
            const outcome = results.outcomes[mode];
            if (!outcome) return null;
            return (
              <div
                key={mode}
                className="mt-3 rounded-md border border-gray-300 p-3"
              >
                <h3
                  ref={headingRefs[mode]}
                  tabIndex={-1}
                  className="text-base font-semibold"
                >
                  {modeHeading(mode)}
                </h3>
                {/* 수단별 실시간 안내 진입점(§3.1) — 수단 heading 착지 후 **첫
                    스와이프** 거리(iOS 동조 — 독립 리뷰).
                    트리거가 곧 시작(startOnOpen — "시작" 라벨 거짓말 금지).
                    라벨은 수단별 짧은 형(위원장 판정 2026-08-06, 공통 라벨 번복):
                    SR 버튼 목록·항목 선택기는 헤딩 문맥 없이 버튼 이름만 나열해
                    동일 라벨 3개가 구분 불가다. 목적지 변경은 key 재마운트로 세션 정리. */}
                {mode === "car" && carGuideStartable && guideDest && (
                  <DistanceBeacon
                    key={`car-${guideDestKey}`}
                    dest={guideDest}
                    kind="car"
                    accessible={false}
                    variant={null}
                    announce={announce}
                    startOnOpen
                    onStart={announceGuideStart}
                    triggerLabel={tBeacon("guideStartCar")}
                  />
                )}
                {/* 대중교통·도보는 안내 시작 버튼이 여기 없다 — 경로가 복수라 버튼이
                    경로에 귀속되어야 하고(어느 경로의 안내인지 라벨로 드러난다),
                    아래 목록의 각 disclosure 안에 하나씩 있다(도보는 E42 — B9 ② 흡수).
                    자동차는 경로가 하나라 비교 대상이 없어 섹션 상단이 맞다. */}
                {outcome.kind === "error" && (
                  <p className="mt-1 text-sm">{modeErrorText(mode)}</p>
                )}
                {outcome.kind === "empty" && (
                  <p className="mt-1 text-sm">{modeNoRouteText(mode)}</p>
                )}
                {outcome.kind === "unsupportedWaypoint" && (
                  <p className="mt-1 text-sm">{t("unsupportedWaypoint")}</p>
                )}
                {outcome.kind === "done" && outcome.mode === "transit" && (
                  <>
                    {/* 추천·대안을 한 목록으로 낸다(W3C APG disclosure를 쌓은
                        accordion). 라벨·펼침 컨트롤·본문 구성이 모두 같고 **초기
                        펼침 상태만** 다르다 — 추천만 펼친 채로 시작한다. 종전엔
                        추천만 라벨 없이 통째로 펼쳐져 있어, 같은 지위의 경로들이
                        서로 다른 컨트롤로 보였다(위원장 지적 2026-08-07). 버튼이
                        발견 경로라 펼침 본문은 <div>(헌장 §3), 라벨이 이미 요약이라
                        본문 요약은 생략한다(includeSummary=false, 인접 중복 금지). */}
                    {transitEntries(outcome.result).map(({ route, name, defaultExpanded }) => {
                      // 안내 세션이 살아 있는 경로는 강제 펼침(접힘 unmount가
                      // 세션을 조용히 죽이는 경로 차단).
                      const expanded =
                        routeExpanded(route.routeKey, defaultExpanded) ||
                        activeGuideAlt === route.routeKey;
                      // E27 잔여 ①: en 게이트 해제(위 `startable`과 같은 축).
                      const guideStartable = buildTransitGuideRoute(route) !== null;
                      return (
                        <div key={route.routeKey} className="mt-2">
                          <button
                            type="button"
                            id={`${requeryIdPrefix}-route-${route.routeKey}`}
                            aria-expanded={expanded}
                            onClick={() => toggleRoute(route.routeKey)}
                            className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                          >
                            {transitRouteLabel(route, name)}
                          </button>
                          {expanded && (
                            <>
                              {/* 안내 시작은 경로에 귀속된다. 라벨이 곧 그 경로
                                  이름이라 VO 로터 버튼 목록(헤딩 문맥 없이 이름만
                                  나열된다)에서 어느 경로의 안내인지 구분된다(§4.2). */}
                              {guideStartable && (
                                <TransitGuidePanel
                                  key={`transit-${route.routeKey}-${guideDestKey}`}
                                  route={route}
                                  triggerLabel={tBeacon("guideStartTransitAlt", { name })}
                                  dest={guideDest ?? undefined}
                                  // 승차 전 도보의 계단 회피 출처였던 토글이 E42로 사라졌다(spec §8 미결 1).
                                  walkAccessible={false}
                                  announce={announce}
                                  onActiveChange={(active) =>
                                    setActiveGuideAlt((prev) =>
                                      active
                                        ? route.routeKey
                                        : prev === route.routeKey
                                          ? null
                                          : prev,
                                    )
                                  }
                                />
                              )}
                              <TransitRouteResult
                                route={route}
                                t={tTransit}
                                locale={locale}
                                dest={results.destLabel}
                                includeSummary={false}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                    {/* 수단 재조회(E50 §4.2·§4.3): 강등 뒤 전체 후보에 그 수단만 타는 경로가 없을 때만(서버
                        `requeryAxes`, 이 화면이 아는 축만). 찾으면 버튼이 사라지고 경로가 위 목록 끝에 붙는다. 없음은 버튼 자리의
                        문장(포커스 착지점이라 tabIndex=-1), 실패는 버튼 유지(재시도) + 화면 창구 통지. */}
                    {knownRequeryAxes(outcome.result).map((axis) => {
                      const r = requeryOf(axis);
                      const keys = REQUERY_KEYS[axis];
                      if (r?.kind === "found") return null;
                      if (r?.kind === "none") {
                        return (
                          <p key={axis} id={`${requeryIdPrefix}-${axis}-none`} tabIndex={-1} className="mt-2 text-sm">
                            {tTransit(keys.none)}
                          </p>
                        );
                      }
                      return (
                        <div key={axis} className="mt-2">
                          <button
                            type="button"
                            id={`${requeryIdPrefix}-${axis}-button`}
                            aria-disabled={r?.kind === "loading" || undefined}
                            onClick={() => void runRequery(axis)}
                            className="min-h-11 rounded-md border border-border px-3 text-sm aria-disabled:opacity-50"
                          >
                            {tTransit(keys.button)}
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
                {/* 도보 줄 목록(E42, 대중교통 대안 disclosure 동형). 라벨은 한 줄 = 한 객체
                    (joinText: "최단 경로, 총 850m, 약 12분"), 본문은 안내 시작 버튼 + 단계.
                    첫 줄의 기본 펼침은 장거리 접힘 문턱(spec §4.4 — 수십 단계 목록이 아래 수단을
                    화면 밖으로 민다), 둘째 줄은 접힘. 안내 시작은 줄에 귀속된다 — 라벨이 곧 그
                    줄 이름이라 VO 로터 버튼 목록에서 어느 경로의 안내인지 구분된다(B9 ②).
                    세션이 살아 있는 줄은 강제 펼침(접힘 unmount가 세션을 조용히 죽인다). */}
                {outcome.kind === "done" && outcome.mode === "walk" &&
                  outcome.lines.map((line, i) => {
                    const startKey = walkLineStartKey(line.kind);
                    const label = walkLineLabel(line);
                    if (!startKey || !label) return null;
                    const active = activeWalkLine === line.kind;
                    const expanded =
                      active ||
                      (i === 0
                        ? (walkExpanded ?? !shouldCollapseWalk(line.route.durationSeconds))
                        : walkSecondExpanded);
                    const toggle = () => {
                      if (active) return;
                      if (i === 0) setWalkExpanded(!expanded);
                      else setWalkSecondExpanded(!expanded);
                    };
                    const axis = walkLineAxis(line.kind);
                    return (
                      <div key={line.kind} className="mt-2">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={toggle}
                          className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                        >
                          {label}
                        </button>
                        {/* 버튼이 발견 경로라 본문은 div(region·heading 부여 금지). */}
                        {expanded && (
                          <>
                            {walkGuideStartable && guideDest && (
                              <DistanceBeacon
                                key={`walk-${line.kind}-${guideDestKey}`}
                                dest={guideDest}
                                kind="walk"
                                accessible={axis.accessible}
                                variant={axis.variant}
                                via={results.via}
                                announce={announce}
                                startOnOpen
                                onStart={announceGuideStart}
                                onActiveChange={(on) =>
                                  setActiveWalkLine((prev) =>
                                    on ? line.kind : prev === line.kind ? null : prev,
                                  )
                                }
                                triggerLabel={tBeacon(startKey)}
                              />
                            )}
                            <WalkRouteResult
                              briefing={line.route}
                              t={tPed}
                              waypointLabel={results.viaLabel}
                              includeSummary={false}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                {outcome.kind === "done" && outcome.mode === "car" && (
                  <CarRouteResult
                    briefing={outcome.result}
                    locale={locale}
                    t={tCar}
                    waypointLabel={results.viaLabel}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 출발지/도착지 필드 1개: 텍스트 입력 + 미니 검색(장소·주소 병렬, 기존
 * /api/places·/api/address/search 재사용) + 후보 선택.
 * - 텍스트를 편집하면 부모가 resolved를 즉시 무효화한다(원자 상태).
 * - 후보 도착 시 첫 후보 버튼으로 포커스 이동(동적 콘텐츠 등장 — 최상단 결과가
 *   곧 다음 행동 후보). 0건·오류는 이동 없이 통지만.
 * - 후보 선택은 리스트를 제거하므로, 제거 전에 포커스를 선점 이동한다(포커스를
 *   쥔 요소를 없애는 상태 전이 금지). 이동처는 사용 흐름의 다음 컨트롤
 *   (focusAfterResolve — 출발지는 도착지 입력, 도착지는 조회 버튼).
 * - 주소 후보는 좌표가 없어 /api/geocode로 변환 후 확정한다(PlaceSearch 동형).
 */
function EndpointField({
  label,
  searchLabel,
  field,
  onTextChange,
  onResolve,
  onUseCurrent,
  useCurrentBusy,
  registerInput,
  focusAfterResolve,
  announce,
  locale,
  t,
  recentEndpoints,
  onDeleteRecent,
  onClearRecent,
  onTogglePinRecent,
  tRecent,
}: {
  label: string;
  searchLabel: string;
  field: FieldState;
  onTextChange: (text: string) => void;
  onResolve: (ep: DirEndpoint) => void;
  /** 있으면 "현재 위치 사용" 복원 버튼 노출(출발지 전용, 도착지는 스왑으로 충분) */
  onUseCurrent?: () => void;
  /** 강제 재측위 진행 중 — 버튼 라벨 전환이 유일한 진행 신호(별도 통지 금지) */
  useCurrentBusy?: boolean;
  /** 입력 요소를 부모에 노출(다른 필드 확정 시 이 입력으로 포커스 전진용) */
  registerInput?: (el: HTMLInputElement | null) => void;
  /** 후보 확정 직후(리스트 제거 전) 포커스 이동처. 미지정 시 자기 입력 폴백. */
  focusAfterResolve?: () => void;
  announce: (message: string) => void;
  locale: string;
  t: ReturnType<typeof useTranslations<"directions">>;
  /** 이 필드 전용 최근 장소 목록(출발지·도착지 분리 저장, 스펙 2026-07-26) */
  recentEndpoints: RecentEndpoint[];
  onDeleteRecent: (e: RecentEndpoint) => RecentEndpoint[];
  /** 모두 지우기 — 고정 보존(스펙 2026-08-12 §3), 남은 목록을 반환한다 */
  onClearRecent: () => RecentEndpoint[];
  /** 고정 토글 — 부모가 저장 + 로컬 상태 in-place 교체(화면 재정렬 금지) */
  onTogglePinRecent: (e: RecentEndpoint, pinned: boolean) => void;
  tRecent: ReturnType<typeof useTranslations<"recent">>;
}) {
  const inputId = useId();
  const bilingual = useBilingualName();
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<{
    places: Place[];
    addresses: JusoAddress[];
  } | null>(null);
  const reqRef = useRef(0);
  const geocodeRef = useRef(false);

  // 후보 도착 시 첫 후보로 포커스: 렌더 반영 뒤 이동(rAF 금지 — useEffect+focus가
  // repo 정본 패턴, 최근 장소 삭제 복원과 동형).
  const firstCandidateRef = useRef<HTMLButtonElement | null>(null);
  const candidateListRef = useRef<HTMLUListElement | null>(null);
  const [candidateRevision, setCandidateRevision] = useState(0);
  useEffect(() => {
    if (candidateRevision === 0) return;
    firstCandidateRef.current?.focus();
  }, [candidateRevision]);

  // 필드당 최신 5건만 표시(두 필드 동시 노출 노이즈 완충 — 스펙 §4). 저장은 필드별 20건.
  const visibleRecent = recentEndpoints.slice(0, 5);
  const recentDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const recentFocusIndexRef = useRef<number | null>(null);
  const [recentRevision, setRecentRevision] = useState(0);
  useEffect(() => {
    const idx = recentFocusIndexRef.current;
    if (idx === null) return;
    recentFocusIndexRef.current = null;
    recentDeleteRefs.current[idx]?.focus();
  }, [recentRevision]);

  function deleteRecent(e: RecentEndpoint, index: number) {
    const next = onDeleteRecent(e);
    announce(tRecent("deleted"));
    const visibleCount = Math.min(next.length, 5);
    if (visibleCount === 0) {
      inputRef.current?.focus();
      return;
    }
    recentFocusIndexRef.current = Math.min(index, visibleCount - 1);
    setRecentRevision((r) => r + 1);
  }

  /** 고정 토글(스펙 2026-08-12 §4): 저장·상태는 부모, 통지는 이 필드의 채널로.
   *  항목명 포함 — 연속 고정 시 동일 문자열 bail out 침묵 방지(PlaceSearch 동형). */
  function togglePinRecent(e: RecentEndpoint) {
    const pinned = !e.pinned;
    onTogglePinRecent(e, pinned);
    announce(tRecent(pinned ? "pinnedItem" : "unpinnedItem", { name: e.label }));
  }

  function clearRecent() {
    const kept = onClearRecent();
    if (kept.length === 0) {
      // 전체 삭제 버튼도 함께 사라진다 — 제거 전 입력으로 선점 이동(§5).
      inputRef.current?.focus();
      announce(tRecent("cleared"));
    } else {
      // 고정이 남아 섹션·버튼이 그대로다 — 포커스 무이동.
      announce(tRecent("clearedExceptPinned"));
    }
  }

  // queryOverride: 음성 전사 자동 검색용 — setState(field.text) 반영을 기다리지 않고
  // 전사 원문으로 즉시 검색한다(타이핑 경로는 인자 없이 field.text 사용).
  async function runCandidateSearch(queryOverride?: string) {
    const q = (queryOverride ?? field.text).trim();
    if (!q) return;
    const myId = ++reqRef.current;
    const [placesRes, addrRes] = await Promise.allSettled([
      fetch(
        `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}`,
      ).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PlaceSearchResult;
      }),
      fetch(`/api/address/search?query=${encodeURIComponent(q)}`).then(
        async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { addresses: JusoAddress[] };
        },
      ),
    ]);
    if (myId !== reqRef.current) return;
    // 미니 검색은 필드 확정용이라 상위 5건씩만(전체 탐색은 홈 검색이 담당).
    const places =
      placesRes.status === "fulfilled"
        ? placesRes.value.places.slice(0, 5)
        : [];
    const addresses =
      addrRes.status === "fulfilled"
        ? addrRes.value.addresses.slice(0, 5)
        : [];
    // 재검색이 이전 후보 리스트를 갈아치우는데 포커스가 그 안에 있으면(첫 후보
    // 자동 포커스 이후 재검색), 제거 전에 입력으로 선점 이동 — 0건·오류로 새 첫
    // 후보가 없을 때 포커스가 body로 소실되는 창을 막는다.
    if (candidateListRef.current?.contains(document.activeElement)) {
      inputRef.current?.focus();
    }
    setCandidates({ places, addresses });
    const count = places.length + addresses.length;
    if (count > 0) {
      announce(t("candidateCount", { count }));
      setCandidateRevision((r) => r + 1);
    } else if (
      placesRes.status === "rejected" &&
      addrRes.status === "rejected"
    ) {
      // 3-state: "0건"과 "조회 실패"를 뭉개지 않는다(양쪽 다 실패했을 때만 오류).
      announce(t("candidateError"));
    } else {
      announce(t("candidateNone"));
    }
  }

  // 음성 전사 결과(F-C, 메인 검색과 동형): 전사를 필드에 넣고 즉시 후보 검색.
  // 전사 원문을 polite 통지(접근성 헌장 "받아쓰기 완료" — 원문이라 i18n 무관)하고,
  // 후보 수·오류 통지는 runCandidateSearch 완료가 같은 채널로 이어받는다.
  function handleTranscribed(text: string) {
    // 후행 마침표 제거(PlaceSearch 동형). 출발·도착 후보는 주소 검색 비중이 높아
    // 마침표 한 글자에 juso가 0건으로 전멸한다(normalizeVoiceQuery 주석의 실측).
    const query = normalizeVoiceQuery(text);
    onTextChange(query);
    setCandidates(null);
    announce(query);
    void runCandidateSearch(query);
  }

  function resolveAndClose(ep: DirEndpoint) {
    // 후보 리스트 제거 전에 다음 흐름 컨트롤로 포커스 선점 이동(포커스 유실 방지).
    if (focusAfterResolve) focusAfterResolve();
    else inputRef.current?.focus();
    setCandidates(null);
    onResolve(ep);
  }

  async function selectAddress(addr: JusoAddress) {
    if (geocodeRef.current) return;
    geocodeRef.current = true;
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const r = await resolveAddressCoord(target);
      if (r.kind !== "resolved") {
        announce(t("coordError"));
        return;
      }
      resolveAndClose({
        kind: "place",
        label: target,
        coord: { lat: r.lat, lng: r.lng },
      });
    } finally {
      geocodeRef.current = false;
    }
  }

  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={inputId}
          ref={(el) => {
            inputRef.current = el;
            registerInput?.(el);
          }}
          type="text"
          value={field.text}
          onChange={(e) => {
            onTextChange(e.target.value);
            // 옛 질의의 후보가 남지 않게 편집 즉시 비운다(포커스는 입력에 있어 안전).
            setCandidates(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runCandidateSearch();
          }}
          className="min-h-11 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {/* 음성은 1급 시민 — 탭 순서 [입력][음성][검색](SearchBar 동형). 오류 통지는
            버튼 내부 announcer가 담당(부모 notice와 채널 분리 없음 문제 아님 — 오류 전용). */}
        <VoiceRecordButton onTranscribed={handleTranscribed} />
        <button
          type="button"
          onClick={() => void runCandidateSearch()}
          className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
        >
          {searchLabel}
        </button>
      </div>
      {onUseCurrent && (
        <button
          type="button"
          aria-disabled={useCurrentBusy}
          onClick={() => {
            if (useCurrentBusy) return;
            setCandidates(null);
            onUseCurrent();
          }}
          className="mt-1 min-h-11 text-sm text-blue-700 underline dark:text-blue-300"
        >
          {useCurrentBusy ? t("refreshingCurrent") : t("useCurrentLocation")}
        </button>
      )}
      {candidates &&
        (candidates.places.length > 0 || candidates.addresses.length > 0) && (
          <ul ref={candidateListRef} className="mt-1">
            {/* 장소 후보: 비-ko는 이름이 로마자(E28)이고 한글은 버튼 이름의 마지막 노드(R1). 주소는
                한국어 원문이라 접근 텍스트에 한글이 남으면 줄 전체 lang=ko(R4, NightClinics 선례).
                확정 라벨(`label`)은 종전대로 원명이다 — 병기는 후보 목록의 표시 층에만 있다. */}
            {candidates.places.map((p, i) => {
              const name = bilingual(p.name, { roman: p.nameRoman });
              const text = joinText(name.primary, p.roadAddress || p.address);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    ref={i === 0 ? firstCandidateRef : undefined}
                    onClick={() =>
                      resolveAndClose({
                        kind: "place",
                        label: p.name,
                        coord: { lat: p.lat, lng: p.lng },
                      })
                    }
                    className="min-h-11 w-full text-left text-sm underline"
                    lang={langFor(text)}
                  >
                    {text}
                    <KoTail secondary={name.secondary} />
                  </button>
                </li>
              );
            })}
            {/* 주소 후보: juso 공식 영문 주소(`engAddr`)가 원천이라 로마자보다 앞선다. */}
            {candidates.addresses.map((a, i) => {
              const name = bilingual(a.roadAddr, { en: a.engAddr });
              return (
                <li key={a.roadAddr}>
                  <button
                    type="button"
                    ref={
                      candidates.places.length === 0 && i === 0
                        ? firstCandidateRef
                        : undefined
                    }
                    onClick={() => void selectAddress(a)}
                    className="min-h-11 w-full text-left text-sm underline"
                    lang={langFor(name.primary)}
                  >
                    {name.primary}
                    <KoTail secondary={name.secondary} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      {/* 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만. 조용히 나타나는 목록이라
          heading이 발견 경로(h3 — 뷰 제목 h2 아래 관례). 출발지·도착지 두 필드가 동시에
          노출될 수 있어 필드명을 헤딩에 포함(titleFor) — 동일 텍스트 헤딩 중복 방지
          (리뷰 확정 2026-07-26). 선택은 확정 공용 경로 재사용. */}
      {candidates === null && visibleRecent.length > 0 && (
        <section className="mt-2">
          <h3 className="text-sm font-semibold">
            {tRecent("titleFor", { field: label })}
          </h3>
          <ul className="mt-1">
            {visibleRecent.map((e, i) => (
              <li key={`${e.lat},${e.lng}`} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    resolveAndClose({
                      kind: "place",
                      label: e.label,
                      coord: { lat: e.lat, lng: e.lng },
                    })
                  }
                  className="min-h-11 flex-1 text-left text-sm underline"
                >
                  {/* 고정 항목은 라벨 접미사 하나로 시각·낭독 동시 전달(한 줄 = 한 객체) */}
                  {e.pinned ? joinText(e.label, tRecent("pinned")) : e.label}
                </button>
                {/* 고정이 삭제보다 앞(위원장 지시 2026-08-12) */}
                <button
                  type="button"
                  aria-label={tRecent(e.pinned ? "unpinItem" : "pinItem", {
                    name: e.label,
                  })}
                  onClick={() => togglePinRecent(e)}
                  className="min-h-11 rounded-md border border-border px-3 text-sm"
                >
                  {tRecent(e.pinned ? "unpin" : "pin")}
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    recentDeleteRefs.current[i] = el;
                  }}
                  aria-label={tRecent("deleteItem", { name: e.label })}
                  onClick={() => deleteRecent(e, i)}
                  className="min-h-11 rounded-md border border-border px-3 text-sm"
                >
                  {tRecent("delete")}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={clearRecent}
            className="mt-1 min-h-11 text-sm underline"
          >
            {tRecent("clearAll")}
          </button>
        </section>
      )}
    </div>
  );
}
