"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CategoryBucket } from "@/lib/category";
import {
  bucketsPresent,
  filterPlacesByBucket,
  groupByCategory,
} from "@/lib/category";
import type { Place, PlaceSearchResult } from "@/lib/types";
import { SearchBar } from "./SearchBar";
import { ChipFilter } from "./ChipFilter";
import { ResultList } from "./ResultList";
import { PlaceDetail } from "./PlaceDetail";

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
}: {
  isMockMode: boolean;
  /** 카카오 키가 있어 자동차 경로 텍스트 브리핑을 제공할 수 있는지 */
  canBriefCarRoute?: boolean;
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
  const [selected, setSelected] = useState<Place | null>(null);
  // 음성으로 검색한 질의어(없으면 null=타이핑 검색). 로딩 라이브 메시지를
  // 음성일 때 "‘{질의}’ 검색 중…"으로 바꿔, 인식 텍스트를 polite 한 채널로만
  // 통지한다(VoiceRecordButton의 assertive announce 제거와 한 쌍 — a11y C1).
  const [spokenQuery, setSpokenQuery] = useState<string | null>(null);
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

  // 상세 → 목록 복귀 시 결과 헤딩으로 포커스 이동(접근성 1급).
  // 상세 뷰가 언마운트되면 포커스가 document.body로 유실되므로, 결과 헤딩이
  // 렌더되는 done 상태일 때만 리렌더 후(rAF 한 틱) 헤딩으로 옮긴다. ref가 아직
  // 없을 수 있으니 옵셔널 체이닝으로 가드한다.
  function focusResultsHeadingIfDone() {
    if (statusRef.current.kind !== "done") return;
    requestAnimationFrame(() => resultsHeadingRef.current?.focus());
  }

  // 상세 진입/이탈을 브라우저 히스토리에 연동 — 백버튼이 목록으로 복귀.
  useEffect(() => {
    function onPop() {
      setSelected(null);
      focusResultsHeadingIfDone();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // focusResultsHeadingIfDone은 statusRef로 최신 status를 읽으므로 마운트 시
    // 한 번만 등록해도 안전하다(리스너 재등록 불필요).
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

  /**
   * 검색 실행 — q를 받아 fetch, 결과/오류 상태를 갱신하고 `?q=`를 URL에 보존한다.
   * runSearch(폼 제출)와 첫 마운트 자동검색이 같은 경로를 공유하도록 분리했다.
   */
  const performSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) return;
      const myId = ++reqIdRef.current;
      setBucket(null);
      setStatus({ kind: "loading" });
      // URL ?q= 동기화(공유·새로고침 보존)
      const url = new URL(window.location.href);
      url.searchParams.set("q", q);
      window.history.replaceState(window.history.state, "", url);
      // LanguageSwitcher가 ?q= 변경을 즉시 반영하도록 통지(popstate는 안 뜸).
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      try {
        const res = await fetch(
          `/api/places?query=${encodeURIComponent(q)}&lang=${locale}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as PlaceSearchResult;
        // 최신 요청만 반영 — 늦게 끝난 이전 요청은 여기서 폐기.
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "done", result });
        requestAnimationFrame(() => resultsHeadingRef.current?.focus());
      } catch {
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "error" });
      }
    },
    [locale],
  );

  function runSearch() {
    if (status.kind === "loading") return;
    // 타이핑 검색 경로 — stale spokenQuery 초기화(이전 음성 질의가 로딩 메시지에
    // 남지 않도록).
    setSpokenQuery(null);
    void performSearch(query);
  }

  // 음성 전사 결과 → 입력값 채우고 같은 performSearch 본체로 자동 검색.
  // performSearch는 reqIdRef 최신요청 가드·?q= URL 동기화·결과 헤딩 포커스를
  // 이미 보장하므로, 전사 자동검색도 그 보장을 그대로 물려받는다.
  // spokenQuery를 세팅해 로딩 라이브 메시지가 "‘{질의}’ 검색 중…"으로 나가
  // 인식 텍스트를 polite 한 채널로 통지한다(input에도 채워 시각·편집 확인).
  function handleTranscribed(text: string) {
    setSpokenQuery(text);
    setQuery(text);
    void performSearch(text);
  }

  // 첫 마운트 시 ?q= 있으면 자동 검색.
  // 입력값(query) 초기화는 위 lazy initializer가 이미 처리했다. 자동검색은
  // queueMicrotask로 한 틱 미뤄 실행한다 — performSearch가 동기적으로 부르는
  // setStatus({loading})가 effect 본문이 아니라 콜백에서 일어나게 하여
  // react-hooks/set-state-in-effect(동기 setState로 인한 cascading render 경고)를
  // 정석대로 만족시킨다. 동작(=?q= 자동검색)은 그대로 보존된다.
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) queueMicrotask(() => void performSearch(q));
  }, [performSearch]);

  const liveMessage =
    status.kind === "loading"
      ? spokenQuery
        ? t("search.searchingFor", { query: spokenQuery })
        : t("search.searching")
      : status.kind === "error"
        ? t("search.error")
        : status.kind === "done"
          ? t("search.resultsAnnouncement", {
              count: status.result.places.length,
            })
          : "";

  // 상세 화면이면 상세만 렌더(같은 페이지 뷰 전환).
  if (selected) {
    return (
      <PlaceDetail
        place={selected}
        canBriefCarRoute={canBriefCarRoute}
        onBack={backToResults}
      />
    );
  }

  const places = status.kind === "done" ? status.result.places : [];
  const buckets = bucketsPresent(places);
  const counts = Object.fromEntries(
    buckets.map((b) => [b, filterPlacesByBucket(places, b).length]),
  ) as Record<CategoryBucket, number>;
  const groups = groupByCategory(filterPlacesByBucket(places, bucket));

  return (
    <section aria-label={t("search.label")}>
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

      {/* 스크린 리더 상태 통지 — 시각적으로도 함께 표시 */}
      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <div className="mt-4">
          <h2
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            {t("search.resultsAnnouncement", {
              count: status.result.places.length,
            })}
          </h2>
          {places.length === 0 ? (
            <p className="mt-2">{t("search.noResults")}</p>
          ) : (
            <>
              <div className="mt-3">
                <ChipFilter
                  buckets={buckets}
                  selected={bucket}
                  counts={counts}
                  onSelect={setBucket}
                />
              </div>
              <ResultList groups={groups} onOpen={openDetail} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
