"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowUpDown } from "lucide-react";
import type {
  CarRouteBriefing,
  Coord,
  JusoAddress,
  Place,
  PlaceSearchResult,
  TransitRouteResult as TransitData,
  WalkRouteBriefing,
} from "@/lib/types";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import { serializeDir, type DirEndpoint } from "@/lib/directions-state";
import { awaitGeolocation, getGeolocationSnapshot } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { formatDistance, joinText, normalizeVoiceQuery } from "@/lib/format";
import { alternativeNameKey } from "@/lib/transit-alternative-name";
import { shouldCollapseWalk } from "@/lib/walk-collapse";
import { walkRouteUrl } from "@/lib/walk-route-url";
import {
  clearRecentEndpoints,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  type RecentEndpoint,
  type RecentEndpointField,
} from "@/lib/recent-searches";
import { TransitRouteResult } from "./TransitRouteBriefing";
import { WalkRouteResult } from "./WalkRouteBriefing";
import { CarRouteResult } from "./CarRouteBriefing";
import { stopActiveGuideSession } from "@/lib/guide-session-store";
import { DistanceBeacon } from "./DistanceBeacon";
import { TransitGuidePanel } from "./TransitGuidePanel";
import { buildTransitGuideRoute } from "@/lib/transit-guide";
import { VoiceRecordButton } from "./VoiceRecordButton";

type ModeKey = "transit" | "walk" | "car";

/** 수단 하나의 조회 결과 3-state: 성공 ≠ 경로 없음 ≠ 오류(게이트 미노출은 렌더 자체가 없음).
    outOfCoverage는 서버 마커 이중 방어용 — origin/dest 중 하나가 한국 밖일 때(주로
    ?dir= 딥링크로 좌표를 직접 조작한 경로)만 도달, 발견 시 폼 전체를 outOfCoverage
    phase로 전환한다(개별 수단 렌더 아님). */
type ModeOutcome =
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "outOfCoverage" }
  | { kind: "done"; mode: "transit"; result: TransitData }
  | { kind: "done"; mode: "walk"; result: WalkRouteBriefing }
  | { kind: "done"; mode: "car"; result: CarRouteBriefing };

