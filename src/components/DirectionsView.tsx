"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowUpDown, MapPinPlus } from "lucide-react";
import type {
  CarRouteBriefing,
  Coord,
  JusoAddress,
  Place,
  PlaceSearchResult,
  TransitLeg,
  TransitRoute,
  TransitRouteResult as TransitData,
  WalkRouteBriefing,
} from "@/lib/types";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import { parseDir, serializeDir, type DirEndpoint } from "@/lib/directions-state";
import {
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS,
  getGeolocationSnapshot,
} from "@/lib/geolocation";
import { awaitEffectiveLocation } from "@/lib/effective-location";
import { useManualLocation, useManualLocationLabel } from "@/hooks/useManualLocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { durationToMinutes, formatDistance, joinText, normalizeVoiceQuery } from "@/lib/format";
import { objectParticle } from "@/lib/korean-particle";
import { alternativeNameKey } from "@/lib/transit-alternative-name";
import { shouldCollapseWalk } from "@/lib/walk-collapse";
import { orderDirectionsModes, type DirectionsModeKey } from "@/lib/directions-order";
import { walkRouteUrl } from "@/lib/walk-route-url";
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
import { clearRetainedGuideSnapshot, stopActiveGuideSession } from "@/lib/guide-session-store";
import { quickExitText } from "@/lib/quick-exit-text";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import { buildDirectionsTools } from "@/lib/webmcp/tools";
import { guideTriggerValue } from "@/lib/webmcp/tools/start-guidance";
import type {
  DirectionsBridge,
  DirectionsSnapshot,
  ModeOutcomeKind,
  PlanRequest,
  PlanTransitRoute,
  QueryOutcome,
  ToolPlan,
} from "@/lib/webmcp/tools/context";
import {
  buildRouteRefTable,
  FOCUS_TARGET_ATTR,
  targetId,
  type ParsedTarget,
} from "@/lib/webmcp/targets";
import { DistanceBeacon } from "./DistanceBeacon";
import { TransitGuidePanel } from "./TransitGuidePanel";
import { buildTransitGuideRoute } from "@/lib/transit-guide";
import { VoiceRecordButton } from "./VoiceRecordButton";

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
   * 도보는 `alternatives=1`의 `{ result, shortest }` 쌍(B9 ①). `shortest`는 최단 실패
   * 흡수·Tmap 키 부재(필드 부재)·null 전부 null — 행동이 같다(최단 행을 그리지 않는다).
   * ⚠ 생략 불가 필드: 추천·최단은 **같은 응답에서 온 쌍만** 그린다(스냅샷 교체).
   */
  | { kind: "done"; mode: "walk"; result: WalkRouteBriefing; shortest: WalkRouteBriefing | null }
  | { kind: "done"; mode: "car"; result: CarRouteBriefing };

type QueryResults = {
  /** 조회 시점의 도착 표시명(대중교통 "도착" 문장용), 필드 편집과 무관한 스냅샷 */
  destLabel: string;
  /** 조회 시점의 도착 좌표 스냅샷 — 실시간 안내 진입점의 목적지(렌더 중 ref 접근 금지). */
  destCoord: Coord;
  outcomes: Partial<Record<ModeKey, ModeOutcome>>;
  /** 조회 시점의 경유지 라벨(결과 구획 "경유지 C 도착"용, N4). 없으면 null. */
  viaLabel: string | null;
  /**
   * 표시 순서 스냅샷(spec 2026-08-12 §2) — settled 커밋 시 1회 확정.
   * 계단 회피 토글은 outcomes.walk만 교체하므로 순서는 자동 불변이다.
   */
  orderedModes: ModeKey[];
  /**
   * 출발지가 "현재 위치"였을 때 그 좌표의 출처. `from`이 특정 장소면 null(실시간
   * 안내는 항상 실좌표에서 시작하므로 이 브리핑의 출발지 출처와 무관하다).
   * "manual"이면 이 브리핑은 지정 위치 기준이지만, 실시간 안내 시작은 실좌표를
   * 다시 조회한다 — 두 출발지가 달라질 수 있음을 안내 시작 버튼 근처에서 말한다.
   */
  originSource: "gps" | "manual" | null;
  /**
   * 세대 토큰(WebMCP spec §3.4) — settled 커밋마다 `p{gen}`. 계단 회피 토글 재조회도 새
   * 값이다(결과 객체가 바뀐다). 도구는 이 값으로 옛 결과 참조를 `stalePlan`으로 거른다.
   */
  planId: string;
  /** 조회 시점의 출발·도착 입력 라벨(도구 `resolved` — 승격본이 아니라 원명). */
  fromLabel: string;
  toLabel: string;
  /** 조회 시점의 계단 회피 설정. */
  avoidStairs: boolean;
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
 * `?walkAccessible=1` 복원값을 렌더 시점에 동기로 읽는다(SSR엔 window가 없어
 * false 폴백). useEffect+queueMicrotask로 하면 아래 `dir` 동기화 effect가 같은
 * 커밋에서 먼저 동기 실행되며 이 파라미터를 URL에서 지워버린 뒤에야 microtask가
 * 읽으므로 항상 실패한다(리뷰 발견 회귀) — lazy useState 초기화로 그 경쟁을 없앤다.
 */
function readWalkAccessibleFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("walkAccessible") === "1";
}

/**
 * `?dir=`의 세 번째 토막(경유지, N4)을 렌더 시점에 동기로 읽는다(`readWalkAccessibleFromUrl`
 * 동형 — `dir` 동기화 effect가 같은 커밋에서 URL을 다시 쓰기 전에 읽어야 한다).
 * `PlaceSearch`의 `initialFrom/To` 경로를 넓히지 않는 이유: 그 경로는 from·to만 나르고,
 * 경유지는 이 뷰의 관심사라 여기서 닫는다.
 */
