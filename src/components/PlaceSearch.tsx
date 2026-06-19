"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CategoryBucket } from "@/lib/category";
import {
  bucketsPresent,
  filterPlacesByBucket,
  groupByCategory,
} from "@/lib/category";
import type { RegionCode } from "@/lib/region";
import { regionsPresent, filterPlacesByRegion } from "@/lib/region";
import { sortPlacesByDistance } from "@/lib/geo";
import type { AddressMatch, JusoAddress, Place, PlaceSearchResult } from "@/lib/types";
import { jusoAddressToPlace } from "@/lib/address-to-place";
import { dataLocale } from "@/lib/data-locale";
import { requestLocation } from "@/lib/geolocation";
import { useGeolocation } from "@/hooks/useGeolocation";
import { orderResultSections, combinedLiveMessage } from "@/lib/search-sections";
import { SearchBar } from "./SearchBar";
import { ChipFilter } from "./ChipFilter";
import { ResultList } from "./ResultList";
import { AddressResultList } from "./AddressResultList";
import { PlaceDetail } from "./PlaceDetail";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { SubwayArrivalsNearby } from "./SubwayArrivalsNearby";
import { NightClinicsNearby } from "./NightClinicsNearby";
import { KidsPlacesNearby } from "./KidsPlacesNearby";
import { SurroundingsNearby } from "./SurroundingsNearby";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; result: PlaceSearchResult };

/**
 * 장소 검색 오케스트레이션 — 검색 상태 + 선택 버킷 + 선택 장소(상세)를 관리하는
 * 1급 시민 컴포넌트.
 *
 * 설계 원칙 (docs/SPEC.md):
 * - 정보의 정본은 리스트/텍스트. 지도는 나중에 얹는 시각 보조 레이어.
 * - 결과 수·오류는 aria-live 영역으로 스크린 리더에 즉시 통지.
 * - 뷰 전환(검색→상세, 상세→목록)마다 새 화면의 제목으로 포커스를 옮긴다.
 *
 * 동작 보장:
 * - 상세 진입은 `history.pushState`, `popstate`에서 상세 해제 → 브라우저
 *   백버튼이 목록으로 복귀.
 * - `?q=` URL 동기화(공유·새로고침 보존), 첫 마운트 시 `?q=` 있으면 자동 검색.
 */