type QueryResults = {
  /** 조회 시점의 도착 표시명(대중교통 "도착" 문장용), 필드 편집과 무관한 스냅샷 */
  destLabel: string;
  /** 조회 시점의 도착 좌표 스냅샷 — 실시간 안내 진입점의 목적지(렌더 중 ref 접근 금지). */
  destCoord: Coord;
  outcomes: Partial<Record<ModeKey, ModeOutcome>>;
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
  | { kind: "settled"; successCount: number };

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
): Promise<ModeOutcome> {
  const qs = `origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  if (mode === "car") {
    const res = await fetch(`/api/route/car?${qs}&lang=${lang}`, { signal });
    if (!res.ok) return { kind: "error" };
    const body = await res.json();
    if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
    return { kind: "done", mode, result: body as CarRouteBriefing };
  }
  // 대중교통은 경유 정류장 옵트인(B2 §7) — 실시간 안내(승차·하차 정류소 ID·좌표)의
  // 유일한 데이터원이고, 시작 시 재조회 없이 브리핑과 같은 경로를 안내한다(§2).
  const url =
    mode === "walk"
      ? walkRouteUrl({ origin, dest, accessible: walkAccessible, includeGeometry: false })
      : `/api/route/transit?${qs}&includeStops=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return { kind: "error" };
  const body = (await res.json()) as { result: unknown };
  if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
  if (!body.result) return { kind: "empty" };
  return mode === "transit"
    ? { kind: "done", mode, result: body.result as TransitData }
    : { kind: "done", mode, result: body.result as WalkRouteBriefing };
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
  onBack,
}: {
  canShowWalk: boolean;
  canShowTransit: boolean;
  canBriefCarRoute: boolean;
  initialFrom?: DirEndpoint;
  initialTo?: DirEndpoint | null;
  onBack: () => void;
}) {
  const t = useTranslations("directions");
  const tRoute = useTranslations("route");
  const tTransit = useTranslations("route.transit");
  const tPed = useTranslations("route.pedestrian");
  const tCar = useTranslations("route.briefing");
  const tCommon = useTranslations("common");
  const tBeacon = useTranslations("beacon");
  const locale = useLocale();

  // "현재 위치" 라벨에 병기할 역지오코딩 주소(F-B). null=주소 미확보(라벨은 기본
  // "현재 위치"만 — 시각으로 위치 오차를 확인할 수 없는 사용자를 위한 병기이므로
  // 모르면 거짓 표시 대신 생략).
  const [currentAddress, setCurrentAddress] = useState<string | null>(null);
  // "현재 위치 사용" 강제 재측위 진행 신호(버튼 라벨 전환용) + 재진입 ref 가드.
  const [refreshingCurrent, setRefreshingCurrent] = useState(false);
  const refreshCurrentRef = useRef(false);
  const currentLabel = currentAddress
    ? t("currentLocationNear", { address: currentAddress })
    : t("currentLocation");
  const [fromField, setFromField] = useState<FieldState>(() =>
    endpointToField(initialFrom ?? { kind: "current" }, currentLabel),
  );
  const [toField, setToField] = useState<FieldState>(() =>
    initialTo
      ? endpointToField(initialTo, currentLabel)
      : { text: "", resolved: null },
  );
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
  // 후보 검색 등 폼 보조 통지: phase 파생 문구보다 우선하는 최근 1건.
  const [notice, setNotice] = useState("");

  // 계단 회피(도보 전용) 토글. 초기값은 `?walkAccessible=1`(위 lazy 초기화 참고).
  const [stepFreeEnabled, setStepFreeEnabledState] = useState(
    readWalkAccessibleFromUrl,
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
  const lastCoordsRef = useRef<{ origin: Coord; dest: Coord } | null>(null);
  // 토글 단독 재조회 진행 신호(버튼 aria-busy 표시용, "조회" 버튼과 동일 패턴).
  const [stepFreeBusy, setStepFreeBusy] = useState(false);

  // 최근 장소(스펙 2026-07-26) — 출발지·도착지 **분리** 목록(위원장 지시 2026-07-26:
  // 출발지에서 검색한 곳이 도착지 기록에 뜨는 공유 목록 폐기). 마운트 후 로드(SSR 가드).
  const [recentFrom, setRecentFrom] = useState<RecentEndpoint[]>([]);
  const [recentTo, setRecentTo] = useState<RecentEndpoint[]>([]);
  const tRecent = useTranslations("recent");
  const setRecentFor = (field: RecentEndpointField) =>
    field === "from" ? setRecentFrom : setRecentTo;
  useEffect(() => {
    // react-hooks/set-state-in-effect 회피: 동기 setState 대신 콜백으로 한 틱 미룬다
    // (PlaceSearch 최근 검색 로드 effect와 동형).
    queueMicrotask(() => {
      setRecentFrom(loadRecentEndpoints("from"));
      setRecentTo(loadRecentEndpoints("to"));
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

  // 게이트 통과 수단만, 고정 순서(대중교통 → 자동차 → 도보). 도보는 분량이 가장
  // 많은데 검색 빈도는 가장 낮아 최하단(위원장 실사용 결정 2026-07-22). 도보는
  // V1 ko 전용: 비한국어 로케일은 조회·표시 모두 제외(prefersEnglish, useLocale
  // 원시값 비교 금지).
  const activeModes: ModeKey[] = [
    ...(canShowTransit ? (["transit"] as const) : []),
    ...(canBriefCarRoute ? (["car"] as const) : []),
    ...(canShowWalk && !prefersEnglish(locale) ? (["walk"] as const) : []),
  ];

  // `?dir=` 동기화: 확정(resolved) 필드만 직렬화한다. 편집 중(coord 무효) 상태는
  // URL에 싣지 않고 마지막 확정 상태를 유지한다. replaceState라 히스토리 스택은
  // 늘지 않고, 뒤로가기 시 브라우저가 이전 엔트리의 URL(dir 없음)을 복원한다.
  useEffect(() => {
    const from = fromField.resolved;
    if (!from) return;
    const url = new URL(window.location.href);
    url.searchParams.set("dir", serializeDir(from, toField.resolved));
    // 계단 회피 토큰은 켜짐일 때만(꺼짐=기본이라 URL에 남길 정보가 없다).
    if (stepFreeEnabled) url.searchParams.set("walkAccessible", "1");
    else url.searchParams.delete("walkAccessible");
    window.history.replaceState(window.history.state, "", url);
    // LanguageSwitcher가 쿼리 변경을 href에 반영하도록 통지(?q= 동기화와 동형).
    window.dispatchEvent(new Event("gildongmu:locationchange"));
  }, [fromField.resolved, toField.resolved, stepFreeEnabled]);

  // 현재 위치 필드의 표시 텍스트는 확정 시점 스냅샷이 아니라 파생 라벨을 쓴다
  // (주소 병기·새로고침이 라벨에 즉시 반영, 편집 시작 시엔 resolved가 풀려 원문 유지).
  const displayField = (field: FieldState): FieldState =>
    field.resolved?.kind === "current" ? { ...field, text: currentLabel } : field;

  // 이미 위치가 허용·확보된 세션에서만 조용히 주소를 병기한다(뷰 진입만으로 권한
  // 팝업·재측위 금지 — 스토어의 ready 캐시 좌표만 읽는다). 미확보면 라벨은 "현재
  // 위치" 그대로(주소 없음=정보 없음).
  const addrLoadedRef = useRef(false);
  useEffect(() => {
    if (addrLoadedRef.current) return;
    const isCurrent =
      fromField.resolved?.kind === "current" ||
      toField.resolved?.kind === "current";
    if (!isCurrent) return;
    const geo = getGeolocationSnapshot();
    if (geo.status !== "ready") return;
    addrLoadedRef.current = true;
    void fetchCurrentAddress(geo.coords).then(setCurrentAddress);
  }, [fromField.resolved, toField.resolved]);

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
      const geo = await awaitGeolocation({ force: true });
      if (geo.status === "ready") {
        addrLoadedRef.current = true;
        setCurrentAddress(await fetchCurrentAddress(geo.coords));
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
    setResults(null);
    setToggledRoutes(new Set());
    setActiveGuideAlt(null);
    setWalkExpanded(null);
    setNotice(stopped ? tBeacon("stopped") : "");
  }

  async function runQuery() {
    if (inFlight.current) return;
    const from = fromField.resolved;
    const to = toField.resolved;
    setNotice("");
    if (!from || !to) {
      setPhase({ kind: "needEndpoints" });
      return;
    }
    inFlight.current = true;
    const myGen = ++genRef.current;
    try {
      // 재조회는 패널을 언마운트시키므로 활성 세션을 먼저 명시 중지·통지한다
      // (a11y 감사 HIGH). 이후 종단 phase 통지 시점에 notice를 비워 경합을 푼다.
      const stoppedGuide = stopActiveGuideSession();
      if (stoppedGuide) setNotice(tBeacon("stopped"));
      setResults(null);
      setToggledRoutes(new Set());
      setActiveGuideAlt(null);
      // 새 조회는 도보 접힘을 자동 판정으로 되돌린다(전이표 §4.4). 사용자가
      // 펼쳐 둔 것은 그 경로에 대한 조작이지 다음 경로에 대한 조작이 아니다.
      setWalkExpanded(null);
      // 현재 위치 endpoint는 조회 시점마다 공유 스토어로 측위한다(캐시 좌표 재사용,
      // 권한 팝업 세션 1회). `?dir=` 복원 경로도 같은 재측위를 탄다.
      let cur: Coord | null = null;
      if (from.kind === "current" || to.kind === "current") {
        setPhase({ kind: "locating" });
        const geo = await awaitGeolocation();
        if (myGen !== genRef.current) return;
        if (geo.status !== "ready") {
          setNotice(""); // 중지 통지가 종단 phase 통지를 가리지 않게
          setPhase({ kind: "geoError" });
          return;
        }
        // cur 토큰 해석 시점 선분기 — 현재 위치가 한국 밖이면 조회 자체를 중단한다
        // (수단별 fetch를 하나도 쏘지 않음). 오류가 아니라 커버리지 안내이므로
        // 일반 phase로 표기.
        if (!isInKorea(geo.coords.lat, geo.coords.lng)) {
          setNotice("");
          setPhase({ kind: "outOfCoverage" });
          return;
        }
        cur = geo.coords;
        // 측위에 성공했으니 라벨 병기 주소도 그 좌표로 동기화(표시 전용 fire-and-forget,
        // 실패·매칭 없음은 null로 정직하게 비운다 — 옛 좌표의 주소를 남기지 않는다).
        addrLoadedRef.current = true;
        void fetchCurrentAddress(geo.coords).then(setCurrentAddress);
      }
      const origin = from.kind === "current" ? (cur as Coord) : from.coord;
      const dest = to.kind === "current" ? (cur as Coord) : to.coord;
      lastCoordsRef.current = { origin, dest };
      setPhase({ kind: "loading" });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled(
        activeModes.map((m) =>
          fetchMode(m, origin, dest, dataLocale(locale), ctrl.signal, stepFreeRef.current),
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
        return;
      }
      const successes = activeModes.filter((m) => outcomes[m]?.kind === "done");
      setResults({
        destLabel: to.kind === "current" ? currentLabel : to.label,
        destCoord: dest,
        outcomes,
      });
      setNotice(""); // 중지 통지 해제 — settled 합산 통지가 이 커밋에서 발화된다
      setPhase({ kind: "settled", successCount: successes.length });
      // 첫 성공 수단 heading으로 1회 포커스. 성공 0건이면 이동 없음(통지만).
      const first = successes[0];
      if (first) {
        requestAnimationFrame(() => headingRefs[first].current?.focus());
      }
    } finally {
      if (myGen === genRef.current) inFlight.current = false;
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
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled([
        fetchMode("walk", coords.origin, coords.dest, dataLocale(locale), ctrl.signal, next),
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
      setResults((prev) =>
        prev ? { ...prev, outcomes: { ...prev.outcomes, walk: outcome } } : prev,
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
  const phaseMessage =
    phase.kind === "settled"
      ? phase.successCount > 0
        ? t("readySummary", { count: phase.successCount })
        : t("allFailed")
      : phase.kind === "idle"
        ? ""
        : phase.kind === "outOfCoverage"
          ? tCommon("outOfCoverage")
          : t(phase.kind);
  const liveMessage = notice || phaseMessage;

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
  const transitOutcome = results?.outcomes.transit;
  const walkGuideStartable =
    results?.outcomes.walk?.kind === "done" && !prefersEnglish(locale);
  const carGuideStartable =
    carOutcome?.kind === "done" &&
    carOutcome.mode === "car" &&
    carOutcome.result.provider === "tmap" &&
    !prefersEnglish(locale);
  const transitGuideRoute =
    transitOutcome?.kind === "done" && transitOutcome.mode === "transit"
      ? transitOutcome.result.recommended
      : null;
  const transitGuideStartable =
    transitGuideRoute !== null &&
    buildTransitGuideRoute(transitGuideRoute) !== null &&
    !prefersEnglish(locale);
  // 간략 폴백 게이트: 시작 가능한 수단 안내 0개 ∧ 조회 settled ∧ 목적지 확정.
  // "모든 수단 실패"가 아니라 "시작 가능 0개"다 — en 로케일·카카오 폴백만 성공한
  // 조합에서 막다른 화면을 만들지 않는다(§3.1).
  const guideDest = results
    ? {
        lat: results.destCoord.lat,
        lng: results.destCoord.lng,
        name: results.destLabel,
      }
    : null;
  const guideDestKey = guideDest ? `${guideDest.lat},${guideDest.lng}` : "";
  const briefFallback =
    phase.kind === "settled" &&
    guideDest !== null &&
    !walkGuideStartable &&
    !carGuideStartable &&
    !transitGuideStartable;
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
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
          setFromField({ text, resolved: null });
          setResults(null);
          setToggledRoutes(new Set());
          setActiveGuideAlt(null);
          setWalkExpanded(null);
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
        onClearRecent={() => setRecentFrom(clearRecentEndpoints("from"))}
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
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
          setToField({ text, resolved: null });
          setResults(null);
          setToggledRoutes(new Set());
          setActiveGuideAlt(null);
          setWalkExpanded(null);
        }}
        onResolve={(ep) => {
          // 목적지 확정도 텍스트 변경과 같은 무효화 축(리뷰 MAJOR): "최근 장소"
          // 직행 선택은 onTextChange를 거치지 않아 활성 세션이 옛 목적지를 향해
          // 조용히 계속 추적했다(iOS는 .onChange(of: endpoint(.to))의 모델 레벨
          // 방어가 있어 웹만의 구멍). 결과도 옛 목적지의 산물이라 함께 비운다.
          if (stopActiveGuideSession()) setNotice(tBeacon("stopped"));
          recordResolved("to", ep);
          setToField(endpointToField(ep, currentLabel));
          setResults(null);
          setToggledRoutes(new Set());
          setActiveGuideAlt(null);
          setWalkExpanded(null);
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
        onClearRecent={() => setRecentTo(clearRecentEndpoints("to"))}
        tRecent={tRecent}
      />

      {/* disabled 금지: aria-disabled + in-flight ref 가드로 포커스를 지킨다 */}
      <button
        type="button"
        ref={submitRef}
        onClick={runQuery}
        aria-disabled={busy}
        aria-busy={busy}
        className="mt-4 min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("submit")}
      </button>

      {/* 이 뷰의 유일한 live region. 수단별 개별 통지 금지, 합산 1문장 */}
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {liveMessage}
      </p>

      {/* 간략 폴백(§3.1): 시작 가능한 수단 안내가 하나도 없을 때만 선두 노출 —
          경로를 못 찾은 상황일수록 방향 감각이 더 필요하다(기존 근거 승계). */}
      {results && briefFallback && guideDest && (
        <DistanceBeacon
          key={`brief-${guideDestKey}`}
          dest={guideDest}
          kind="walk"
          accessible={stepFreeEnabled}
          startOnOpen
          triggerLabel={tBeacon("briefGuideStart")}
        />
      )}

      {results && (
        <div className="mt-2">
          {activeModes.map((mode) => {
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
                    triggerLabel={tBeacon("guideStartWalk")}
                  />
                )}
                {mode === "car" && carGuideStartable && guideDest && (
                  <DistanceBeacon
                    key={`car-${guideDestKey}`}
                    dest={guideDest}
                    kind="car"
                    accessible={false}
                    startOnOpen
                    triggerLabel={tBeacon("guideStartCar")}
                  />
                )}
                {/* 대중교통은 안내 시작 버튼이 여기 없다 — 경로가 복수라 버튼이
                    경로에 귀속되어야 하고(어느 경로의 안내인지 라벨로 드러난다),
                    아래 목록의 각 disclosure 안에 하나씩 있다. 도보·자동차는
                    경로가 하나라 비교 대상이 없어 섹션 상단이 맞다. */}
                {mode === "walk" && (
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
                {outcome.kind === "done" && outcome.mode === "transit" && (
                  <>
                    {/* 추천·대안을 한 목록으로 낸다(W3C APG disclosure를 쌓은
                        accordion). 라벨·펼침 컨트롤·본문 구성이 모두 같고 **초기
                        펼침 상태만** 다르다 — 추천만 펼친 채로 시작한다. 종전엔
                        추천만 라벨 없이 통째로 펼쳐져 있어, 같은 지위의 경로들이
                        서로 다른 컨트롤로 보였다(위원장 지적 2026-08-07). 버튼이
                        발견 경로라 펼침 본문은 <div>(헌장 §3), 라벨이 이미 요약이라
                        본문 요약은 생략한다(includeSummary=false, 인접 중복 금지). */}
                    {[
                      {
                        route: outcome.result.recommended,
                        // 1순위는 축 라벨을 갖지 않는다(annotateHighlights: "자기보다
                        // 나은 자기는 없다") — 고정 이름이 정답이다.
                        name: tTransit("recommended"),
                        defaultExpanded: true,
                      },
                      ...outcome.result.alternatives.map((alt) => {
                        // 이름 산출은 채팅 카드와 공유한다(갈리면 같은 경로가 두
                        // 화면에서 다른 이름으로 불린다).
                        const named = alternativeNameKey(alt);
                        return {
                          route: alt,
                          name: tTransit(named.key, named.values),
                          defaultExpanded: false,
                        };
                      }),
                    ].map(({ route, name, defaultExpanded }) => {
                      // 안내 세션이 살아 있는 경로는 강제 펼침(접힘 unmount가
                      // 세션을 조용히 죽이는 경로 차단).
                      const expanded =
                        routeExpanded(route.routeKey, defaultExpanded) ||
                        activeGuideAlt === route.routeKey;
                      const guideStartable =
                        buildTransitGuideRoute(route) !== null && !prefersEnglish(locale);
                      return (
                        <div key={route.routeKey} className="mt-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => toggleRoute(route.routeKey)}
                            className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                          >
                            {joinText(
                              name,
                              tTransit("summary", {
                                minutes: route.summary.totalMinutes,
                                fare: route.summary.fare.toLocaleString(locale),
                                transfers: route.summary.transfers,
                              }),
                              route.summary.walkMinutes > 0
                                ? tTransit("walkSummary", {
                                    minutes: route.summary.walkMinutes,
                                  })
                                : null,
                            )}
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
                  </>
                )}
                {/* 장거리 도보 상세는 접어 둔다(spec §4.4). 세 수단 비교 화면에서
                    수십 단계짜리 도보 목록이 아래 수단을 화면 밖으로 밀어낸다.
                    접히는 것은 상세뿐이고 계단 회피 토글·안내 시작 버튼은 위쪽
                    블록에 그대로 남는다(접힘 안에 넣으면 접힌 상태에서 도달 불가). */}
                {outcome.kind === "done" && outcome.mode === "walk" && (() => {
                  const collapsible = shouldCollapseWalk(outcome.result.durationSeconds);
                  const expanded = walkExpanded ?? !collapsible;
                  if (!collapsible) return <WalkRouteResult briefing={outcome.result} t={tPed} />;
                  return (
                    <div className="mt-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setWalkExpanded(!expanded)}
                        className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                      >
                        {tPed("summary", {
                          distance: formatDistance(outcome.result.distanceMeters),
                          minutes: Math.round(outcome.result.durationSeconds / 60),
                        })}
                      </button>
                      {/* 버튼이 발견 경로라 본문은 div(region·heading 부여 금지).
                          접힘·펼침 통지도 두지 않는다(aria-expanded가 상태다). */}
                      {expanded && <WalkRouteResult briefing={outcome.result} t={tPed} />}
                    </div>
                  );
                })()}
                {outcome.kind === "done" && outcome.mode === "car" && (
                  <CarRouteResult
                    briefing={outcome.result}
                    locale={locale}
                    t={tCar}
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
  onClearRecent: () => void;
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

  function clearRecent() {
    // 전체 삭제 버튼도 함께 사라진다 — 제거 전 입력으로 선점 이동(§5).
    inputRef.current?.focus();
    onClearRecent();
    announce(tRecent("cleared"));
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
                  {e.label}
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