function readViaFromUrl(): DirEndpoint | null {
  if (typeof window === "undefined") return null;
  return parseDir(new URLSearchParams(window.location.search).get("dir"))?.via ?? null;
}

/**
 * 좌표 → 대표 주소 문자열("현재 위치" 라벨 병기용). 주소는 부가 정보이므로
 * 매칭 없음·실패 모두 조용히 null(3-state: 라벨은 "현재 위치"만 남아 거짓 표시 없음).
 */
async function fetchCurrentAddress(coord: Coord): Promise<string | null> {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${coord.lat}&lng=${coord.lng}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { address: string | null };
    return body.address;
  } catch {
    return null;
  }
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
   * 계단 회피(도보 전용). ⚠ **선택 인자로 두지 않는다** — A4가 생략 가능한 안전
   * 인자에서 나왔다(spec §2.5). 도보가 아닌 수단은 `false`를 명시한다.
   */
  walkAccessible: boolean,
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
  // 도보는 추천·최단 쌍을 한 조회로 받는다(`alternatives=1`, B9 ①). `walkRouteUrl`의
  // 인자(안전 인자 전부 required)에 올리지 않고 여기서 덧붙인다 — 브리핑 화면만 쓰는
  // 옵트인이고, 실시간 안내(`includeGeometry=1`)와 조합하면 서버 400이다.
  const url =
    mode === "walk"
      ? `${walkRouteUrl({ origin, dest, accessible: walkAccessible, includeGeometry: false, via, lang })}&alternatives=1`
      : `/api/route/transit?${qs}&includeStops=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return { kind: "error" };
  const body = (await res.json()) as { result: unknown; shortest?: unknown };
  if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
  if (!body.result) return { kind: "empty" };
  return mode === "transit"
    ? { kind: "done", mode, result: body.result as TransitData }
    : {
        kind: "done",
        mode,
        result: body.result as WalkRouteBriefing,
        shortest: (body.shortest as WalkRouteBriefing | null | undefined) ?? null,
      };
}

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
  initialToText = null,
  onBack,
}: {
  canShowWalk: boolean;
  canShowTransit: boolean;
  canBriefCarRoute: boolean;
  initialFrom?: DirEndpoint;
  initialTo?: DirEndpoint | null;
  /**
   * 도착지 **텍스트만** 미리 채운다(WebMCP `open_directions` — 해석·조회는 `plan_directions`의
   * 몫). `initialTo`가 있으면 그쪽이 이긴다.
   */
  initialToText?: string | null;
  onBack: () => void;
}) {
  const t = useTranslations("directions");
  const tRoute = useTranslations("route");
  const tTransit = useTranslations("route.transit");
  const tPed = useTranslations("route.pedestrian");
  const tCar = useTranslations("route.briefing");
  const tCommon = useTranslations("common");
  const tBeacon = useTranslations("beacon");
  const tManual = useTranslations("manualLocation");
  const locale = useLocale();
  const manual = useManualLocation();
  // 검증 가능/불가 판정은 표시줄과 한 훅을 공유한다(판정선이 갈리면 화면으로 확인 불가).
  const manualLabel = useManualLocationLabel();

  // "현재 위치" 라벨에 병기할 역지오코딩 주소(F-B). null=주소 미확보(라벨은 기본
  // "현재 위치"만 — 시각으로 위치 오차를 확인할 수 없는 사용자를 위한 병기이므로
  // 모르면 거짓 표시 대신 생략).
  const [currentAddress, setCurrentAddress] = useState<string | null>(null);
  // "현재 위치 사용" 강제 재측위 진행 신호(버튼 라벨 전환용) + 재진입 ref 가드.
  const [refreshingCurrent, setRefreshingCurrent] = useState(false);
  const refreshCurrentRef = useRef(false);
  // 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다(LocationBar와 동형 —
  // GPS가 알아낸 위치와 사용자가 지정한 위치는 다른 것이고 시각장애 사용자는 화면으로
  // 구분할 수 없다). 수동 위치가 이기므로 GPS 역지오코딩 주소(currentAddress)는
  // 무시한다 — 아래에서도 수동 위치 활성 중엔 그 주소를 아예 조회하지 않는다.
  const currentLabel =
    manualLabel ??
    (currentAddress ? t("currentLocationNear", { address: currentAddress }) : t("currentLocation"));
  const [fromField, setFromField] = useState<FieldState>(() =>
    endpointToField(initialFrom ?? { kind: "current" }, currentLabel),
  );
  const [toField, setToField] = useState<FieldState>(() =>
    initialTo
      ? endpointToField(initialTo, currentLabel)
      : { text: initialToText ?? "", resolved: null },
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
   * 도보 상세 펼침 상태. null = 자동(문턱 판정), boolean = 사용자 조작.
   * 사용자 조작이 자동 판정을 이긴다: 계단 회피로 경로가 바뀌며 문턱을
   * 넘나들 때 펼쳐 둔 것이 닫히면 조작이 배신당한다.
   */
  const [walkExpanded, setWalkExpanded] = useState<boolean | null>(null);
  // 최단 행 펼침(B9 ①). 기본 접힘이라 null 3-state가 필요 없고, 리셋은 walkExpanded와
  // 같은 자리(resetWalkExpansion)에서 함께 — 스냅샷 교체 시 이전 세대의 펼침이 남지 않게.
  const [walkShortestExpanded, setWalkShortestExpanded] = useState(false);
  /** 결과 폐기·새 조회 시 도보 両행 펼침을 함께 되돌린다(한쪽만 되돌리면 다음 세대 최단 행이 펼쳐진 채 나온다). */
  function resetWalkExpansion() {
    setWalkExpanded(null);
    setWalkShortestExpanded(false);
  }
  /**
   * 결과 폐기 한 곳(편집·스왑·경유지 조작·새 조회 공용). 끝난 안내 세션이 남긴 `done`·`failed`
   * 스냅샷도 여기서 지운다 — 화면이 그 상태를 지우는 시점이 곧 도구가 그것을 잊는 시점이다
   * (WebMCP spec §5.2).
   */
  function discardResults() {
    setResults(null);
    setToggledRoutes(new Set());
    setActiveGuideAlt(null);
    resetWalkExpansion();
    clearRetainedGuideSnapshot();
  }
  // 후보 검색 등 폼 보조 통지: phase 파생 문구보다 우선하는 최근 1건.
  const [notice, setNotice] = useState("");

  // 계단 회피(도보 전용) 토글. 초기값은 `?walkAccessible=1`(위 lazy 초기화 참고).
  // ⚠ **비-ko에서는 무조건 꺼진 상태로 시작한다**(리뷰 검출): 토글은 숨겨 두는데
  // `?walkAccessible=1`이 실린 URL을 en으로 열면 상태만 살아남아 매 조회에 실리고,
  // 서버가 "Step-free routing is unavailable…"을 스텝 0으로 삽입한다 — 끌 수단이 화면에 없다.
  const stepFreeSupported = !prefersEnglish(locale);
  const [stepFreeEnabled, setStepFreeEnabledState] = useState(
    () => stepFreeSupported && readWalkAccessibleFromUrl(),
  );
  // ref는 비동기 콜백에서 "최신" 상태를 동기로 읽기 위함(state는 렌더 시점 클로저라
  // async 함수 안에서 못 씀). 초기값은 위 state와 같은 렌더에서 이미 확정됐으니
  // 함수를 다시 부르지 않고 그대로 물려받는다.
  const stepFreeRef = useRef(stepFreeEnabled);
  function setStepFreeEnabled(v: boolean) {
    stepFreeRef.current = v;
    setStepFreeEnabledState(v);
  }
  // 마지막 전체 조회에 실제로 쓰인 좌표(토글 단독 재조회가 같은 좌표를 재사용).
  const lastCoordsRef = useRef<{ origin: Coord; dest: Coord; via: Coord | null } | null>(null);
  // 토글 단독 재조회 진행 신호(버튼 aria-busy 표시용, "조회" 버튼과 동일 패턴).
  const [stepFreeBusy, setStepFreeBusy] = useState(false);

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

  // 프리필 도착지(장소 상세 "여기까지 길찾기")도 확정 경로와 동일하게 도착지 기록(마운트 1회).
  // ?dir= 복원의 재기록은 dedupe 끌어올림이라 무해.
  const recordedInitialRef = useRef(false);
  useEffect(() => {
    if (recordedInitialRef.current) return;
    recordedInitialRef.current = true;
    if (initialTo?.kind === "place") {
      const ep = initialTo;
      queueMicrotask(() =>
        setRecentTo(
          recordRecentEndpoint("to", {
            label: ep.label,
            lat: ep.coord.lat,
            lng: ep.coord.lng,
          }),
        ),
      );
    }
  }, [initialTo]);

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
      clearRetainedGuideSnapshot();
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

  // 뷰 진입 시 제목으로 포커스(장소 상세와 동형), 새 화면 맥락 통지.
  useEffect(() => {
    titleRef.current?.focus();
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
    // 계단 회피 토큰은 켜짐일 때만(꺼짐=기본이라 URL에 남길 정보가 없다).
    if (stepFreeEnabled) url.searchParams.set("walkAccessible", "1");
    else url.searchParams.delete("walkAccessible");
    window.history.replaceState(window.history.state, "", url);
    // LanguageSwitcher가 쿼리 변경을 href에 반영하도록 통지(?q= 동기화와 동형).
    window.dispatchEvent(new Event("gildongmu:locationchange"));
  }, [fromField.resolved, toField.resolved, viaField?.resolved, stepFreeEnabled]);

  // 현재 위치 필드의 표시 텍스트는 확정 시점 스냅샷이 아니라 파생 라벨을 쓴다
  // (주소 병기·새로고침이 라벨에 즉시 반영, 편집 시작 시엔 resolved가 풀려 원문 유지).
  const displayField = (field: FieldState): FieldState =>
    field.resolved?.kind === "current" ? { ...field, text: currentLabel } : field;

  // 이미 위치가 허용·확보된 세션에서만 조용히 주소를 병기한다(뷰 진입만으로 권한
  // 팝업·재측위 금지 — 스토어의 ready 캐시 좌표만 읽는다). 미확보면 라벨은 "현재
  // 위치" 그대로(주소 없음=정보 없음). 수동 위치가 켜져 있으면 이 GPS 역지오코딩은
  // 애초에 표시되지 않을 라벨을 위해 실좌표를 조회하는 낭비이므로 건너뛴다.
  const addrLoadedRef = useRef(false);
  useEffect(() => {
    if (addrLoadedRef.current) return;
    if (manual) return;
    const isCurrent =
      fromField.resolved?.kind === "current" ||
      toField.resolved?.kind === "current";
    if (!isCurrent) return;
    const geo = getGeolocationSnapshot();
    if (geo.status !== "ready") return;
    addrLoadedRef.current = true;
    void fetchCurrentAddress(geo.coords).then(setCurrentAddress);
  }, [fromField.resolved, toField.resolved, manual]);

  /**
   * "현재 위치" 재선택(F-B) = 강제 재측위 + 주소 새로고침. 갱신 신호는 라벨(주소)의
   * 변화 자체이고 진행 신호는 해당 버튼의 라벨 전환뿐(별도 통지 중복 금지).
   * 재측위 실패 시 직전 주소를 유지한다(새로고침=재조회이지 데이터 포기 아님).
   */
  async function selectCurrentFrom() {
    setFromField(endpointToField({ kind: "current" }, currentLabel));
    if (refreshCurrentRef.current) return;
    refreshCurrentRef.current = true;
    setRefreshingCurrent(true);
    try {
      // force:true는 수동 위치가 있어도 판정을 동반한다(이동했으면 GPS로 복귀).
      const effective = await awaitEffectiveLocation({ force: true });
      // gps일 때만 역지오코딩 — manual이면 라벨은 이미 지정 이름을 쓰고 있다.
      if (effective && effective.source === "gps") {
        addrLoadedRef.current = true;
        setCurrentAddress(
          await fetchCurrentAddress({ lat: effective.lat, lng: effective.lng }),
        );
      }
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
    setNotice(stopped ? tBeacon("stopped") : "");
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
    setNotice("");
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
      if (stoppedGuide) setNotice(tBeacon("stopped"));
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
      let originSource: "gps" | "manual" | null = null;
      if (from.kind === "current" || to.kind === "current") {
        setPhase({ kind: "locating" });
        const effective = await awaitEffectiveLocation({
          force: false,
          maxAgeSeconds: DIRECTIONS_ORIGIN_MAX_AGE_SECONDS,
        });
        if (myGen !== genRef.current) return;
        if (!effective) {
          setNotice(""); // 중지 통지가 종단 phase 통지를 가리지 않게
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
          setNotice("");
          setPhase({ kind: "outOfCoverage" });
          settleAfterCommit(myGen, { kind: "outOfCoverage" });
          return;
        }
        cur = { lat: effective.lat, lng: effective.lng };
        if (from.kind === "current") originSource = effective.source;
        // gps일 때만 라벨 병기 주소를 동기화한다(표시 전용 fire-and-forget, 실패·
        // 매칭 없음은 null로 정직하게 비운다). manual은 이미 지정 이름을 쓰고
        // 있어 표시되지 않을 라벨을 위해 실좌표를 조회하는 낭비를 만들지 않는다.
        if (effective.source === "gps") {
          addrLoadedRef.current = true;
          void fetchCurrentAddress(cur).then(setCurrentAddress);
        }
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
      lastCoordsRef.current = { origin, dest, via };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled(
        activeModes.map((m) =>
          fetchMode(m, origin, dest, dataLocale(locale), ctrl.signal, stepFreeRef.current, via),
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
        setNotice("");
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
          ? walkOutcome.result.durationSeconds
          : null,
      );
      const planId = `p${myGen}`;
      setResults({
        destLabel,
        destCoord: dest,
        outcomes,
        viaLabel,
        orderedModes,
        originSource,
        planId,
        fromLabel: from.kind === "current" ? currentLabel : from.label,
        toLabel: to.kind === "current" ? currentLabel : to.label,
        avoidStairs: stepFreeRef.current,
      });
      setNotice(""); // 중지 통지 해제 — settled 합산 통지가 이 커밋에서 발화된다
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

  /**
   * 계단 회피 토글: 이미 조회된 결과가 있으면 도보만 새 상태로 재조회하고
   * (대중교통·자동차 결과는 그대로 유지), 아직 조회 전이면 상태만 바꿔 다음
   * "조회"에 반영한다(재조회 대상이 없어 가드도 불필요).
   * 재조회 가드는 "조회" 버튼과 **같은** `inFlight`/`genRef`를 공유한다 —
   * 별도 ref를 두면 토글끼리의 연타만 막고 "조회"와의 교차 레이스는 못 막는데,
   * 공유하면 이 뷰에서 도보 재조회(토글이든 전체 조회든)는 항상 하나만 진행되어
   * 교차 레이스 자체가 구조적으로 불가능해진다(연타 시 재호출은 즉시 무시).
   */
  async function toggleStepFree() {
    // 가드를 맨 위에 둔다(향후 토글 위치가 바뀌어도 상태-요청 불일치를 예방).
    if (inFlight.current) return;
    const coords = lastCoordsRef.current;
    if (!results || !coords) {
      setStepFreeEnabled(!stepFreeRef.current);
      return;
    }
    const next = !stepFreeRef.current;
    setStepFreeEnabled(next);
    inFlight.current = true;
    setStepFreeBusy(true);
    const myGen = ++genRef.current;
    supersedeWaiter(myGen);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled([
        fetchMode("walk", coords.origin, coords.dest, dataLocale(locale), ctrl.signal, next, coords.via),
      ]);
      clearTimeout(timer);
      const s = settled[0];
      // lastCoordsRef는 이미 outOfCoverage 검증을 통과한 좌표라 이 토글 재조회에서
      // 서버 마커가 다시 뜰 일은 사실상 없다 — 그래도 도달 시 빈 렌더 대신 오류로
      // 안내한다(walk 섹션의 outcome 스위치가 outOfCoverage 분기를 갖지 않으므로).
      const outcome: ModeOutcome =
        s.status === "fulfilled"
          ? s.value.kind === "outOfCoverage"
            ? { kind: "error" }
            : s.value
          : { kind: "error" };
      // 결과 객체가 바뀌므로 새 세대 토큰이다(WebMCP spec §3.4).
      setResults((prev) =>
        prev
          ? { ...prev, outcomes: { ...prev.outcomes, walk: outcome }, planId: `p${myGen}`, avoidStairs: next }
          : prev,
      );
      walkHeadingRef.current?.focus();
    } finally {
      if (myGen === genRef.current) inFlight.current = false;
      setStepFreeBusy(false);
    }
  }

  // stepFreeBusy 포함: 토글 재조회 진행 중(inFlight 공유)에도 "조회" 버튼이 같은
  // 시각·aria 신호를 내야 한다 — 안 그러면 그 15초 창에서 버튼이 멀쩡해 보이는데
  // 클릭이 무시돼(runQuery 첫 줄 가드) 스크린 리더 사용자가 멈춤으로 오인한다.
  const busy =
    phase.kind === "locating" || phase.kind === "loading" || stepFreeBusy;
  // 요약 수치는 저장하지 않고 results에서 파생한다(A8 + 독립 리뷰 2026-08-11) —
  // phase에 successCount를 들고 다니면 outcomes만 바꾸는 경로(계단 회피 토글)마다
  // 동기화가 필요하고, 편집 경로가 results를 리셋하는 15초 창에서 낡은 클로저로
  // 커밋되는 상태 불일치가 재발한다. 낭독되는 수치라 시각으로 반증되지 않으므로
  // 진실원을 하나(results.outcomes)로 줄이는 것이 수정이다. settled인데 results가
  // 없으면(재조회 중 편집으로 리셋) 요약도 없다 — 없는 경로를 세지 않는다.
  const settledCount = results
    ? results.orderedModes.filter((m) => results.outcomes[m]?.kind === "done").length
    : null;
  const settledSummary =
    phase.kind === "settled" && settledCount !== null
      ? settledCount > 0
        ? t("readySummary", { count: settledCount })
        : t("allFailed")
      : "";
  const phaseMessage =
    phase.kind === "settled"
      ? settledSummary
      : phase.kind === "idle"
        ? ""
        : phase.kind === "outOfCoverage"
          ? tCommon("outOfCoverage")
          : t(phase.kind);
  const liveMessage = notice || phaseMessage;

  // 안내 시작의 직접 응답: 이 결과가 수동 위치에서 계산됐다면 "현재 위치에서
  // 시작한다"를 그 순간에만 말한다(spec 2026-08-09 §4 "안내 시작 통지").
  // 조회 결과 화면에 상시 고지로 두지 않는 이유 — 그 정보로 갈리는 행동은 안내
  // 시작뿐이라, 안내를 시작하지 않는 사용자(실내에서 미리 경로만 듣는 수동 위치의
  // 주 용도)에겐 매 조회마다 지나가야 하는 잡음이었다(위원장 판정 2026-08-17).
  // BeaconModel/useRouteGuide는 여전히 실좌표만 쓰므로(소스 가드) 차단이 아니라 고지다.
  // ⚠ 같은 문장 재대입은 DOM이 안 바뀌어 침묵한다(시작→중지→재시작). 빈 값을 거치면
  // 그 틈에 phaseMessage 폴백이 잠깐 노출되므로, 대신 live region 안 텍스트 노드를
  // key로 갈아 끼워 "추가"로 게시한다(같은 문장이라도 새 노드는 additions 통지).
  const [noticeSeq, setNoticeSeq] = useState(0);
  function announceGuideStart() {
    if (results?.originSource !== "manual") return;
    setNotice(tManual("guideStartsFromCurrent"));
    setNoticeSeq((n) => n + 1);
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
  // 경유지 조회(N4 spec §3)에서는 어떤 안내도 시작하지 않는다 — 안내 훅이 출발지→도착지로
  // 자기 조회를 다시 해 경유지가 조용히 빠진 경로를 안내하게 되고, 간략 폴백(직선거리)도
  // 목적지만 본다. 버튼 부재가 정직하다. 경유지 안내는 iOS 실보행 판정 뒤 웹에 얹는다.
  const hasVia = results?.viaLabel != null;
  // 도보 상세 안내는 전 로케일에서 시작할 수 있다(E16 축3) — 문장을 서버가 만든다.
  const walkGuideStartable = results?.outcomes.walk?.kind === "done" && !hasVia;
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
  /** 추천·대안을 한 목록으로(이름 산출은 채팅 카드와 공유 — `alternativeNameKey`). */
  function transitEntries(result: TransitData): Array<{ route: TransitRoute; name: string; defaultExpanded: boolean }> {
    return [
      // 1순위는 축 라벨을 갖지 않는다(annotateHighlights: "자기보다 나은 자기는 없다") — 고정 이름.
      { route: result.recommended, name: tTransit("recommended"), defaultExpanded: true },
      ...result.alternatives.map((alt) => {
        const named = alternativeNameKey(alt);
        return { route: alt, name: tTransit(named.key, named.values), defaultExpanded: false };
      }),
    ];
  }
  /**
   * WebMCP 도구 계획(spec §3.4·§8.3) — 화면 상태(`results`)에서 **같은 i18n 키**로 조립한 투영.
   * leg 한 줄은 화면 leg 문장의 평문판(`t.markup`), 스텝은 화면 `StepList`와 같은 배열이다.
   * 렌더마다 다시 만들지만 `planId`가 세대를 대표하므로 객체 정체성은 계약이 아니다.
   */
  const kindOf = (o: ModeOutcome): ModeOutcomeKind => (o.kind === "outOfCoverage" ? "error" : o.kind);
  function transitLegLine(leg: TransitLeg, boardSeen: number, destName: string): string {
    if (leg.mode === "walk") {
      const name = leg.toName ?? destName;
      const distance = leg.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
      const key = name
        ? distance
          ? "legWalkTo"
          : "legWalkToNoDistance"
        : distance
          ? "legWalkToDest"
          : "legWalkToDestNoDistance";
      return tTransit(key, {
        minutes: leg.minutes,
        ...(name ? { name } : {}),
        ...(distance ? { distance } : {}),
      });
    }
    const lineLabel =
      leg.mode === "bus" && leg.lineName ? tTransit("busNo", { route: leg.lineName }) : (leg.lineName ?? "");
    return tTransit.markup(boardSeen === 0 ? "legBoard" : "legTransfer", {
      line: () => lineLabel,
      from: () => leg.fromName ?? "",
      count: leg.stationCount ?? 0,
    });
  }
  // 경로 순번 표(착지·트리거 속성용)는 렌더에서, 문장 조립은 도구 호출 시점(`read()`)에 한다 —
  // 문장은 도구가 부를 때만 필요하고, 렌더마다 수십 문장을 만드는 비용을 치를 이유가 없다.
  const transitOutcomeNow = results?.outcomes.transit;
  const routeRefs = buildRouteRefTable(
    transitOutcomeNow?.kind === "done" && transitOutcomeNow.mode === "transit"
      ? [
          transitOutcomeNow.result.recommended.routeKey,
          ...transitOutcomeNow.result.alternatives.map((a) => a.routeKey),
        ]
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
      const legLines = route.legs.map((leg) => {
        const line = transitLegLine(leg, boardSeen, results.destLabel);
        if (leg.mode !== "walk") boardSeen += 1;
        return line;
      });
      return {
        routeKey: route.routeKey,
        routeRef: ref,
        name,
        oneLine: transitRouteLabel(route, name),
        highlight: route.highlight,
        startable: buildTransitGuideRoute(route) !== null && !prefersEnglish(locale),
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
            leg.mode !== "walk" ? (quickExitText(tTransit, leg.toName ?? "", leg.quickExit) ?? undefined) : undefined,
          targetId: targetId.transitLeg(ref, i + 1),
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
              summary: tPed("summary", {
                distance: formatDistance(walkOutcome.result.distanceMeters),
                minutes: Math.round(walkOutcome.result.durationSeconds / 60),
              }),
              distanceMeters: walkOutcome.result.distanceMeters,
              durationSeconds: walkOutcome.result.durationSeconds,
              stepFree: walkOutcome.result.stepFree ?? undefined,
              stepFreeNotice: walkOutcome.result.stepFreeNotice ?? undefined,
              // 화면 규칙과 같은 판정(아래 JSX): 최단 행이 있거나 접히는 길이면 고지 스텝을 뗀다.
              steps: walkStepItems(
                walkOutcome.result,
                Boolean(walkOutcome.shortest) || shouldCollapseWalk(walkOutcome.result.durationSeconds),
              ).items,
              startable: walkGuideStartable,
            }
          : { outcome: kindOf(walkOutcome), steps: [], startable: false };
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
        from: results.fromLabel,
        to: results.toLabel,
        via: results.viaLabel,
        avoidStairs: results.avoidStairs,
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
   * 경유지는 없음, 계단 회피는 요청값으로 한 번에 설정하고, 그 요청 스냅샷으로 정본 조회를
   * 돌린다. 완료는 세대 결박 대기자가 알린다. 조회 중이면 `busy`(reject-while-busy).
   */
  function runQueryForTool(request: PlanRequest, signal: AbortSignal): Promise<QueryOutcome> {
    if (inFlight.current) return Promise.resolve({ kind: "busy" });
    setFromField(endpointToField(request.from, currentLabel));
    setToField(endpointToField(request.to, currentLabel));
    setViaField(request.via ? endpointToField(request.via, currentLabel) : null);
    setStepFreeEnabled(stepFreeSupported && request.avoidStairs);
    const gen = genRef.current + 1;
    const onAbort = () => settleWaiter(gen, { kind: "aborted" });
    const promise = new Promise<QueryOutcome>((resolve) => {
      queryWaiterRef.current = { gen, resolve };
    });
    signal.addEventListener("abort", onAbort, { once: true });
    void runQuery({ from: request.from, to: request.to, via: request.via });
    return promise.finally(() => signal.removeEventListener("abort", onAbort));
  }
  /** `focus_item`·`start_guidance`가 접힌 대안·도보 상세를 화면 핸들러로 펼치는 길(spec §3.3 ③). */
  function ensureVisible(target: ParsedTarget) {
    if (target.scope !== "plan") return;
    if (target.kind === "transitRoute" || target.kind === "transitLeg") {
      const key = routeRefs.keyOf(target.routeRef);
      const transit = results?.outcomes.transit;
      if (!key || transit?.kind !== "done" || transit.mode !== "transit") return;
      const defaultExpanded = transit.result.recommended.routeKey === key;
      setToggledRoutes((prev) => {
        const flipped = prev.has(key);
        if ((flipped ? !defaultExpanded : defaultExpanded)) return prev;
        const nextSet = new Set(prev);
        if (flipped) nextSet.delete(key);
        else nextSet.add(key);
        return nextSet;
      });
      return;
    }
    if (target.kind === "step" && target.mode === "walk") setWalkExpanded(true);
  }
  const readSnapshot = (): DirectionsSnapshot => ({
    fields: {
      from: displayField(fromField).text,
      to: toField.text,
      via: viaField ? viaField.text : null,
      avoidStairs: stepFreeEnabled,
    },
    phase: phase.kind,
    plan: buildToolPlan(),
    lang: dataLocale(locale) === "ko" ? "ko" : "en",
  });
  // 도구 `execute`는 ref로 최신 화면을 읽는다(등록은 마운트 1회, 재등록 0 — spec §5.1).
  // ⚠ ref 갱신은 렌더가 아니라 effect에서(useRouteGuide 미러 관례 동형).
  const bridgeRef = useRef<DirectionsBridge>({ read: readSnapshot, runQuery: runQueryForTool, ensureVisible });
  useEffect(() => {
    bridgeRef.current = { read: readSnapshot, runQuery: runQueryForTool, ensureVisible };
  });
  // 종단 phase의 대기자 resolve — 브리지 갱신 effect 뒤에 두어야 도구가 커밋된 화면을 읽는다.
  useEffect(() => {
    const pending = pendingOutcomeRef.current;
    if (!pending) return;
    pendingOutcomeRef.current = null;
    settleWaiter(pending.gen, pending.outcome);
  });
  useWebMcpTools(
    () =>
      buildDirectionsTools({
        read: () => bridgeRef.current.read(),
        runQuery: (request, signal) => bridgeRef.current.runQuery(request, signal),
        ensureVisible: (target) => bridgeRef.current.ensureVisible(target),
      }),
    { enabled: true },
  );

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
    setNotice(tRecent("deleted"));
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
    setNotice(
      tRecent(pinned ? "pinnedItem" : "unpinnedItem", { name: routeItemLabel(r) }),
    );
  }
  function clearRoutes() {
    const kept = clearRecentRoutes();
    setRecentRoutes(kept);
    if (kept.length === 0) {
      setNotice(tRecentRoutes("cleared"));
      submitRef.current?.focus(); // 섹션 소멸 — 기존 계약
    } else {
      // 고정이 남아 섹션·버튼이 그대로다 — 포커스 무이동.
      setNotice(tRecent("clearedExceptPinned"));
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
        focusTargetId={targetId.field("from")}
        field={displayField(fromField)}
        onTextChange={(text) => {
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
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
        announce={setNotice}
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
        focusTargetId={targetId.field("to")}
        field={displayField(toField)}
        onTextChange={(text) => {
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
          setToField({ text, resolved: null });
          discardResults();
        }}
        onResolve={(ep) => {
          // 목적지 확정도 텍스트 변경과 같은 무효화 축(리뷰 MAJOR): "최근 장소"
          // 직행 선택은 onTextChange를 거치지 않아 활성 세션이 옛 목적지를 향해
          // 조용히 계속 추적했다(iOS는 .onChange(of: endpoint(.to))의 모델 레벨
          // 방어가 있어 웹만의 구멍). 결과도 옛 목적지의 산물이라 함께 비운다.
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
          recordResolved("to", ep);
          setToField(endpointToField(ep, currentLabel));
          discardResults();
        }}
        registerInput={(el) => {
          toInputRef.current = el;
        }}
        focusAfterResolve={() => submitRef.current?.focus()}
        announce={setNotice}
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
            focusTargetId={targetId.field("via")}
            field={viaField}
            onTextChange={(text) => {
              if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
              setViaField({ text, resolved: null });
              discardResults();
            }}
            onResolve={(ep) => {
              if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
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
            announce={setNotice}
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
              if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
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
        {...{ [FOCUS_TARGET_ATTR]: targetId.submit() }}
        aria-disabled={busy}
        aria-busy={busy}
        className="mt-4 min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("submit")}
      </button>

      {/* 이 뷰의 유일한 live region. 수단별 개별 통지 금지, 합산 1문장(phaseMessage).
          보조 통지(notice — 최근 경로 조작·안내 시작 고지)는 같은 채널을 잠시 우선
          점유한다. 별도 정적 텍스트를 두지 않는다 — 두 곳에 같은 문장을 두면
          회전자에서 이중 낭독된다. */}
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        <span key={noticeSeq}>{liveMessage}</span>
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
        <div className="mt-2">
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
                  {...{ [FOCUS_TARGET_ATTR]: targetId.mode(mode) }}
                  className="text-base font-semibold"
                >
                  {modeHeading(mode)}
                </h3>
                {/* 수단별 실시간 안내 진입점(§3.1) — 수단 heading 착지 후 **첫
                    스와이프** 거리(계단 회피 토글보다 앞, iOS 동조 — 독립 리뷰).
                    트리거가 곧 시작(startOnOpen — "시작" 라벨 거짓말 금지).
                    라벨은 수단별 짧은 형(위원장 판정 2026-08-06, 공통 라벨 번복):
                    SR 버튼 목록·항목 선택기는 헤딩 문맥 없이 버튼 이름만 나열해
                    동일 라벨 3개가 구분 불가다. 목적지 변경은 key 재마운트로 세션 정리. */}
                {mode === "walk" && walkGuideStartable && guideDest && (
                  <DistanceBeacon
                    key={`walk-${guideDestKey}`}
                    dest={guideDest}
                    kind="walk"
                    accessible={stepFreeEnabled}
                    startOnOpen
                    onStart={announceGuideStart}
                    triggerLabel={tBeacon("guideStartWalk")}
                    triggerTarget="walk"
                  />
                )}
                {mode === "car" && carGuideStartable && guideDest && (
                  <DistanceBeacon
                    key={`car-${guideDestKey}`}
                    dest={guideDest}
                    kind="car"
                    accessible={false}
                    startOnOpen
                    onStart={announceGuideStart}
                    triggerLabel={tBeacon("guideStartCar")}
                    triggerTarget="car"
                  />
                )}
                {/* 대중교통은 안내 시작 버튼이 여기 없다 — 경로가 복수라 버튼이
                    경로에 귀속되어야 하고(어느 경로의 안내인지 라벨로 드러난다),
                    아래 목록의 각 disclosure 안에 하나씩 있다. 도보·자동차는
                    경로가 하나라 비교 대상이 없어 섹션 상단이 맞다. */}
                {/* ⚠ 계단 회피는 카카오 전용 축이라 en(Tmap 단독)에서는 항상 unavailable이다.
                    적용될 수 없는 옵션을 켜게 두고 조회 뒤에야 못 했다고 말하면, 스크린 리더
                    사용자는 그 사이 적용됐다고 믿는다(spec 2026-08-23-non-ko-walk-guidance §4.7). */}
                {mode === "walk" && stepFreeSupported && (
                  <button
                    type="button"
                    aria-pressed={stepFreeEnabled}
                    aria-disabled={busy}
                    aria-busy={busy}
                    onClick={() => void toggleStepFree()}
                    className="mt-1 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
                  >
                    {tPed("stepFreeToggle")}
                  </button>
                )}
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
                      const guideStartable =
                        buildTransitGuideRoute(route) !== null && !prefersEnglish(locale);
                      // WebMCP 착지·트리거는 내부 순번 토큰으로(경로 키를 DOM에 싣지 않는다).
                      const routeRef = routeRefs.refOf(route.routeKey) ?? undefined;
                      return (
                        <div key={route.routeKey} className="mt-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => toggleRoute(route.routeKey)}
                            {...(routeRef !== undefined
                              ? { [FOCUS_TARGET_ATTR]: targetId.transitRoute(routeRef) }
                              : {})}
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
                                  walkAccessible={stepFreeEnabled}
                                  triggerTarget={
                                    routeRef !== undefined ? guideTriggerValue("transit", routeRef) : undefined
                                  }
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
                                focusTargetRouteRef={routeRef}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                {/* 장거리 도보 상세는 접어 둔다(spec §4.4). 세 수단 비교 화면에서
                    수십 단계짜리 도보 목록이 아래 수단을 화면 밖으로 밀어낸다.
                    접히는 것은 상세뿐이고 계단 회피 토글·안내 시작 버튼은 위쪽
                    블록에 그대로 남는다(접힘 안에 넣으면 접힌 상태에서 도달 불가). */}
                {outcome.kind === "done" && outcome.mode === "walk" && (() => {
                  const collapsible = shouldCollapseWalk(outcome.result.durationSeconds);
                  const expanded = walkExpanded ?? !collapsible;
                  const summaryOf = (b: WalkRouteBriefing) =>
                    tPed("summary", {
                      distance: formatDistance(b.distanceMeters),
                      minutes: Math.round(b.durationSeconds / 60),
                    });
                  // 추천·최단 2행 disclosure(B9 ①, spec 2026-08-23 §2 — 대중교통 대안·iOS
                  // 도보 섹션 동형). "추천"이라는 이름은 대안과 대비될 때만 정보라 최단이
                  // 없으면 아래 단일 경로 화면(현행)을 그대로 쓴다. 라벨은 한 줄 = 한 객체
                  // (joinText), stepFreeNotice는 両행 라벨에 병기 — 접힘 상태에선 라벨이 안전
                  // 문장의 유일한 전달 채널이다. 펼침 본문은 요약·notice 스텝을 뺀다(인접 중복
                  // 금지). 안내 시작 버튼은 섹션 상단에 남아 추천 경로를 안내한다(B9 ②까지).
                  if (outcome.shortest) {
                    const rows = [
                      { key: "recommended", name: t("walkRecommended"), briefing: outcome.result, expanded, toggle: () => setWalkExpanded(!expanded) },
                      { key: "shortest", name: t("walkShortest"), briefing: outcome.shortest, expanded: walkShortestExpanded, toggle: () => setWalkShortestExpanded(!walkShortestExpanded) },
                    ];
                    return rows.map((row) => (
                      <div key={row.key} className="mt-2">
                        <button
                          type="button"
                          aria-expanded={row.expanded}
                          onClick={row.toggle}
                          className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                        >
                          {joinText(row.name, summaryOf(row.briefing), row.briefing.stepFreeNotice)}
                        </button>
                        {row.expanded && (
                          <WalkRouteResult
                            briefing={row.briefing}
                            t={tPed}
                            waypointLabel={results.viaLabel}
                            includeSummary={false}
                            omitNoticeStep
                            focusTargetPrefix={row.key === "recommended" ? "walk" : undefined}
                          />
                        )}
                      </div>
                    ));
                  }
                  if (!collapsible) {
                    return (
                      <WalkRouteResult
                        briefing={outcome.result}
                        t={tPed}
                        waypointLabel={results.viaLabel}
                        focusTargetPrefix="walk"
                      />
                    );
                  }
                  return (
                    <div className="mt-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setWalkExpanded(!expanded)}
                        className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                      >
                        {joinText(summaryOf(outcome.result), outcome.result.stepFreeNotice)}
                      </button>
                      {/* 버튼이 발견 경로라 본문은 div(region·heading 부여 금지).
                          접힘·펼침 통지도 두지 않는다(aria-expanded가 상태다). */}
                      {expanded && (
                        <WalkRouteResult
                          briefing={outcome.result}
                          t={tPed}
                          waypointLabel={results.viaLabel}
                          includeSummary={false}
                          omitNoticeStep
                          focusTargetPrefix="walk"
                        />
                      )}
                    </div>
                  );
                })()}
                {outcome.kind === "done" && outcome.mode === "car" && (
                  <CarRouteResult
                    briefing={outcome.result}
                    locale={locale}
                    t={tCar}
                    waypointLabel={results.viaLabel}
                    focusTargetPrefix="car"
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
  focusTargetId,
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
  /** WebMCP 착지 대상(`field:from` 등) — 입력 요소에 붙는다. */
  focusTargetId?: string;
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
          {...(focusTargetId ? { [FOCUS_TARGET_ATTR]: focusTargetId } : {})}
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
            {candidates.places.map((p, i) => (
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
                >
                  {joinText(p.name, p.roadAddress || p.address)}
                </button>
              </li>
            ))}
            {candidates.addresses.map((a, i) => (
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
                >
                  {a.roadAddr}
                </button>
              </li>
            ))}
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
