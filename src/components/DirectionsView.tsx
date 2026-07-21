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
  AddressMatch,
} from "@/lib/types";
import { serializeDir, type DirEndpoint } from "@/lib/directions-state";
import { awaitGeolocation, getGeolocationSnapshot } from "@/lib/geolocation";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { joinText } from "@/lib/format";
import { TransitRouteResult } from "./TransitRouteBriefing";
import { WalkRouteResult } from "./WalkRouteBriefing";
import { CarRouteResult } from "./CarRouteBriefing";

type ModeKey = "transit" | "walk" | "car";

/** 수단 하나의 조회 결과 3-state: 성공 ≠ 경로 없음 ≠ 오류(게이트 미노출은 렌더 자체가 없음). */
type ModeOutcome =
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; mode: "transit"; result: TransitData }
  | { kind: "done"; mode: "walk"; result: WalkRouteBriefing }
  | { kind: "done"; mode: "car"; result: CarRouteBriefing };

type QueryResults = {
  /** 조회 시점의 도착 표시명(대중교통 "도착" 문장용), 필드 편집과 무관한 스냅샷 */
  destLabel: string;
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
  | { kind: "settled"; successCount: number };

function endpointToField(ep: DirEndpoint, currentLabel: string): FieldState {
  return {
    text: ep.kind === "current" ? currentLabel : ep.label,
    resolved: ep,
  };
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
): Promise<ModeOutcome> {
  const qs = `origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  if (mode === "car") {
    const res = await fetch(`/api/route/car?${qs}&lang=${lang}`, { signal });
    if (!res.ok) return { kind: "error" };
    return { kind: "done", mode, result: (await res.json()) as CarRouteBriefing };
  }
  const res = await fetch(`/api/route/${mode}?${qs}`, { signal });
  if (!res.ok) return { kind: "error" };
  const body = (await res.json()) as { result: unknown };
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
  // 후보 검색 등 폼 보조 통지: phase 파생 문구보다 우선하는 최근 1건.
  const [notice, setNotice] = useState("");

  const titleRef = useRef<HTMLHeadingElement>(null);
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
    window.history.replaceState(window.history.state, "", url);
    // LanguageSwitcher가 쿼리 변경을 href에 반영하도록 통지(?q= 동기화와 동형).
    window.dispatchEvent(new Event("gildongmu:locationchange"));
  }, [fromField.resolved, toField.resolved]);

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
    setFromField(toField);
    setToField(fromField);
    setResults(null);
    setNotice("");
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
      setResults(null);
      // 현재 위치 endpoint는 조회 시점마다 공유 스토어로 측위한다(캐시 좌표 재사용,
      // 권한 팝업 세션 1회). `?dir=` 복원 경로도 같은 재측위를 탄다.
      let cur: Coord | null = null;
      if (from.kind === "current" || to.kind === "current") {
        setPhase({ kind: "locating" });
        const geo = await awaitGeolocation();
        if (myGen !== genRef.current) return;
        if (geo.status !== "ready") {
          setPhase({ kind: "geoError" });
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
      setPhase({ kind: "loading" });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const settled = await Promise.allSettled(
        activeModes.map((m) =>
          fetchMode(m, origin, dest, dataLocale(locale), ctrl.signal),
        ),
      );
      clearTimeout(timer);
      if (myGen !== genRef.current) return;

      const outcomes: Partial<Record<ModeKey, ModeOutcome>> = {};
      activeModes.forEach((m, i) => {
        const s = settled[i];
        outcomes[m] = s.status === "fulfilled" ? s.value : { kind: "error" };
      });
      const successes = activeModes.filter((m) => outcomes[m]?.kind === "done");
      setResults({
        destLabel: to.kind === "current" ? currentLabel : to.label,
        outcomes,
      });
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

  const busy = phase.kind === "locating" || phase.kind === "loading";
  const phaseMessage =
    phase.kind === "settled"
      ? phase.successCount > 0
        ? t("readySummary", { count: phase.successCount })
        : t("allFailed")
      : phase.kind === "idle"
        ? ""
        : t(phase.kind);
  const liveMessage = notice || phaseMessage;

  function modeHeading(mode: ModeKey): string {
    if (mode === "transit") return tRoute("public");
    if (mode === "walk") return tPed("heading");
    return tRoute("car");
  }
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
          setFromField({ text, resolved: null });
          setResults(null);
        }}
        onResolve={(ep) => setFromField(endpointToField(ep, currentLabel))}
        onUseCurrent={() => void selectCurrentFrom()}
        useCurrentBusy={refreshingCurrent}
        announce={setNotice}
        locale={locale}
        t={t}
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
          setToField({ text, resolved: null });
          setResults(null);
        }}
        onResolve={(ep) => setToField(endpointToField(ep, currentLabel))}
        announce={setNotice}
        locale={locale}
        t={t}
      />

      {/* disabled 금지: aria-disabled + in-flight ref 가드로 포커스를 지킨다 */}
      <button
        type="button"
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
                {outcome.kind === "error" && (
                  <p className="mt-1 text-sm">{modeErrorText(mode)}</p>
                )}
                {outcome.kind === "empty" && (
                  <p className="mt-1 text-sm">{modeNoRouteText(mode)}</p>
                )}
                {outcome.kind === "done" && outcome.mode === "transit" && (
                  <TransitRouteResult
                    route={outcome.result.recommended}
                    t={tTransit}
                    locale={locale}
                    dest={results.destLabel}
                  />
                )}
                {outcome.kind === "done" && outcome.mode === "walk" && (
                  <WalkRouteResult briefing={outcome.result} t={tPed} />
                )}
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
 * - 후보 선택은 리스트를 제거하므로, 제거 전에 포커스를 입력으로 선점 이동한다
 *   (포커스를 쥔 요소를 없애는 상태 전이 금지). 입력의 라벨+값 낭독이 곧 선택 확인.
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
  announce,
  locale,
  t,
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
  announce: (message: string) => void;
  locale: string;
  t: ReturnType<typeof useTranslations<"directions">>;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<{
    places: Place[];
    addresses: JusoAddress[];
  } | null>(null);
  const reqRef = useRef(0);
  const geocodeRef = useRef(false);

  async function runCandidateSearch() {
    const q = field.text.trim();
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
    setCandidates({ places, addresses });
    const count = places.length + addresses.length;
    if (count > 0) {
      announce(t("candidateCount", { count }));
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

  function resolveAndClose(ep: DirEndpoint) {
    // 후보 리스트 제거 전에 포커스를 입력으로 선점 이동(포커스 유실 방지).
    inputRef.current?.focus();
    setCandidates(null);
    onResolve(ep);
  }

  async function selectAddress(addr: JusoAddress) {
    if (geocodeRef.current) return;
    geocodeRef.current = true;
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const res = await fetch(
        `/api/geocode?query=${encodeURIComponent(target)}&limit=1`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: AddressMatch[] };
      const coord = data.matches[0];
      if (!coord) {
        announce(t("coordError"));
        return;
      }
      resolveAndClose({
        kind: "place",
        label: target,
        coord: { lat: coord.lat, lng: coord.lng },
      });
    } catch {
      announce(t("coordError"));
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
          ref={inputRef}
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
          <ul className="mt-1">
            {candidates.places.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
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
            {candidates.addresses.map((a) => (
              <li key={a.roadAddr}>
                <button
                  type="button"
                  onClick={() => void selectAddress(a)}
                  className="min-h-11 w-full text-left text-sm underline"
                >
                  {a.roadAddr}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
