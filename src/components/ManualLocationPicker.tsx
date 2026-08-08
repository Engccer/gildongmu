"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { JusoAddress, Place, PlaceSearchResult } from "@/lib/types";
import { dataLocale } from "@/lib/data-locale";
import { normalizeVoiceQuery } from "@/lib/format";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import { awaitRealFix } from "@/lib/effective-location";
import { isEligibleFix } from "@/lib/manual-location";
import { setManualLocation } from "@/lib/manual-location-store";
import { orderResultSections, combinedLiveMessage } from "@/lib/search-sections";
import { SearchBar } from "./SearchBar";
import { ResultList } from "./ResultList";
import { AddressResultList } from "./AddressResultList";

type SearchStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; places: Place[]; addresses: JusoAddress[] };

/**
 * "현재 위치 지정" 검색 — `LocationBar`(홈·"내 주변" 허브 두 진입점)가 공유하는
 * 단일 정본. 기존 장소·주소 검색(`/api/places` · `/api/address/search`,
 * `PlaceSearch`·`DirectionsView`와 같은 API)을 재사용해 후보를 고르고, 선택하면
 * 그 좌표를 수동 위치로 지정한다.
 *
 * 진입점을 두 화면에 복붙하면 한쪽만 놓치는 회귀가 난다(과거 장소+주소 병렬검색이
 * 세 진입점 중 하나에서만 빠졌던 사고와 동형) — 검색·확정 로직은 이 컴포넌트
 * 하나로 묶고, 호출부(PlaceSearch·NearbyHub)는 열림 상태 불리언만 각자 갖는다.
 *
 * `origin`은 지정 시점의 적격 실측 fix다(`effective-location.ts`) — 없으면 이동
 * 판정이 영원히 undecidable이 되어 자동 해제가 동작하지 않으므로, 후보를 고른
 * 즉시 실측을 시도한다.
 *
 * `role="dialog"` 풀스크린 셸(`ChatOverlay` 동형): 열릴 때 제목으로 포커스 이동,
 * Esc·닫기 버튼 두 경로, Tab 포커스 트랩. i18n 새 키를 추가하지 않는다 — 화면
 * 제목·입력 라벨은 `search.label`(장소 검색), 닫기는 `actions.close`, 좌표 실패는
 * `directions.coordError`, 실측 대기는 `directions.locating`을 그대로 쓴다.
 */
export function ManualLocationPicker({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  const [addrCoordError, setAddrCoordError] = useState(false);
  const [committing, setCommitting] = useState(false);
  const reqIdRef = useRef(0);
  // 좌표 확정(주소 지오코딩 → 실측 fix 대기) in-flight 가드. state만으론 같은
  // 틱의 더블클릭을 못 막는다(repo 관례 — VoiceRecordButton 동형).
  const committingRef = useRef(false);
  // commitManual 성공 시 onClose()가 이 컴포넌트를 언마운트시킨다 — 뒤이은
  // finally의 setCommitting은 그 재렌더가 실제로 반영된 뒤일 수 있어 가드한다.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 열릴 때 제목으로 포커스 이동(ChatOverlay 동형).
  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc 닫기 + Tab 포커스 트랩(ChatOverlay 동형).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function runSearch(rawQuery?: string) {
    const q = (rawQuery ?? query).trim();
    if (!q) return;
    const myId = ++reqIdRef.current;
    setAddrCoordError(false);
    setStatus({ kind: "loading" });
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
    if (myId !== reqIdRef.current) return;
    // 3-state: 결과 0건과 조회 실패를 구분한다 — 둘 다 실패했을 때만 오류.
    if (placesRes.status === "rejected" && addrRes.status === "rejected") {
      setStatus({ kind: "error" });
      return;
    }
    const places = placesRes.status === "fulfilled" ? placesRes.value.places : [];
    const addresses =
      addrRes.status === "fulfilled" ? addrRes.value.addresses : [];
    setStatus({ kind: "done", places, addresses });
  }

  function handleTranscribed(text: string) {
    // 후행 마침표 제거(PlaceSearch·EndpointField 동형) — 주소 검색은 숫자로
    // 끝나는 경우가 많아 마침표 한 글자에 juso가 0건으로 전멸한다.
    const q = normalizeVoiceQuery(text);
    setQuery(q);
    void runSearch(q);
  }

  async function commitManual(label: string, lat: number, lng: number) {
    if (committingRef.current) return;
    committingRef.current = true;
    setCommitting(true);
    try {
      const fix = await awaitRealFix({ force: true });
      const now = Date.now() / 1000;
      const origin =
        fix && isEligibleFix(fix, now)
          ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: fix.at }
          : null;
      setManualLocation({ label, lat, lng, origin, setAt: now });
      onClose();
    } finally {
      committingRef.current = false;
      if (mountedRef.current) setCommitting(false);
    }
  }

  async function selectAddress(addr: JusoAddress) {
    if (committingRef.current) return;
    setAddrCoordError(false);
    const target = addr.roadAddrPart1 || addr.roadAddr;
    const r = await resolveAddressCoord(target);
    if (r.kind !== "resolved") {
      setAddrCoordError(true);
      return;
    }
    void commitManual(target, r.lat, r.lng);
  }

  const places = status.kind === "done" ? status.places : [];
  const addresses = status.kind === "done" ? status.addresses : [];
  const sectionOrder = orderResultSections(places.length, addresses.length);
  const showSectionHeadings = sectionOrder.length > 1;

  const liveParts = combinedLiveMessage({
    loading: status.kind === "loading",
    placeCount: status.kind === "done" ? places.length : null,
    addrCount: status.kind === "done" ? addresses.length : null,
    spokenQuery: null,
    placeErrored: status.kind === "error",
  });
  const liveMessage = addrCoordError
    ? t("directions.coordError")
    : committing
      ? t("directions.locating")
      : (liveParts ?? []).map((p) => t(p.key, p.values ?? {})).join(", ");

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          {t("search.label")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("actions.close")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border hover:bg-accent/10"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => void runSearch()}
        busy={status.kind === "loading" || committing}
        onTranscribed={handleTranscribed}
      />

      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {liveMessage}
      </p>

      {sectionOrder.map((kind) =>
        kind === "place" ? (
          <section key="place" className="mt-2">
            {showSectionHeadings && (
              <h3 className="text-base font-semibold">
                {t("search.placeSection")}
              </h3>
            )}
            <ResultList
              places={places}
              onOpen={(place) =>
                void commitManual(place.name, place.lat, place.lng)
              }
            />
          </section>
        ) : (
          <section key="address" className="mt-2">
            {showSectionHeadings && (
              <h3 className="text-base font-semibold">
                {t("search.addressSection")}
              </h3>
            )}
            <AddressResultList addresses={addresses} onSelect={selectAddress} />
          </section>
        ),
      )}
    </div>
  );
}