export function PlaceSearch({
  isMockMode,
  canBriefCarRoute = false,
  canShowBus = false,
  canShowBike = false,
  canShowSubway = false,
  canShowClinic = false,
  canShowAir = false,
  canShowKids = false,
  canShowSurroundings = false,
  canShowTransit = false,
  canSearchAddress = false,
}: {
  isMockMode: boolean;
  /** 카카오 키가 있어 자동차 경로 텍스트 브리핑을 제공할 수 있는지 */
  canBriefCarRoute?: boolean;
  /** data.go.kr 키가 있어 TAGO 버스 도착·정류소를 제공할 수 있는지 */
  canShowBus?: boolean;
  /** 서울 열린데이터 키가 있어 따릉이 대여소를 제공할 수 있는지 */
  canShowBike?: boolean;
  /** 서울 실시간 지하철 키가 있어 역 실시간 도착을 제공할 수 있는지 */
  canShowSubway?: boolean;
  /** data.go.kr 키가 있어 소아 야간·휴일 진료(달빛어린이병원)를 제공할 수 있는지 */
  canShowClinic?: boolean;
  /** data.go.kr 키가 있어 이 지역 공기질(에어코리아)을 제공할 수 있는지 */
  canShowAir?: boolean;
  /** 카카오 키가 있어 근처 아이 놀 곳(키즈 장소)을 제공할 수 있는지 */
  canShowKids?: boolean;
  /** 카카오 키가 있어 내 주변 둘러보기(주변 시설·방향)를 제공할 수 있는지 */
  canShowSurroundings?: boolean;
  /** ODsay 키가 있어 대중교통 길찾기 브리핑을 제공할 수 있는지 */
  canShowTransit?: boolean;
  /** 행안부 juso 키가 있어 주소 검색 모드를 제공할 수 있는지 */
  canSearchAddress?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  // 첫 마운트 시 ?q= 가 있으면 입력값 초기값으로 채운다(lazy initializer로 한 번만
  // 평가 → effect 본문에서 setState를 호출하지 않아 set-state-in-effect를 피한다).
  const [query, setQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [bucket, setBucket] = useState<CategoryBucket | null>(null);
  const [region, setRegion] = useState<RegionCode | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  const [addrStatus, setAddrStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "coordError" }
    | { kind: "done"; addresses: JusoAddress[] }
  >({ kind: "idle" });
  // 주소 검색 stale-result race 방지(place reqIdRef와 동형).
  const addrReqIdRef = useRef(0);
  // 좌표 변환 in-flight 가드(더블클릭 중복 진입 방지 — aria-disabled 보강 패턴).
  const addrResolveRef = useRef(false);
  // 음성으로 검색한 질의어(없으면 null=타이핑 검색). 로딩 라이브 메시지를
  // 음성일 때 "'{질의}' 검색 중…"으로 바꿔, 인식 텍스트를 polite 한 채널로만
  // 통지한다(VoiceRecordButton의 assertive announce 제거와 한 쌍 — a11y C1).
  const [spokenQuery, setSpokenQuery] = useState<string | null>(null);
  // 현재 위치 — 공유 스토어에서 파생한다. 결과를 가까운 순으로 정렬하는 데 쓰며,
  // 위치 정렬은 핵심이 아니라 향상 기능이라 좌표가 없으면 provider 순서를 유지한다.
  // 공유 스토어가 세션 1회 획득·캐시를 보장하므로 "내 주변" 버튼들과 권한을 공유한다.
  const geo = useGeolocation();
  const userCoords = geo.status === "ready" ? geo.coords : null;
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  // 검색 stale-result race 방지 — 매 검색마다 증가하는 id를 발급하고, fetch가
  // 끝난 뒤 자신이 여전히 최신 요청일 때만 결과를 반영한다. 빠른 연속 검색에서
  // 늦게 끝난 이전 요청이 최신 결과를 덮어쓰는 것을 막는다(AbortController 불필요).
  const reqIdRef = useRef(0);
  // popstate 핸들러는 마운트 시점 status를 클로저로 잡으므로, 복귀 시 "결과가
  // 렌더되는 상태인지"를 최신값으로 읽기 위해 ref로 status를 미러링한다.
  // 렌더 중 ref 변경은 금지(react-hooks/refs)이므로 effect에서 갱신한다.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const addrStatusRef = useRef(addrStatus);
  useEffect(() => {
    addrStatusRef.current = addrStatus;
  }, [addrStatus]);

  // 상세 → 목록 복귀 시 결과 헤딩으로 포커스 이동(접근성 1급).
  // 상세 뷰가 언마운트되면 포커스가 document.body로 유실되므로, 결과 헤딩이
  // 렌더되는 done 상태일 때만 리렌더 후(rAF 한 틱) 헤딩으로 옮긴다. ref가 아직
  // 없을 수 있으니 옵셔널 체이닝으로 가드한다.
  function focusResultsHeadingIfDone() {
    const hasResults =
      statusRef.current.kind === "done" || addrStatusRef.current.kind === "done";
    if (!hasResults) return;
    requestAnimationFrame(() => resultsHeadingRef.current?.focus());
  }

  // 상세 진입/이탈을 브라우저 히스토리에 연동 — 백버튼이 목록으로 복귀.
  useEffect(() => {
    function onPop() {
      setSelected(null);
      // 복귀 시 결과 헤딩으로 포커스를 옮긴다(상세 언마운트로 포커스가
      // body로 유실되는 것 방지 — 접근성 1급).
      focusResultsHeadingIfDone();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // ref 미러를 통해 최신 상태를 읽으므로 마운트 시 한 번만 등록해도 안전하다.
  }, []);

  function openDetail(place: Place) {
    // 상세는 URL에 싣지 않음(딥링크 상세 복원은 비목표) — 이 pushState는
    // 백버튼으로 목록 복귀를 포착하기 위한 trap 엔트리일 뿐이다.
    window.history.pushState({ place: place.id }, "");
    setSelected(place);
  }
  function backToResults() {
    if (window.history.state?.place) {
      // 정상 경로: history.back()이 popstate를 발화 → onPop에서 복귀+포커스 처리.
      window.history.back();
    } else {
      // 방어: pushState 없이 상세가 켜진 비정상 상태 대비.
      setSelected(null);
      focusResultsHeadingIfDone();
    }
  }

  // 앱 시작(홈 마운트) 시 위치를 1회 요청한다 — 사용자 요청 동작. 공유 스토어가
  // 멱등이라 이미 획득됐으면 no-op. 좌표가 들어오면 검색 결과가 가까운 순으로
  // 재정렬되고, "내 주변" 버튼들은 이 캐시 좌표를 팝업 없이 재사용한다. 거부/미지원은
  // 정렬 없이 graceful degrade. requestLocation은 마운트 콜백에서만 호출하므로
  // set-state-in-effect와 무관(스토어 setState는 비동기 콜백에서 발생).
  useEffect(() => {
    requestLocation();
  }, []);

  /**
   * 검색 실행 — q를 받아 fetch, 결과/오류 상태를 갱신하고 `?q=`를 URL에 보존한다.
   * runSearch(폼 제출)와 첫 마운트 자동검색이 같은 경로를 공유하도록 분리했다.
   */
  const performSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) return;
      // 위치는 마운트 시 이미 요청했다. 좌표가 들어와 있으면 결과가 가까운 순으로
      // 재정렬된다(없으면 provider 순서 유지).
      const myId = ++reqIdRef.current;
      setBucket(null);
      setRegion(null);
      setStatus({ kind: "loading" });
      // URL ?q= 동기화(공유·새로고침 보존)
      const url = new URL(window.location.href);
      url.searchParams.set("q", q);
      window.history.replaceState(window.history.state, "", url);
      // LanguageSwitcher가 ?q= 변경을 즉시 반영하도록 통지(popstate는 안 뜸).
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      try {
        const res = await fetch(
          `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as PlaceSearchResult;
        // 최신 요청만 반영 — 늦게 끝난 이전 요청은 여기서 폐기.
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "done", result });
      } catch {
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "error" });
      }
    },
    [locale],
  );

  /**
   * 주소 검색 실행 — /api/address/search(juso) 호출, 결과/오류 상태 갱신.
   * place performSearch와 동형의 reqId stale 가드. URL ?q=는 performSearch가
   * 소유하므로 주소 검색은 별도 동기화하지 않는다(장소·주소가 같은 q를 공유).
   */
  const performAddressSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const myId = ++addrReqIdRef.current;
    setAddrStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/address/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { addresses: JusoAddress[] };
      if (addrReqIdRef.current !== myId) return;
      setAddrStatus({ kind: "done", addresses: data.addresses });
    } catch {
      if (addrReqIdRef.current !== myId) return;
      setAddrStatus({ kind: "error" });
    }
  }, []);

  /**
   * 검색 진입점 단일화 — 장소(performSearch)와, juso 키가 있으면 주소
   * (performAddressSearch)를 함께 발사한다. runSearch(폼 제출)·handleTranscribed
   * (음성)·첫 마운트 ?q= 자동검색 셋이 반드시 이 한 경로를 공유한다. 과거엔 세 곳에
   * 같은 호출이 복붙돼 자동검색 경로만 주소 호출이 누락된 회귀가 있었다(통합 검색
   * 후 ?q= 진입·새로고침·언어전환 시 주소 섹션 미노출) — 단일 함수로 묶어
   * 구조적으로 차단한다.
   */
  const runQuerySearch = useCallback(
    (raw: string) => {
      void performSearch(raw);
      if (canSearchAddress) void performAddressSearch(raw);
    },
    [performSearch, performAddressSearch, canSearchAddress],
  );

  function runSearch() {
    if (status.kind === "loading") return;
    // 타이핑 검색 경로 — stale spokenQuery 초기화(이전 음성 질의가 로딩 메시지에
    // 남지 않도록).
    setSpokenQuery(null);
    runQuerySearch(query);
  }

  /**
   * 주소 선택 → 카카오 지오코딩(/api/geocode)으로 좌표 확보 → Place 합성 → 상세.
   * juso=공식 주소/영문/우편번호, 카카오=좌표 정본의 역할 분리. 좌표 변환 실패는
   * coordError로 통지하고 상세를 열지 않는다(graceful). in-flight ref로 중복 방지.
   */
  async function onSelectAddress(addr: JusoAddress) {
    if (addrResolveRef.current) return;
    addrResolveRef.current = true;
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const res = await fetch(
        `/api/geocode?query=${encodeURIComponent(target)}&limit=1`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: AddressMatch[] };
      const coord = data.matches[0];
      if (!coord) {
        setAddrStatus({ kind: "coordError" });
        return;
      }
      openDetail(
        jusoAddressToPlace(
          addr,
          { lat: coord.lat, lng: coord.lng },
          dataLocale(locale),
        ),
      );
    } catch {
      setAddrStatus({ kind: "coordError" });
    } finally {
      addrResolveRef.current = false;
    }
  }

  // 음성 전사 결과 → 입력값 채우고 같은 runQuerySearch(장소+주소) 경로로 자동 검색.
  // performSearch는 reqIdRef 최신요청 가드·?q= URL 동기화·결과 헤딩 포커스를
  // 이미 보장하므로, 전사 자동검색도 그 보장을 그대로 물려받는다.
  // spokenQuery를 세팅해 로딩 라이브 메시지가 "'{질의}' 검색 중…"으로 나가
  // 인식 텍스트를 polite 한 채널로 통지한다(input에도 채워 시각·편집 확인).
  function handleTranscribed(text: string) {
    setSpokenQuery(text);
    setQuery(text);
    runQuerySearch(text);
  }

  // 첫 마운트 시 ?q= 있으면 자동 검색(장소+주소 동시 — runQuerySearch).
  // 입력값(query) 초기화는 위 lazy initializer가 이미 처리했다. 자동검색은
  // queueMicrotask로 한 틱 미뤄 실행한다 — runQuerySearch가 동기적으로 부르는
  // setStatus/setAddrStatus({loading})가 effect 본문이 아니라 콜백에서 일어나게 하여
  // react-hooks/set-state-in-effect(동기 setState로 인한 cascading render 경고)를
  // 정석대로 만족시킨다. 동작(=?q= 자동검색)은 그대로 보존된다.
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) queueMicrotask(() => runQuerySearch(q));
  }, [runQuerySearch]);

  // 장소·주소가 모두 정착(neither loading)한 뒤 결과 헤딩으로 1회 포커스 이동.
  // juso 키 없으면 주소 검색을 안 하므로 장소 settled만으로 판정한다. 검색이 한 번도
  // 일어나지 않은 idle에서는 옮기지 않는다(둘 다 idle).
  const focusedForSearchRef = useRef(false);
  useEffect(() => {
    const placeSettled = status.kind === "done" || status.kind === "error";
    const addrSettled =
      !canSearchAddress ||
      addrStatus.kind === "done" ||
      addrStatus.kind === "error";
    const anyStarted =
      status.kind !== "idle" ||
      (canSearchAddress && addrStatus.kind !== "idle");
    if (placeSettled && addrSettled && anyStarted) {
      if (!focusedForSearchRef.current) {
        focusedForSearchRef.current = true;
        requestAnimationFrame(() => resultsHeadingRef.current?.focus());
      }
    } else if (status.kind === "loading" || addrStatus.kind === "loading") {
      // 새 검색이 시작되면 다음 settled에서 다시 포커스하도록 리셋.
      focusedForSearchRef.current = false;
    }
  }, [status.kind, addrStatus.kind, canSearchAddress]);

  // 단일 polite 채널 통지. coordError(주소 선택 후 좌표 실패)는 검색 완료 통지와
  // 시점이 달라 우선 노출.
  const placeCount = status.kind === "done" ? status.result.places.length : null;
  const addrCount =
    addrStatus.kind === "done" ? addrStatus.addresses.length : null;
  const loading = status.kind === "loading" || addrStatus.kind === "loading";
  const liveSpec: { key: string; values?: Record<string, number> } | null =
    addrStatus.kind === "coordError"
      ? { key: "search.addressCoordFailed" }
      : combinedLiveMessage({
          loading,
          placeCount,
          addrCount,
          spokenQuery,
          placeErrored: status.kind === "error",
        });
  const liveMessage = liveSpec
    ? liveSpec.key === "search.searchingFor"
      ? t(liveSpec.key, { query: spokenQuery ?? "" })
      : t(liveSpec.key, liveSpec.values ?? {})
    : "";

  // 상세 화면이면 상세만 렌더(같은 페이지 뷰 전환).
  if (selected) {
    return (
      <PlaceDetail
        place={selected}
        canBriefCarRoute={canBriefCarRoute}
        canShowBus={canShowBus}
        canShowBike={canShowBike}
        canShowSubway={canShowSubway}
        canShowAir={canShowAir}
        canShowTransit={canShowTransit}
        onBack={backToResults}
      />
    );
  }

  const rawPlaces = status.kind === "done" ? status.result.places : [];
  // 현재 위치가 있으면 가까운 순으로 정렬하고 각 카드에 distanceMeters를 부여한다.
  // groupByCategory가 입력 순서를 보존하므로, 카테고리 그룹은 그대로 유지되되 각
  // 그룹 안이 "가까운 순"으로 배열된다(위치 없으면 provider 순서 유지).
  const places = userCoords ? sortPlacesByDistance(rawPlaces, userCoords) : rawPlaces;
  // 칩 목록·카운트는 전체 결과 기준(고정) — 선택해도 칩이 사라지지 않아 스크린
  // 리더 탐색이 안정적이다. 두 축(카테고리·지역)은 AND로 결합해 표시 목록만
  // 좁힌다. 각 축은 항목이 1개 이하면 ChipFilter가 스스로 숨으므로, 브랜드
  // 검색은 지역 축만, 지역 검색은 카테고리 축만 자동으로 노출된다.
  const bucketItems = bucketsPresent(places).map((b) => ({
    key: b,
    label: t(`category.${b}`),
    count: filterPlacesByBucket(places, b).length,
  }));
  const regionItems = regionsPresent(places).map((r) => ({
    key: r,
    label: t(`region.${r}`),
    count: filterPlacesByRegion(places, r).length,
  }));
  const filtered = filterPlacesByRegion(
    filterPlacesByBucket(places, bucket),
    region,
  );
  const groups = groupByCategory(filtered);

  // 두 섹션 카운트(미완료는 0으로 — 적응형 순서/헤딩 판정용).
  const placeResultCount = status.kind === "done" ? places.length : 0;
  const addrResultCount =
    addrStatus.kind === "done" ? addrStatus.addresses.length : 0;
  const sectionOrder = orderResultSections(placeResultCount, addrResultCount);
  // 두 섹션이 모두 렌더될 때만 구분 헤딩(단일 섹션은 오늘처럼 헤딩 없이).
  const showSectionHeadings = sectionOrder.length === 2;

  // 결과 영역 최상단 헤딩 텍스트 — 합산 통지와 동일 규칙.
  const headingSpec = combinedLiveMessage({
    loading: false,
    placeCount: status.kind === "done" ? places.length : null,
    addrCount: addrStatus.kind === "done" ? addrStatus.addresses.length : null,
    spokenQuery: null,
    placeErrored: status.kind === "error",
  });
  const resultsHeading = headingSpec
    ? t(headingSpec.key, headingSpec.values ?? {})
    : t("search.resultsAnnouncement", { count: 0 });

  // 장소 섹션 본체(기존 칩 + ResultList). places 0이면 sectionOrder가 제외하므로
  // 여기 도달 시 places>0 가정.
  const placeSectionBody = (
    <>
      <div className="mt-3 flex flex-col gap-2">
        <ChipFilter
          groupLabel={t("category.filterLabel")}
          allLabel={t("category.all")}
          items={bucketItems}
          selected={bucket}
          onSelect={setBucket}
        />
        <ChipFilter
          groupLabel={t("region.filterLabel")}
          allLabel={t("region.all")}
          items={regionItems}
          selected={region}
          onSelect={setRegion}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="mt-3">{t("search.noFilterResults")}</p>
      ) : (
        <ResultList groups={groups} onOpen={openDetail} headingLevel={showSectionHeadings ? 4 : 3} />
      )}
    </>
  );

  // 주소 섹션 본체. addrStatus.done && length>0일 때만 sectionOrder에 포함.
  const addressSectionBody = (
    <AddressResultList
      addresses={addrStatus.kind === "done" ? addrStatus.addresses : []}
      onSelect={onSelectAddress}
    />
  );

  return (
    <>
      {isMockMode && (
        <p
          role="note"
          className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {t("search.mockNotice")}
        </p>
      )}

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={runSearch}
        busy={status.kind === "loading"}
        onTranscribed={handleTranscribed}
      />

      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {liveMessage}
      </p>

      {/* 검색 전 첫 화면 진입점 — 내 주변 5종(키 게이트). idle일 때만. */}
      {canShowSubway && status.kind === "idle" && (
        <div className="mt-4">
          <SubwayArrivalsNearby />
        </div>
      )}
      {canShowBus && status.kind === "idle" && (
        <div className="mt-4">
          <BusArrivals mode="current" />
        </div>
      )}
      {canShowBike && status.kind === "idle" && (
        <div className="mt-4">
          <BikeStations mode="current" />
        </div>
      )}
      {canShowClinic && status.kind === "idle" && (
        <div className="mt-4">
          <NightClinicsNearby />
        </div>
      )}
      {canShowKids && status.kind === "idle" && (
        <div className="mt-4">
          <KidsPlacesNearby />
        </div>
      )}
      {canShowSurroundings && status.kind === "idle" && (
        <div className="mt-4">
          <SurroundingsNearby />
        </div>
      )}

      {(status.kind === "done" || addrStatus.kind === "done") && (
        <div className="mt-4">
          <h2
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            {resultsHeading}
          </h2>
          {sectionOrder.length === 0 ? (
            <p className="mt-2">{t("search.noResults")}</p>
          ) : (
            sectionOrder.map((kind) =>
              kind === "place" ? (
                <section key="place" className="mt-4">
                  {showSectionHeadings && (
                    <h3 className="text-lg font-semibold">
                      {t("search.placeSection")}
                    </h3>
                  )}
                  {placeSectionBody}
                </section>
              ) : (
                <section key="address" className="mt-4">
                  {showSectionHeadings && (
                    <h3 className="text-lg font-semibold">
                      {t("search.addressSection")}
                    </h3>
                  )}
                  {addressSectionBody}
                </section>
              ),
            )
          )}
        </div>
      )}
    </>
  );
}
