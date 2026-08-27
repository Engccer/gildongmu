"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Compass, Route } from "lucide-react";
import type { CategoryBucket } from "@/lib/category";
import { bucketsPresent, filterPlacesByBucket } from "@/lib/category";
import type { RegionCode } from "@/lib/region";
import { regionsPresent, filterPlacesByRegion } from "@/lib/region";
import type {
  JusoAddress,
  Place,
  PlaceSearchResult,
  PlaceSort,
  WebSearchResult,
} from "@/lib/types";
import type { LivePart } from "@/lib/search-sections";
import { jusoAddressToPlace } from "@/lib/address-to-place";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import { requestOpenPlace, subscribeOpenPlace } from "@/lib/place-open-request";
import { parseDir, type DirEndpoint } from "@/lib/directions-state";
import { dataLocale } from "@/lib/data-locale";
import { joinText, normalizeVoiceQuery } from "@/lib/format";
import { requestLocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import {
  clearRecentQueries,
  loadRecentQueries,
  recordRecentQuery,
  removeRecentQuery,
  setRecentQueryPinned,
  type RecentQuery,
} from "@/lib/recent-searches";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useManualLocation } from "@/hooks/useManualLocation";
import { useManualLocationJudgment } from "@/hooks/useManualLocationJudgment";
import { useManualLocationNotice } from "@/hooks/useManualLocationNotice";
import { useHeldValue } from "@/hooks/useHeldValue";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import { buildHomeTools } from "@/lib/webmcp/tools";
import type { HomeBranches, HomeBridge, SearchOutcome, SearchRequest } from "@/lib/webmcp/tools/context";
import type { SearchSnapshot } from "@/lib/webmcp/place-refs";
import type { Op } from "@/lib/webmcp/tool-lock";
import {
  bridgeOf,
  markNearby,
  publishView,
  setNavigator,
  withdrawView,
  type Navigator as ViewNavigator,
} from "@/lib/webmcp/view-registry";
import type { PlaceBridge } from "@/lib/webmcp/tools/context";
import {
  orderResultSections,
  combinedLiveMessage,
  shouldFallbackToWeb,
} from "@/lib/search-sections";
import { SearchBar } from "./SearchBar";
import { ChipFilter } from "./ChipFilter";
import { ResultList } from "./ResultList";
import { AddressResultList } from "./AddressResultList";
import { WebResults } from "./WebResults";
import { PlaceDetail } from "./PlaceDetail";
import { DirectionsView } from "./DirectionsView";
import { NearbyHub } from "./NearbyHub";
import { ChatOverlay } from "./chat/ChatOverlay";
import { LocationBar } from "./LocationBar";
import { ManualLocationPicker } from "./ManualLocationPicker";

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
  canShowBarrierFree = false,
  canShowAir = false,
  canShowKids = false,
  canShowEvents = false,
  canShowAround = false,
  canShowTransit = false,
  canSearchAddress = false,
  canSearchWeb = false,
  canShowChat = false,
  canShowWalk = false,
  canSortByReview = false,
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
  /** data.go.kr 키가 있어 내 주변 무장애 관광지(한국관광공사)를 제공할 수 있는지 */
  canShowBarrierFree?: boolean;
  /** data.go.kr 키가 있어 이 지역 공기질(에어코리아)을 제공할 수 있는지 */
  canShowAir?: boolean;
  /** 카카오 키가 있어 근처 아이 놀 곳(키즈 장소)을 제공할 수 있는지 */
  canShowKids?: boolean;
  /** 서울 열린데이터 키가 있어 내 주변 문화행사를 제공할 수 있는지 */
  canShowEvents?: boolean;
  /** 카카오 키가 있어 둘러보기(위치 문장·한눈에 보기·주변 상황·주변 시설)를 제공할 수 있는지 */
  canShowAround?: boolean;
  /** ODsay 키가 있어 대중교통 길찾기 브리핑을 제공할 수 있는지 */
  canShowTransit?: boolean;
  /** 행안부 juso 키가 있어 주소 검색 모드를 제공할 수 있는지 */
  canSearchAddress?: boolean;
  /** Perplexity 키가 있어 웹 검색 섹션을 제공할 수 있는지 */
  canSearchWeb?: boolean;
  /** Gemini 키가 있어 채팅(AI 길찾기 도우미)을 제공할 수 있는지 */
  canShowChat?: boolean;
  /** Tmap 키가 있어 길찾기 뷰에 도보 수단을 제공할 수 있는지(뷰 자체는 무관하게 성립) */
  canShowWalk?: boolean;
  /** 네이버 지역검색 키가 있어 결과 정렬을 리뷰순으로 바꿀 수 있는지(ko 로케일에서만 노출) */
  canSortByReview?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  // 초기값은 항상 "" — 서버(window 없음)와 클라가 동일해 hydration이 일치한다.
  // ?q= 진입 시 입력값 반영은 아래 첫 마운트 effect가 setQuery로 처리한다(과거엔
  // lazy initializer가 window.location.search를 읽어 SSR ""·CSR ?q= 불일치로
  // hydration mismatch가 났다 — clear 버튼 유무가 갈렸음).
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // 웹 검색 결과(장소·주소 0건 시 폴백). null=미검색/폴백 안 함/키 없음.
  const [webResults, setWebResults] = useState<WebSearchResult[] | null>(null);
  // 웹 폴백을 발사해 결과 대기 중인지 — 포커스 effect가 웹을 기다릴지 판정한다.
  // 폴백을 안 한 검색(대부분)은 false라 장소·주소 settled 즉시 포커스가 옮겨진다.
  const [webPending, setWebPending] = useState(false);
  const [bucket, setBucket] = useState<CategoryBucket | null>(null);
  const [region, setRegion] = useState<RegionCode | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  // 정렬 축(spec 2026-08-17): review = 네이버 리뷰순 단독. sortRef는 fetch가 최신값을
  // 읽는 통로(콜백 의존성에 넣지 않아 runQuerySearch 정체성을 흔들지 않는다).
  const [sort, setSort] = useState<PlaceSort>("accuracy");
  const sortRef = useRef<PlaceSort>("accuracy");
  const sortInFlightRef = useRef(false);
  // 정렬 전환 재조회는 포커스를 토글에 남긴다(첫 결과 착지 계약 비적용, spec §4.2).
  const keepFocusOnSortRef = useRef(false);
  const lastQueryRef = useRef("");
  // 길찾기 뷰 상태(null이면 닫힘). 상세와 같은 "같은 페이지 뷰 전환" 패턴.
  const [directions, setDirections] = useState<{
    from?: DirEndpoint;
    to: DirEndpoint | null;
    /** 도착지 텍스트만 미리 채움(WebMCP `open_directions`). `to`가 있으면 그쪽이 이긴다. */
    toText?: string | null;
  } | null>(null);
  // "내 주변" 허브 뷰(스펙 2026-07-30). 열림/닫힘은 URL(?panel=nearby)이 정본,
  // History 스택은 directions와 동형 규율(직접 진입 시 스택 합성 없음 — 닫기가
  // URL을 정리하는 방어 경로).
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [addrStatus, setAddrStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "coordError" }
    | { kind: "done"; addresses: JusoAddress[] }
  >({ kind: "idle" });
  // 주소 검색 stale-result race 방지(place reqIdRef와 동형).
  const addrReqIdRef = useRef(0);
  // 웹 검색 stale-result race 방지(place reqIdRef와 동형).
  const webReqIdRef = useRef(0);
  // 좌표 변환 in-flight 가드(더블클릭 중복 진입 방지 — aria-disabled 보강 패턴).
  const addrResolveRef = useRef(false);
  // 음성으로 검색한 질의어(없으면 null=타이핑 검색). 로딩 라이브 메시지를
  // 음성일 때 "'{질의}' 검색 중…"으로 바꿔, 인식 텍스트를 polite 한 채널로만
  // 통지한다(VoiceRecordButton의 assertive announce 제거와 한 쌍 — a11y C1).
  const [spokenQuery, setSpokenQuery] = useState<string | null>(null);
  // 최근 검색(스펙 2026-07-26). 초기값 []로 SSR/CSR 일치(hydration), 마운트 후 로드.
  const [recentQueries, setRecentQueries] = useState<RecentQuery[]>([]);
  // 삭제·전체삭제 polite 통지(단일 live region 공유 — idle에서만 표시되므로 검색 통지와 경합 없음)
  const [recentNotice, setRecentNotice] = useState("");
  const recentDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // 삭제 후 포커스 복원: 렌더 반영 뒤 이동(rAF 금지 — useEffect+focus가 repo 정본 패턴)
  const recentFocusIndexRef = useRef<number | null>(null);
  const [recentRevision, setRecentRevision] = useState(0);
  // 범용 채팅(옴니박스 [AI에게 질문], 스펙 §1·§3). 입력 텍스트는 1회성 전달 —
  // ?q= 미기록·검색 API 미호출. 닫기는 트리거(SearchBar 영역)로 포커스 복귀 대신
  // 검색 입력창으로 복귀한다(질문 흐름의 자연스러운 다음 행동 = 재입력).
  const [generalChat, setGeneralChat] = useState<{ seed?: string } | null>(null);

  function openGeneralChat() {
    setGeneralChat({ seed: query.trim() || undefined });
  }

  useEffect(() => {
    // react-hooks/set-state-in-effect 회피: 동기 setState 대신 콜백으로 한 틱 미룬다
    // (동일 패턴이 아래 ?q= 자동검색 effect에도 있음).
    queueMicrotask(() => setRecentQueries(loadRecentQueries()));
  }, []);

  useEffect(() => {
    const idx = recentFocusIndexRef.current;
    if (idx === null) return;
    recentFocusIndexRef.current = null;
    recentDeleteRefs.current[idx]?.focus();
  }, [recentRevision]);

  // 현재 위치 — **유효 위치**(수동 위치 > GPS)에서 파생한다. 결과에 거리를 붙이고
  // 근접을 관련도에 블렌딩하는 데 쓰며, 위치는 핵심이 아니라 향상 기능이라 좌표가
  // 없으면 provider 순서를 유지한다. 공유 스토어가 세션 1회 획득·캐시를 보장하므로
  // "내 주변" 버튼들과 권한을 공유한다.
  //
  // ⚠ **GPS 스냅샷만 읽으면 안 된다**(백로그 D18①): 화면 첫 줄의 표시줄이 "지정한
  // 위치, X"라고 알리는데 결과 거리가 GPS 기준으로 오면, 시각장애 사용자에게 조회
  // 기준을 알리는 유일한 신호가 거짓이 된다(채팅 앵커가 같은 이유로 수동 우선이다).
  const geo = useGeolocation();
  const manualLocation = useManualLocation();
  const geoCoords = geo.status === "ready" ? geo.coords : null;
  // 두 스토어 값에서만 새로 만든다 — 매 렌더 새 객체를 만들면 이 값을 deps에 실은
  // `useCallback`(검색 실행)이 렌더마다 재생성된다(useChat의 같은 자리와 동형).
  const userCoords = useMemo(
    () => (manualLocation ? { lat: manualLocation.lat, lng: manualLocation.lng } : geoCoords),
    [manualLocation, geoCoords],
  );
  // 수동 위치 이동 판정 트리거 ①·③(탭 복귀·탭 시작). 앱 진입점 한 곳에만 건다.
  useManualLocationJudgment();
  // "현재 위치 지정" 모달(스텝별 진입은 LocationBar가 두 화면에서 공유하지만,
  // 열림 여부는 화면마다 로컬 — NearbyHub도 자기 것을 따로 갖는다).
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  // 지정 모달을 연 트리거 버튼 — 닫을 때 포커스를 되돌린다(LocationBar 시그니처는
  // 브리프대로 최소 유지하고, 여는 순간의 activeElement를 캡처하는 편이 더 얇다).
  const manualPickerTriggerRef = useRef<HTMLElement | null>(null);
  // 수동 위치 자동 해제 통지. 이 컴포넌트는 뷰가 바뀌어도(홈↔"내 주변" 허브)
  // 언마운트되지 않으므로 등록은 여기 한 곳뿐이다(훅 주석 참조) — 아래
  // liveMessage가 이 문자열을 최우선으로 흡수한다.
  const [manualNotice, resetManualNotice] = useManualLocationNotice();
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  // 검색 입력창 ref (SearchBar에 전달).
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 홈 "길찾기" 진입 버튼 ref: 결과 없이 길찾기만 열었다 닫은 경우의 포커스 복귀 대상.
  const dirEntryRef = useRef<HTMLButtonElement>(null);
  // 홈 "내 주변" 진입 버튼 ref: 허브를 열었다 닫은 경우의 포커스 복귀 대상.
  const nearbyEntryRef = useRef<HTMLButtonElement>(null);

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

  // onPop 클로저가 최신 nearbyOpen을 읽기 위한 미러(statusRef와 동형 패턴).
  const nearbyOpenRef = useRef(nearbyOpen);
  const directionsOpenRef = useRef(directions !== null);
  useEffect(() => {
    nearbyOpenRef.current = nearbyOpen;
    directionsOpenRef.current = directions !== null;
  }, [nearbyOpen, directions]);

  const addrStatusRef = useRef(addrStatus);
  useEffect(() => {
    addrStatusRef.current = addrStatus;
  }, [addrStatus]);
  const webResultsRef = useRef(webResults);
  const generalChatRef = useRef(generalChat);
  const manualPickerOpenRef = useRef(manualPickerOpen);
  useEffect(() => {
    webResultsRef.current = webResults;
    generalChatRef.current = generalChat;
    manualPickerOpenRef.current = manualPickerOpen;
  }, [webResults, generalChat, manualPickerOpen]);

  // ── WebMCP 검색 트랜잭션(spec §3.2) ──
  // 검색마다 세대(`attempt`)를 발급하고 세 분기(장소·주소·웹)의 상태를 든다. 도구 대기자는 세대에
  // 결박되고, 정착(세 분기 비-pending)은 **커밋 뒤 effect**가 판정해 결과 스냅샷을 그 세대에
  // 동결한다(`ref` 해석 표 — 이후 사용자가 새 검색을 해도 이미 해석한 Place로 진행한다).
  const searchAttemptRef = useRef(0);
  const branchesRef = useRef<{ attempt: number; state: HomeBranches } | null>(null);
  const frozenRef = useRef(new Map<number, SearchSnapshot>());
  const searchWaiterRef = useRef<{ attempt: number; resolve: (o: SearchOutcome) => void } | null>(null);
  // 분기 상태는 ref라 커밋을 일으키지 않는다 — 갱신 뒤 이 틱을 올려 정착 effect를 돌린다.
  const [, bumpSettle] = useReducer((x: number) => x + 1, 0);
  /** 새 세대가 시작될 때 앞 세대 대기자를 `superseded`로 끝낸다(사용자를 막지 않는다). */
  function supersedeSearchWaiter(newAttempt: number) {
    const w = searchWaiterRef.current;
    if (!w || w.attempt === newAttempt) return;
    searchWaiterRef.current = null;
    w.resolve({ kind: "superseded" });
  }
  /** 도구 언와인드 중 중간 착지 억제(spec §6 — 한 호출에 착지는 최종 화면 하나). */
  const suppressFocusRef = useRef(false);
  // 언마운트는 검색 대기자를 aborted로 끝낸다(도구가 영영 기다리지 않게).
  useEffect(() => {
    return () => {
      const w = searchWaiterRef.current;
      searchWaiterRef.current = null;
      w?.resolve({ kind: "aborted" });
    };
  }, []);

  // 상세/길찾기 → 홈 복귀 시 포커스 이동(접근성 1급). 뷰 언마운트로 포커스가
  // document.body로 유실되므로, 결과 헤딩(done 상태)으로 옮기고, 결과가 없으면
  // (검색 전 홈에서 길찾기만 열었다 닫은 경우) 길찾기 진입 버튼으로 복귀한다.
  // ref가 아직 없을 수 있으니 옵셔널 체이닝으로 가드한다.
  function focusResultsHeadingIfDone() {
    if (suppressFocusRef.current) return;
    const hasResults =
      statusRef.current.kind === "done" || addrStatusRef.current.kind === "done";
    requestAnimationFrame(() => {
      if (hasResults) resultsHeadingRef.current?.focus();
      else dirEntryRef.current?.focus();
    });
  }

  // 상세·길찾기 진입/이탈을 브라우저 히스토리에 연동: 백버튼이 이전 뷰로 복귀.
  // 스택 규율: 홈 → (상세) → 길찾기. state에 place·directions 플래그를 쌓아
  // popstate에서 복귀 대상 뷰를 판별한다.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const st = e.state as {
        place?: string;
        directions?: boolean;
        nearby?: boolean;
      } | null;
      if (st?.directions) {
        // 앞으로가기로 길찾기 엔트리에 재진입: 복원 정본은 그 엔트리의 ?dir=
        // (현재 위치는 cur 토큰이라 조회 시 재측위된다).
        const parsed = parseDir(
          new URLSearchParams(window.location.search).get("dir"),
        );
        setDirections(parsed ?? { to: null });
        return;
      }
      setDirections(null);
      if (st?.nearby) {
        // 앞으로가기 재진입 포함 — URL ?panel=nearby가 정본이므로 상태만 복원.
        setNearbyOpen(true);
        return;
      }
      if (st?.place) {
        // 길찾기 → 상세 복귀: selected는 메모리에 남아 있고, PlaceDetail이
        // 재마운트되며 자체 effect로 제목에 포커스를 준다.
        setNearbyOpen(false);
        return;
      }
      // 홈 복귀: 닫힌 뷰가 허브였으면 진입 칩으로(트리거 복귀 계약), 아니면 기존
      // 결과 헤딩/길찾기 버튼 복귀.
      const wasNearby = nearbyOpenRef.current;
      setSelected(null);
      setNearbyOpen(false);
      if (suppressFocusRef.current) return;
      if (wasNearby) {
        requestAnimationFrame(() => nearbyEntryRef.current?.focus());
      } else {
        focusResultsHeadingIfDone();
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // ref 미러를 통해 최신 상태를 읽으므로 마운트 시 한 번만 등록해도 안전하다.
  }, []);

  // 채팅 카드의 장소 열기 요청. 상세가 이미 열려 있으면 같은 히스토리 엔트리에서
  // 교체(뒤로가기=결과 복귀 불변식 유지 — 상세 위 상세 스택은 비목표), 아니면
  // 기존 openDetail(pushState). selectedRef로 최신값을 읽는다(마운트 1회 등록).
  // openSeq: 장소 앵커 채팅에서 앵커 자신(같은 place.id)이 카드로 돌아오면
  // key={selected.id}만으론 값이 안 바뀌어 리마운트가 안 되고 PlaceDetail의
  // chatOpen이 남는다 — 발행마다 증가시켜 id 불변이어도 강제 리마운트한다.
  const [openSeq, setOpenSeq] = useState(0);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    return subscribeOpenPlace((place) => {
      setDirections(null);
      // 현재는 허브에서 도달 불가(9개 이관 섹션 어느 것도 place-open-request를
      // 구독하지 않음)지만, 방어 정규화를 directions와 동형으로 맞춰 허브→상세
      // 경로가 생기는 순간 유령 히스토리 엔트리가 남는 것을 지금 차단한다.
      setNearbyOpen(false);
      // 범용 채팅 오버레이 잔존 시 상세 전환 후 뒤로가기 복귀에서 재마운트되어
      // initialMessage가 재전송되는 것을 차단(홈 언마운트는 오버레이만 지우고
      // generalChat state는 남긴다).
      setGeneralChat(null);
      setOpenSeq((s) => s + 1);
      if (selectedRef.current) {
        window.history.replaceState(
          { ...(window.history.state ?? {}), place: place.id },
          "",
        );
        setSelected(place);
      } else {
        openDetail(place);
      }
    });
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

  // WebMCP 홈 진입 도구(spec §3.1) — 검색 뷰가 보일 때만 등록한다. 길찾기 뷰 전환 커밋
  // **직전**에 `abortNow()`로 해제해, 길찾기 뷰의 9개가 등록되기 전에 이 1개가 사라진다
  // (둘이 겹치는 창만 막는다 — 반대 방향의 빈 창은 수용, spec §3.1).
  const homeVisible = directions === null && selected === null && !nearbyOpen;
  const { abortNow: abortHomeTools } = useWebMcpTools(
    () =>
      buildHomeTools({
        isDirectionsOpen: () => directionsOpenRef.current,
        openDirections: (toText) => openDirectionsWithText(toText),
      }),
    { enabled: homeVisible },
  );

  // 길찾기 뷰 진입: 홈(도착지 없음) 또는 장소 상세(도착지 프리필). 기존 state
  // (상세의 place)를 보존해 뒤로가기가 상세로 정확히 복귀하게 한다. ?dir= URL
  // 동기화는 DirectionsView가 replaceState로 소유한다(?q= 패턴과 동형).
  function openDirections(to: DirEndpoint | null) {
    abortHomeTools();
    window.history.pushState(
      { ...(window.history.state ?? {}), directions: true },
      "",
    );
    setDirections({ to });
  }
  /** 도구 진입 — 도착지는 텍스트로만(해석·조회는 `plan_directions`). 같은 히스토리 규율. */
  function openDirectionsWithText(toText: string | null) {
    if (directionsOpenRef.current) return;
    abortHomeTools();
    window.history.pushState(
      { ...(window.history.state ?? {}), directions: true },
      "",
    );
    directionsOpenRef.current = true;
    setDirections({ to: null, toText });
  }
  function backFromDirections() {
    if (window.history.state?.directions) {
      window.history.back();
    } else {
      // 방어: ?dir= 딥링크 직진입 등 pushState 없는 경로. 닫으면서 URL의
      // dir도 정리해 새로고침 시 재진입하지 않게 한다.
      const url = new URL(window.location.href);
      url.searchParams.delete("dir");
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      setDirections(null);
      focusResultsHeadingIfDone();
    }
  }

  // "내 주변" 허브 진입: 홈 칩에서만 연다. 화면 전환이므로 pushState(스펙 §2).
  function openNearbyHub() {
    const url = new URL(window.location.href);
    url.searchParams.set("panel", "nearby");
    window.history.pushState(
      { ...(window.history.state ?? {}), nearby: true },
      "",
      url,
    );
    window.dispatchEvent(new Event("gildongmu:locationchange"));
    setNearbyOpen(true);
  }
  function backFromNearbyHub() {
    if (window.history.state?.nearby) {
      window.history.back();
    } else {
      // 방어: ?panel=nearby 딥링크 직진입. 닫으면서 URL 정리(backFromDirections 동형).
      const url = new URL(window.location.href);
      url.searchParams.delete("panel");
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      setNearbyOpen(false);
      // 이 시점엔 허브가 아직 렌더 트리를 점유해 칩이 마운트되지 않았다 — rAF로
      // 리렌더 이후 포커스한다. [내 주변] 칩은 상시 노출([길찾기]와 대칭, 2026-07-30)
      // 이라 통상 nearbyEntryRef로 복귀하지만, ref가 아직 없는 극단적 타이밍 등을
      // 대비해 결과 헤딩/길찾기 버튼 복귀로 폴백한다(포커스가 body로 유실되는 것
      // 방지 — 접근성 1급).
      if (suppressFocusRef.current) return;
      requestAnimationFrame(() => {
        if (nearbyEntryRef.current) nearbyEntryRef.current.focus();
        else focusResultsHeadingIfDone();
      });
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
    async (rawQuery: string): Promise<{ count: number; errored: boolean; stale?: boolean }> => {
      const q = rawQuery.trim();
      if (!q) return { count: 0, errored: false };
      // 위치는 마운트 시 이미 요청했다. 좌표가 들어와 있으면 결과가 가까운 순으로
      // 재정렬된다(없으면 provider 순서 유지).
      const myId = ++reqIdRef.current;
      lastQueryRef.current = q;
      setBucket(null);
      setRegion(null);
      setStatus({ kind: "loading" });
      // URL ?q=·?sort= 동기화(공유·새로고침 보존). 정렬 전환은 화면 전환이 아니라
      // replaceState(뒤로가기 엔트리 없음).
      const url = new URL(window.location.href);
      url.searchParams.set("q", q);
      if (sortRef.current === "review") url.searchParams.set("sort", "review");
      else url.searchParams.delete("sort");
      window.history.replaceState(window.history.state, "", url);
      // LanguageSwitcher가 ?q= 변경을 즉시 반영하도록 통지(popstate는 안 뜸).
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      try {
        // 좌표가 있으면 거리순 정렬("맥도날드" 전국 체인도 근처 지점 상위). 커버리지
        // 밖 좌표는 블렌딩 파라미터 자체를 생략(검색은 계속 진행 — 좌표 없이도
        // 카카오 정확도순 검색은 성립한다).
        const coordQuery =
          userCoords && isInKorea(userCoords.lat, userCoords.lng)
            ? `&lat=${userCoords.lat}&lng=${userCoords.lng}`
            : "";
        // 리뷰순에서 좌표는 순위에 쓰이지 않고 거리 표기에만 쓰인다(서버 계약 그대로).
        const sortQuery = sortRef.current === "review" ? "&sort=review" : "";
        const res = await fetch(
          `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}${coordQuery}${sortQuery}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as PlaceSearchResult;
        // stale(더 새로운 검색이 진행 중)은 errored 취급 — 이 검색의 폴백 판정을
        // 막고 최신 검색이 자기 폴백을 책임지게 한다(웹 이중 발사·stale 폴백 방지).
        if (reqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setStatus({ kind: "done", result });
        return { count: result.places.length, errored: false };
      } catch {
        if (reqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setStatus({ kind: "error" });
        // 에러는 "0건"과 다른 신호(인프라 장애 ≠ 장소 도메인 밖) — 폴백 억제.
        return { count: 0, errored: true };
      }
    },
    [locale, userCoords],
  );

  /**
   * 주소 검색 실행 — /api/address/search(juso) 호출, 결과/오류 상태 갱신.
   * place performSearch와 동형의 reqId stale 가드. URL ?q=는 performSearch가
   * 소유하므로 주소 검색은 별도 동기화하지 않는다(장소·주소가 같은 q를 공유).
   */
  const performAddressSearch = useCallback(
    async (raw: string): Promise<{ count: number; errored: boolean; stale?: boolean }> => {
      const q = raw.trim();
      if (!q) return { count: 0, errored: false };
      const myId = ++addrReqIdRef.current;
      setAddrStatus({ kind: "loading" });
      try {
        const res = await fetch(`/api/address/search?query=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { addresses: JusoAddress[] };
        if (addrReqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setAddrStatus({ kind: "done", addresses: data.addresses });
        return { count: data.addresses.length, errored: false };
      } catch {
        // 주소 에러·stale은 폴백 판정에서 0건 취급(보조 — 폴백 억제는 장소 errored가 담당).
        if (addrReqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setAddrStatus({ kind: "error" });
        return { count: 0, errored: true };
      }
    },
    [],
  );

  /**
   * 웹 검색 실행 — /api/search/web(Perplexity) 호출. 장소·주소와 병렬 발사되는
   * 보조 섹션이라 실패/빈 결과는 빈 배열로 graceful(섹션 미렌더). place reqId 동형.
   */
  const performWebSearch = useCallback(
    async (raw: string): Promise<{ count: number; errored: boolean; stale?: boolean }> => {
      const q = raw.trim();
      if (!q) return { count: 0, errored: false };
      const myId = ++webReqIdRef.current;
      setWebResults(null); // 새 검색 — 이전 웹 결과 잔류 방지.
      try {
        const res = await fetch(`/api/search/web?query=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { web: WebSearchResult[] };
        if (webReqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setWebResults(data.web);
        setWebPending(false); // 폴백 완료 — 포커스 effect가 결과 헤딩으로 이동.
        return { count: data.web.length, errored: false };
      } catch {
        if (webReqIdRef.current !== myId) return { count: 0, errored: true, stale: true };
        setWebResults([]); // 보조 섹션 — 무음 degrade.
        setWebPending(false);
        return { count: 0, errored: true };
      }
    },
    [],
  );
  /** 분기 결과 → 상태 낱말. stale은 호출자가 먼저 걸러 여기 오지 않는다. */
  const branchState = (r: { count: number; errored: boolean }): "done" | "empty" | "error" =>
    r.errored ? "error" : r.count > 0 ? "done" : "empty";

  /**
   * 검색 진입점 단일화 — 장소(performSearch)와, juso 키가 있으면 주소
   * (performAddressSearch)를 함께 발사한다. runSearch(폼 제출)·handleTranscribed
   * (음성)·첫 마운트 ?q= 자동검색 셋이 반드시 이 한 경로를 공유한다. 과거엔 세 곳에
   * 같은 호출이 복붙돼 자동검색 경로만 주소 호출이 누락된 회귀가 있었다(통합 검색
   * 후 ?q= 진입·새로고침·언어전환 시 주소 섹션 미노출) — 단일 함수로 묶어
   * 구조적으로 차단한다.
   */
  const runQuerySearch = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      // 검색 세대 발급 — 앞 세대의 도구 대기자는 superseded(사용자 우선).
      const attempt = ++searchAttemptRef.current;
      supersedeSearchWaiter(attempt);
      branchesRef.current = {
        attempt,
        state: {
          places: "pending",
          addresses: canSearchAddress ? "pending" : "skipped",
          web: canSearchWeb ? "pending" : "skipped",
        },
      };
      // 검색 제출 = 기록 시점(0건이어도 기록 — 재시도 가치). 이전 삭제 통지는 리셋.
      setRecentNotice("");
      // 자동 해제 통지는 1회성 — 새 검색이 일어나면 그 결과 통지가 우선한다.
      resetManualNotice();
      setRecentQueries(recordRecentQuery(raw));
      // 새 검색 — 이전 웹 폴백 상태를 즉시 리셋(skip 경로에서도 잔류 제거).
      setWebPending(false);
      setWebResults(null);
      // 장소·주소는 병렬 발사·병렬 대기(직렬 await 금지 — 속도 보존). 웹은 그 뒤
      // 0건 폴백 조건일 때만 2단계로 발사한다(카카오·juso가 찾으면 웹 노이즈 회피).
      const [place, addr] = await Promise.all([
        performSearch(raw),
        canSearchAddress
          ? performAddressSearch(raw)
          : Promise.resolve({ count: 0, errored: false, stale: false }),
      ]);
      // 더 새로운 검색이 세대를 가져갔으면 이 세대의 분기 표는 이미 없다 — 건드리지 않는다.
      const mine = branchesRef.current?.attempt === attempt ? branchesRef.current : null;
      if (mine && !place.stale) mine.state.places = branchState(place);
      if (mine && canSearchAddress && !addr.stale) mine.state.addresses = branchState(addr);
      const fallback =
        canSearchWeb && !place.errored && shouldFallbackToWeb(place.count, addr.count);
      if (fallback) {
        setWebPending(true);
        void performWebSearch(raw).then((web) => {
          const still = branchesRef.current?.attempt === attempt ? branchesRef.current : null;
          if (still && !web.stale) {
            still.state.web = branchState(web);
            bumpSettle();
          }
        });
      } else if (mine) {
        mine.state.web = "skipped";
      }
      if (mine) bumpSettle();
    },
    [
      performSearch,
      performAddressSearch,
      performWebSearch,
      canSearchAddress,
      canSearchWeb,
      resetManualNotice,
    ],
  );

  /**
   * 정렬 토글(spec 2026-08-17 §4): 마지막 제출 질의로 장소 섹션만 재조회한다(주소·웹은
   * 정렬 축이 없다). 재조회 중 disabled 금지 — aria-disabled + 이 가드 + in-flight ref.
   */
  async function toggleSort() {
    if (sortInFlightRef.current || status.kind === "loading") return;
    const q = lastQueryRef.current;
    if (!q) return;
    sortInFlightRef.current = true;
    const next: PlaceSort = sortRef.current === "review" ? "accuracy" : "review";
    sortRef.current = next;
    setSort(next);
    keepFocusOnSortRef.current = true;
    // 정렬 전환도 새 세대다(장소 분기만 다시 뜨고 주소·웹은 현재 상태를 승계).
    const attempt = ++searchAttemptRef.current;
    supersedeSearchWaiter(attempt);
    const a = addrStatusRef.current;
    const w = webResultsRef.current;
    branchesRef.current = {
      attempt,
      state: {
        places: "pending",
        addresses:
          a.kind === "done" ? (a.addresses.length > 0 ? "done" : "empty") : a.kind === "error" ? "error" : "skipped",
        web: w === null ? "skipped" : w.length > 0 ? "done" : "empty",
      },
    };
    try {
      const r = await performSearch(q);
      const mine = branchesRef.current?.attempt === attempt ? branchesRef.current : null;
      if (mine && !r.stale) {
        mine.state.places = branchState(r);
        bumpSettle();
      }
      // 재조회가 실패하면(stale 제외 — 그건 더 새 검색이 상태를 소유한다) 라벨·URL을
      // 되돌린다: 라벨이 곧 상태 신호인데 실패한 정렬이 적용된 것처럼 남으면 거짓이 된다.
      if (r.errored && !r.stale) {
        sortRef.current = sort;
        setSort(sort);
        const url = new URL(window.location.href);
        if (sort === "review") url.searchParams.set("sort", "review");
        else url.searchParams.delete("sort");
        window.history.replaceState(window.history.state, "", url);
      }
    } finally {
      sortInFlightRef.current = false;
    }
  }

  function runSearch() {
    if (status.kind === "loading") return;
    // 타이핑 검색 경로 — stale spokenQuery 초기화(이전 음성 질의가 로딩 메시지에
    // 남지 않도록).
    setSpokenQuery(null);
    void runQuerySearch(query);
  }

  /** 항목 삭제(스펙 §5 포커스 계약): 다음 항목 → 이전 항목 → 목록 소멸 시 검색 input. */
  function deleteRecent(q: string, index: number) {
    const next = removeRecentQuery(q);
    setRecentQueries(next);
    setRecentNotice(t("recent.deleted"));
    if (next.length === 0) {
      searchInputRef.current?.focus();
      return;
    }
    recentFocusIndexRef.current = Math.min(index, next.length - 1);
    setRecentRevision((r) => r + 1);
  }

  /** 고정 토글(스펙 2026-08-12 §4): 화면 순서는 그대로 두고(정렬은 다음 로드부터)
   *  로컬 상태만 in-place 교체 — 토글 순간 항목이 이동하면 탐색 맥락이 깨진다.
   *  통지는 항목명 포함 — 다른 항목 연속 고정 시 같은 문자열이면 setState bail out으로
   *  live region이 안 바뀌어 두 번째부터 침묵한다(a11y 감사 실측 2026-08-12). */
  function togglePinRecent(item: RecentQuery) {
    const pinned = !item.pinned;
    setRecentQueryPinned(item.text, pinned);
    setRecentQueries((prev) => prev.map((x) => (x === item ? { ...x, pinned } : x)));
    setRecentNotice(
      t(pinned ? "recent.pinnedItem" : "recent.unpinnedItem", { name: item.text }),
    );
  }

  function clearRecent() {
    const kept = clearRecentQueries();
    setRecentQueries(kept);
    if (kept.length === 0) {
      setRecentNotice(t("recent.cleared"));
      searchInputRef.current?.focus(); // 섹션 소멸 — 기존 계약
    } else {
      // 고정이 남아 섹션·버튼이 그대로다 — "모두 지웠습니다"는 거짓, 포커스 무이동.
      setRecentNotice(t("recent.clearedExceptPinned"));
    }
  }

  /**
   * 주소 선택 → 카카오 지오코딩(/api/geocode)으로 좌표 확보 → Place 합성 → 상세.
   * juso=공식 주소/영문/우편번호, 카카오=좌표 정본의 역할 분리. 좌표 변환 실패는
   * coordError로 통지하고 상세를 열지 않는다(graceful). in-flight ref로 중복 방지.
   */
  async function onSelectAddress(addr: JusoAddress) {
    await resolveAndOpenAddress(addr, undefined, openDetail);
  }
  /**
   * 주소 → 좌표 → Place → 상세. 화면 탭(openDetail)과 도구(`HomeBridge.openAddress`,
   * `requestOpenPlace`로 어느 화면에서든 정규화)가 같은 경로를 지난다. 실패 통지(coordError)도 같다.
   */
  async function resolveAndOpenAddress(
    addr: JusoAddress,
    signal: AbortSignal | undefined,
    open: (place: Place) => void,
  ): Promise<boolean> {
    if (addrResolveRef.current) return false;
    addrResolveRef.current = true;
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const r = await resolveAddressCoord(target, signal);
      if (r.kind !== "resolved") {
        setAddrStatus({ kind: "coordError" });
        return false;
      }
      open(jusoAddressToPlace(addr, { lat: r.lat, lng: r.lng }, dataLocale(locale)));
      return true;
    } finally {
      addrResolveRef.current = false;
    }
  }

  // 음성 전사 결과 → 입력값 채우고 같은 runQuerySearch(장소+주소) 경로로 자동 검색.
  // performSearch는 reqIdRef 최신요청 가드·?q= URL 동기화·결과 헤딩 포커스를
  // 이미 보장하므로, 전사 자동검색도 그 보장을 그대로 물려받는다.
  // spokenQuery를 세팅해 로딩 라이브 메시지가 "'{질의}' 검색 중…"으로 나가
  // 인식 텍스트를 polite 한 채널로 통지한다(input에도 채워 시각·편집 확인).
  // 후행 마침표 제거 후 소비: 통지·입력값·질의가 같은 문자열이어야 SR 사용자가
  // 들은 것과 검색된 것이 어긋나지 않는다(normalizeVoiceQuery 주석에 실측 근거).
  function handleTranscribed(text: string) {
    const query = normalizeVoiceQuery(text);
    setSpokenQuery(query);
    setQuery(query);
    void runQuerySearch(query);
  }

  // 첫 마운트 시 ?q= 있으면 입력값 반영 + 자동 검색(장소+주소 동시 — runQuerySearch).
  // setQuery·runQuerySearch를 모두 queueMicrotask로 한 틱 미뤄 실행한다 — 동기 setState
  // (입력값·setStatus loading)가 effect 본문이 아니라 콜백에서 일어나게 해
  // react-hooks/set-state-in-effect(cascading render 경고)를 정석대로 만족시킨다.
  // query 초기값이 ""라 SSR/CSR이 일치하고(hydration mismatch 제거), 마운트 직후
  // 콜백이 setQuery(q)로 입력창을 채운다(?q= 진입 시 입력 표시 보존).
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    const params = new URLSearchParams(window.location.search);
    // ?sort=review 복원은 자동검색보다 먼저(sortRef를 fetch가 읽는다).
    if (params.get("sort") === "review") {
      sortRef.current = "review";
      queueMicrotask(() => setSort("review"));
    }
    const q = params.get("q");
    if (q)
      queueMicrotask(() => {
        setQuery(q);
        void runQuerySearch(q);
      });
    // ?dir= 딥링크·새로고침 복원: 검색(q)은 배경에서 그대로 살리고 길찾기 뷰를
    // 위에 연다(cur 토큰은 조회 시 재측위). 불량 문자열은 parseDir가 null을 주어
    // 빈 폼 폴백 없이 홈 유지.
    const dir = parseDir(params.get("dir"));
    if (dir)
      queueMicrotask(() => setDirections({ from: dir.from, to: dir.to }));
    // ?panel=nearby 딥링크·새로고침 복원(스택 합성 없음 — 뒤로가기는 브라우저 기본).
    if (params.get("panel") === "nearby")
      queueMicrotask(() => setNearbyOpen(true));
  }, [runQuerySearch]);

  // 검색 정착 판정(커밋 뒤, [[effect-resolver-must-guard-committed-state]]): 분기 표가 전부
  // 비-pending이고 커밋된 상태가 그 표와 일치할 때 스냅샷을 동결하고 대기자를 푼다.
  useEffect(() => {
    const b = branchesRef.current;
    if (!b) return;
    if (Object.values(b.state).some((st) => st === "pending")) return;
    // 표가 done이라는데 상태가 아직 loading이면 앞 커밋이다 — 다음 커밋을 기다린다.
    if (status.kind === "loading" || addrStatus.kind === "loading") return;
    if (!frozenRef.current.has(b.attempt)) {
      frozenRef.current.set(b.attempt, {
        attempt: b.attempt,
        query: lastQueryRef.current,
        sort: sortRef.current,
        places: status.kind === "done" ? status.result.places : [],
        addresses: addrStatus.kind === "done" ? addrStatus.addresses : [],
      });
      // 최근 2세대만 보관(옛 세대의 ref는 staleResult가 정답).
      for (const key of [...frozenRef.current.keys()].sort((x, y) => x - y).slice(0, -2)) {
        frozenRef.current.delete(key);
      }
    }
    const w = searchWaiterRef.current;
    if (w && w.attempt === b.attempt) {
      searchWaiterRef.current = null;
      w.resolve({ kind: "settled", attempt: b.attempt, branches: { ...b.state } });
    }
  });

  /** 도구의 검색(spec §3.2 원자 호출) — 사용자 검색과 같은 `runQuerySearch`를 세대 대기자와 함께 부른다. */
  function runSearchForTool(request: SearchRequest, op: Op): Promise<SearchOutcome> {
    // busy 판정은 커밋 뒤에 갱신되는 statusRef가 아니라 **동기**로 갱신되는 분기 표로 한다 —
    // 연속 호출에서 statusRef는 아직 idle이라 둘째 호출이 첫 호출을 superseded로 밀어낸다.
    const inFlight = branchesRef.current;
    if (inFlight && Object.values(inFlight.state).some((st) => st === "pending")) {
      return Promise.resolve({ kind: "busy" });
    }
    const q = request.query.trim();
    if (sortRef.current !== request.sort) {
      sortRef.current = request.sort;
      setSort(request.sort);
    }
    setSpokenQuery(null);
    setQuery(q);
    const attempt = searchAttemptRef.current + 1;
    supersedeSearchWaiter(attempt);
    const promise = new Promise<SearchOutcome>((resolve) => {
      searchWaiterRef.current = { attempt, resolve };
    });
    const onAbort = () => {
      const w = searchWaiterRef.current;
      if (w?.attempt === attempt) {
        searchWaiterRef.current = null;
        w.resolve({ kind: "aborted" });
      }
    };
    op.signal.addEventListener("abort", onAbort, { once: true });
    void runQuerySearch(q);
    return promise.finally(() => op.signal.removeEventListener("abort", onAbort));
  }

  /** ref 미러로 현재 뷰를 판정(길찾기 > 내 주변 > 상세 > 홈). */
  function currentViewState(): "directions" | "nearby" | "place" | "home" {
    if (directionsOpenRef.current) return "directions";
    if (nearbyOpenRef.current) return "nearby";
    if (selectedRef.current) return "place";
    return "home";
  }
  /**
   * 홈으로 언와인드(spec §3.2): 맨 위 뷰의 뒤로가기 핸들러 → 다음 popstate 또는 1초 → 재판정,
   * 최대 3회. popstate를 누구 것이라 귀속시키지 않는다(사용자 동시 뒤로가기도 상태 재판정이
   * 진전을 보장한다). 상태 직접 대입으로 홈을 만들지 않는다(유령 히스토리 엔트리).
   * 중간 착지는 억제하고 홈 도착 뒤 `search_places`의 결과 헤딩 착지가 그 호출의 유일한 착지다.
   */
  async function toHomeForTool(op: Op): Promise<void> {
    if (currentViewState() === "home") return;
    suppressFocusRef.current = true;
    try {
      for (let i = 0; i < 3; i++) {
        const v = currentViewState();
        if (v === "home") return;
        const popped = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        if (v === "directions") backFromDirections();
        else if (v === "nearby") backFromNearbyHub();
        else backToResults();
        await Promise.race([popped, sleep(1_000, op.signal)]);
        // popstate 뒤 React 커밋(ref 미러 갱신)을 한 틱 기다린다.
        await sleep(0, op.signal);
        if (!op.isLive()) throw new Error("aborted");
      }
      if (currentViewState() !== "home") throw new Error("viewChanging");
    } finally {
      suppressFocusRef.current = false;
    }
  }

  // 홈 브릿지 게시(항상 — 결과 표의 소유자는 이 컴포넌트이고 `currentView()`가 우선순위로 가른다).
  // read·runSearch는 ref로 최신 클로저를 읽는다.
  const homeBridgeImplRef = useRef<HomeBridge | null>(null);
  useEffect(() => {
    homeBridgeImplRef.current = {
      read: () => {
        const st = statusRef.current;
        const a = addrStatusRef.current;
        const w = webResultsRef.current;
        return {
          query: lastQueryRef.current,
          sort: sortRef.current,
          attempt: branchesRef.current?.attempt ?? null,
          branches: branchesRef.current ? { ...branchesRef.current.state } : null,
          counts: {
            places: st.kind === "done" ? st.result.places.length : 0,
            addresses: a.kind === "done" ? a.addresses.length : 0,
            web: w ? w.length : 0,
          },
          chatOpen: generalChatRef.current !== null,
          webResults: (w ?? []).map(({ title, url, snippet }) => ({ title, url, snippet })),
        };
      },
      runSearch: runSearchForTool,
      snapshotFor: (attempt) => frozenRef.current.get(attempt) ?? null,
      openAddress: async (address, op) => {
        const ok = await resolveAndOpenAddress(address, op.signal, requestOpenPlace);
        return ok ? { ok: true } : { ok: false, reason: "geocodeFailed" };
      },
    };
  });
  useEffect(() => {
    const bridge: HomeBridge = {
      read: () => homeBridgeImplRef.current!.read(),
      runSearch: (request, op) => homeBridgeImplRef.current!.runSearch(request, op),
      snapshotFor: (attempt) => homeBridgeImplRef.current!.snapshotFor(attempt),
      openAddress: (address, op) => homeBridgeImplRef.current!.openAddress(address, op),
    };
    publishView("home", bridge);
    return () => withdrawView("home", bridge);
  }, []);
  useEffect(() => {
    markNearby(nearbyOpen);
  }, [nearbyOpen]);
  // navigator(spec §5.2): 도구가 화면을 옮기는 유일한 길 — 전부 화면이 원래 쓰는 핸들러를 지난다.
  const navImplRef = useRef<ViewNavigator | null>(null);
  useEffect(() => {
    navImplRef.current = {
      toHome: toHomeForTool,
      toDirections: () => {
        if (!directionsOpenRef.current) openDirections(null);
      },
      toPlace: (place) => requestOpenPlace(place),
      isModalOpen: () =>
        manualPickerOpenRef.current ||
        generalChatRef.current !== null ||
        (bridgeOf<PlaceBridge>("place")?.bridge.read().chatOpen ?? false),
    };
  });
  useEffect(() => {
    setNavigator({
      toHome: (op) => navImplRef.current!.toHome(op),
      toDirections: (op) => navImplRef.current!.toDirections(op),
      toPlace: (place, op) => navImplRef.current!.toPlace(place, op),
      isModalOpen: () => navImplRef.current!.isModalOpen(),
    });
    return () => setNavigator(null);
  }, []);

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
    // 웹은 0건 폴백일 때만 발사되므로 webPending(대기 중)으로 판정한다 — 폴백을 안 한
    // 검색(대부분)은 webPending=false라 장소·주소 settled 즉시 포커스가 옮겨진다.
    // (webResults!==null로 판정하면 폴백 미발사 검색이 영원히 포커스를 못 받는다.)
    const webSettled = !canSearchWeb || !webPending;
    // runQuerySearch가 performSearch에서 status=loading을 동기 세팅하므로 검색이
    // 시작되면 status.kind !== "idle"이 항상 참 — addr 절은 명시적 안전망일 뿐
    // 실질 dead code다(의도 보존용으로 남김).
    const anyStarted =
      status.kind !== "idle" ||
      (canSearchAddress && addrStatus.kind !== "idle");
    if (placeSettled && addrSettled && webSettled && anyStarted) {
      if (!focusedForSearchRef.current) {
        focusedForSearchRef.current = true;
        // 정렬 전환 재조회는 사용자가 토글에 커서를 둔 채 일으킨 것 — 헤딩으로 옮기지
        // 않는다(라벨 전환 + 건수 통지가 결과 신호).
        if (keepFocusOnSortRef.current) keepFocusOnSortRef.current = false;
        else requestAnimationFrame(() => resultsHeadingRef.current?.focus());
      }
    } else if (status.kind === "loading" || addrStatus.kind === "loading") {
      // 새 검색이 시작되면 다음 settled에서 다시 포커스하도록 리셋.
      focusedForSearchRef.current = false;
    }
  }, [status.kind, addrStatus.kind, canSearchAddress, canSearchWeb, webPending]);

  // 단일 polite 채널 통지. coordError(주소 선택 후 좌표 실패)는 검색 완료 통지와
  // 시점이 달라 우선 노출.
  const placeCount = status.kind === "done" ? status.result.places.length : null;
  const addrCount = addrStatus.kind === "done" ? addrStatus.addresses.length : null;
  const webCount = webResults ? webResults.length : null;
  const loading = status.kind === "loading" || addrStatus.kind === "loading";
  const liveParts: LivePart[] | null =
    addrStatus.kind === "coordError"
      ? [{ key: "search.addressCoordFailed" }]
      : combinedLiveMessage({
          loading,
          placeCount,
          addrCount,
          webCount,
          spokenQuery,
          placeErrored: status.kind === "error",
          addrErrored: addrStatus.kind === "error",
        });
  const liveMessage = manualNotice
    ? manualNotice
    : status.kind === "idle" && recentNotice
      ? recentNotice
      : (liveParts ?? [])
          .map((p) =>
            p.key === "search.searchingFor"
              ? t(p.key, { query: spokenQuery ?? "" })
              : t(p.key, p.values ?? {}),
          )
          .join(", ");
  // 모달이 화면을 점유하는 동안 갱신을 멈춘다(아래 live region 주석이 근거).
  const heldLive = useHeldValue(liveMessage);

  // 길찾기 뷰가 열려 있으면 최우선 렌더(상세 위에도 쌓일 수 있음).
  const canShowDirections = canShowTransit || canBriefCarRoute || canShowWalk;
  if (directions) {
    return (
      <DirectionsView
        canShowWalk={canShowWalk}
        canShowTransit={canShowTransit}
        canBriefCarRoute={canBriefCarRoute}
        initialFrom={directions.from}
        initialTo={directions.to}
        initialToText={directions.toText ?? null}
        onBack={backFromDirections}
      />
    );
  }

  // "내 주변" 허브가 열려 있으면 최우선 렌더 다음 순위(상세보다 앞 — 홈에서만 진입).
  if (nearbyOpen) {
    return (
      <NearbyHub
        canShowAround={canShowAround}
        canShowSubway={canShowSubway}
        canShowBus={canShowBus}
        canShowBike={canShowBike}
        canShowClinic={canShowClinic}
        canShowBarrierFree={canShowBarrierFree}
        canShowKids={canShowKids}
        canShowEvents={canShowEvents}
        canShowAir={canShowAir}
        locationNotice={manualNotice}
        onBack={backFromNearbyHub}
      />
    );
  }

  // 상세 화면이면 상세만 렌더(같은 페이지 뷰 전환).
  // key={`${selected.id}-${openSeq}`}: 채팅 카드로 다른 장소 상세로 교체될 때
  // 같은 PlaceDetail 인스턴스가 재사용되면 내부 chatOpen 상태가 남아 새 장소
  // 위에 옛 채팅이 뜬다 — key로 재마운트를 강제해 리셋한다. openSeq를 함께
  // 섞는 이유: 장소 앵커 채팅에서 앵커 자신(같은 id)이 카드로 돌아오면 id만으론
  // key가 안 바뀌어 리마운트가 스킵된다(헤딩 포커스 effect는 [place.id]
  // 의존이라 key 없이도 동작하지만, key가 chatOpen 리셋까지 보장한다).
  if (selected) {
    return (
      <PlaceDetail
        key={`${selected.id}-${openSeq}`}
        place={selected}
        onOpenDirections={
          canShowDirections
            ? () =>
                openDirections({
                  kind: "place",
                  label: selected.name,
                  coord: { lat: selected.lat, lng: selected.lng },
                })
            : undefined
        }
        canShowBus={canShowBus}
        canShowBike={canShowBike}
        canShowSubway={canShowSubway}
        canShowAir={canShowAir}
        canShowBarrierFree={canShowBarrierFree}
        canShowChat={canShowChat}
        onBack={backToResults}
      />
    );
  }

  // 거리순 재정렬은 정확도순 전환으로 폐기(스펙 2026-07-20), distanceMeters는
  // 서버가 이미 주석(annotateDistances)했으므로 provider 관련도 순서를 그대로 쓴다.
  const places = status.kind === "done" ? status.result.places : [];
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

  // 세 섹션 카운트(미완료는 0으로 — 적응형 순서/헤딩 판정용). 셋 모두 병렬 공존 가능.
  const placeResultCount = status.kind === "done" ? places.length : 0;
  const addrResultCount =
    addrStatus.kind === "done" ? addrStatus.addresses.length : 0;
  const webResultCount = webResults ? webResults.length : 0;
  const sectionOrder = orderResultSections(
    placeResultCount,
    addrResultCount,
    webResultCount,
  );
  // 둘 이상 섹션이 렌더될 때만 구분 헤딩(단일 섹션은 헤딩 없이).
  // 장소·주소·웹은 항상 병렬이라 공존 시 헤딩이 자연히 켜진다.
  const showSectionHeadings = sectionOrder.length > 1;

  // 결과 영역 최상단 헤딩 텍스트 — 합산 통지와 동일 규칙.
  const headingParts: LivePart[] | null = combinedLiveMessage({
    loading: false,
    placeCount: status.kind === "done" ? places.length : null,
    addrCount: addrStatus.kind === "done" ? addrStatus.addresses.length : null,
    webCount: webResults ? webResults.length : null,
    spokenQuery: null,
    placeErrored: status.kind === "error",
    addrErrored: addrStatus.kind === "error",
  });
  const resultsHeading =
    (headingParts ?? []).map((p) => t(p.key, p.values ?? {})).join(", ");

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
        <ResultList places={filtered} onOpen={openDetail} />
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

      <LocationBar
        onPick={() => {
          manualPickerTriggerRef.current = document.activeElement as HTMLElement | null;
          heldLive.hold();
          setManualPickerOpen(true);
        }}
      />
      {manualPickerOpen && (
        <ManualLocationPicker
          onClose={() => {
            setManualPickerOpen(false);
            heldLive.release();
            manualPickerTriggerRef.current?.focus();
          }}
        />
      )}

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={runSearch}
        busy={status.kind === "loading"}
        onTranscribed={handleTranscribed}
        inputRef={searchInputRef}
        onAsk={canShowChat ? openGeneralChat : undefined}
      />

      {generalChat && (
        <ChatOverlay
          initialMessage={generalChat.seed}
          onClose={() => {
            setGeneralChat(null);
            searchInputRef.current?.focus();
          }}
        />
      )}

      {/* "현재 위치 지정" 모달이 화면을 점유하는 동안은 **갱신을 멈춘다** — 모달
          자신의 live region과 동시에 발화하면 스크린리더에서 한쪽이 잘리거나 순서가
          뒤집힌다(NearbyHub의 같은 처리와 동형). ⚠ 비우면 안 된다: `X → "" → X`가
          닫는 순간 두 번째 발화를 만들고, 그 시점은 포커스가 트리거로 복귀하며
          결과 신호인 새 라벨이 낭독되는 자리라 경쟁자가 붙는다. */}
      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {heldLive.shown}
      </p>

      {/* 결정론 내비 칩: [길찾기] [내 주변] — 홈의 기능 진입은 이 행 하나로 수렴. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {canShowDirections && (
          <button
            ref={dirEntryRef}
            type="button"
            onClick={() => openDirections(null)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
          >
            <Route aria-hidden="true" className="h-4 w-4" />
            {t("directions.title")}
          </button>
        )}
        <button
          ref={nearbyEntryRef}
          type="button"
          onClick={openNearbyHub}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
        >
          <Compass aria-hidden="true" className="h-4 w-4" />
          {t("nearby.hubEntry")}
        </button>
      </div>

      {/* 최근 검색(스펙 2026-07-26): 검색 전 초기 상태에만. 자동 등장 정적 목록이라
          heading이 발견 경로 — 같은 idle 화면의 형제 섹션 10종과 동급인 h3(section
          heading, h2는 결과 헤딩 전용). 목록 비면 섹션 자체 미노출. */}
      {status.kind === "idle" && recentQueries.length > 0 && (
        <section className="mt-4">
          <h3 className="text-base font-semibold">{t("recent.title")}</h3>
          <ul className="mt-2">
            {recentQueries.map((q, i) => (
              <li key={q.text} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSpokenQuery(null);
                    setQuery(q.text);
                    void runQuerySearch(q.text);
                  }}
                  className="min-h-11 flex-1 text-left text-sm underline"
                >
                  {/* 고정 항목은 라벨 접미사 하나로 시각·낭독 동시 전달(한 줄 = 한 객체) */}
                  {q.pinned ? joinText(q.text, t("recent.pinned")) : q.text}
                </button>
                {/* 시각 라벨은 "고정"/"삭제", 접근 이름은 항목명 포함(동명 버튼 구분 — 정보 보강이라 덮기 아님).
                    고정이 삭제보다 앞(위원장 지시 2026-08-12). */}
                <button
                  type="button"
                  aria-label={t(q.pinned ? "recent.unpinItem" : "recent.pinItem", {
                    name: q.text,
                  })}
                  onClick={() => togglePinRecent(q)}
                  className="min-h-11 rounded-md border border-border px-3 text-sm"
                >
                  {t(q.pinned ? "recent.unpin" : "recent.pin")}
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    recentDeleteRefs.current[i] = el;
                  }}
                  aria-label={t("recent.deleteItem", { name: q.text })}
                  onClick={() => deleteRecent(q.text, i)}
                  className="min-h-11 rounded-md border border-border px-3 text-sm"
                >
                  {t("recent.delete")}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={clearRecent}
            className="mt-1 min-h-11 text-sm underline"
          >
            {t("recent.clearAll")}
          </button>
        </section>
      )}

      {/* 리뷰순 토글(spec 2026-08-17 §4.1): ko + 네이버 키일 때만. 라벨 전환이 곧 상태
          신호. 결과 컨테이너 밖에 두는 이유 — 컨테이너는 loading 중 언마운트되어
          포커스를 쥔 토글이 사라진다(포커스 유지 계약). 칩 행에 넣지 않는다(칩은 클라
          필터, 이건 서버 재조회). */}
      {canSortByReview && dataLocale(locale) === "ko" && status.kind !== "idle" && (
        <button
          type="button"
          onClick={() => void toggleSort()}
          aria-disabled={status.kind === "loading" || undefined}
          className="mt-4 min-h-11 text-sm underline"
        >
          {t(sort === "review" ? "search.sortByAccuracy" : "search.sortByReview")}
        </button>
      )}

      {/* 웹은 장소·주소와 병렬인 보조 보완 섹션이라, 장소가 에러/로딩이고 주소가
          없어도 웹 결과만 있으면 컨테이너를 그려 웹 단독 결과가 가려지지 않게 한다.
          장소 에러는 웹/주소 결과가 없을 때만 live region이 통지하므로
          (combinedLiveMessage가 parts 전부 0일 때 search.error 반환),
          status.kind==="error"는 조건에 넣지 않는다(빈 컨테이너·중복 헤딩 방지). */}
      {(status.kind === "done" ||
        addrStatus.kind === "done" ||
        (canSearchWeb && webResults !== null && webResults.length > 0)) && (
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
            sectionOrder.map((kind) => {
              if (kind === "place") {
                return (
                  <section key="place" className="mt-4">
                    {showSectionHeadings && (
                      <h3 className="text-lg font-semibold">
                        {t("search.placeSection")}
                      </h3>
                    )}
                    {placeSectionBody}
                  </section>
                );
              }
              if (kind === "web") {
                return (
                  <section key="web" className="mt-4">
                    {showSectionHeadings && (
                      <h3 className="text-lg font-semibold">
                        {t("search.webSection")}
                      </h3>
                    )}
                    {/* 검색창 섹션 구분 헤딩은 위에서 그리므로 카드 내부 헤딩은 끈다. */}
                    <WebResults results={webResults ?? []} showHeading={false} />
                  </section>
                );
              }
              return (
                <section key="address" className="mt-4">
                  {showSectionHeadings && (
                    <h3 className="text-lg font-semibold">
                      {t("search.addressSection")}
                    </h3>
                  )}
                  {addressSectionBody}
                </section>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

/** `signal`이 끊기면 즉시 깨어난다(도구 언와인드 대기용). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
