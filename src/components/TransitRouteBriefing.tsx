"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  Place,
  PlaceSearchResult,
  TransitRoute,
  TransitRouteResult,
} from "@/lib/types";
import { dataLocale } from "@/lib/data-locale";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" } // 경로 없음(graceful)
  | { kind: "done"; result: TransitRouteResult };

/**
 * 대중교통 경로 텍스트 브리핑 — 자동차 브리핑(CarRouteBriefing)과 동형.
 * 출발지는 현재 위치 기본, "출발지 바꾸기"로 좌표 지정 가능. 추천경로 1개를
 * 낭독 정본으로 표시하고 대안은 펼치기. 실주행은 딥링크 위임(설계 §1).
 */
export function TransitRouteBriefing({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("route.transit");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showAlts, setShowAlts] = useState(false);
  const [showOriginSearch, setShowOriginSearch] = useState(false);
  const [originQuery, setOriginQuery] = useState("");
  const [originResults, setOriginResults] = useState<Place[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const originInputId = useId();
  const inFlight = useRef(false);
  const reqId = useRef(0);

  // 펼친 경로를 다시 감춘다(idle 복귀) — 홈 "내 주변" 패널과 동일하게 결과
  // 블록에 닫기 경로를 준다. 닫은 뒤 포커스를 트리거 버튼으로 되돌린다.
  const close = useCallback(() => {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  async function fetchRoute(originLat: number, originLng: number) {
    const myReq = ++reqId.current;
    setStatus({ kind: "loading" });
    try {
      // 자동차 경로와 달리 lang 파라미터를 보내지 않는다 — ODsay 무료 티어는
      // 국문 응답 전용이라 라우트가 lang을 쓰지 않고, 보내면 캐시만 로케일로
      // 무의미하게 분절된다. en은 컴포넌트에서 구조만 영역화(고유명은 한국어 원문).
      const res = await fetch(
        `/api/route/transit?origin=${originLat},${originLng}&dest=${dest.lat},${dest.lng}`,
      );
      const body = await res.json();
      if (myReq !== reqId.current) return; // stale 응답 폐기
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: typeof body.error === "string" ? body.error : t("error"),
        });
        return;
      }
      if (!body.result) {
        setStatus({ kind: "empty" });
        return;
      }
      setShowAlts(false);
      setStatus({ kind: "done", result: body.result as TransitRouteResult });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      if (myReq === reqId.current)
        setStatus({ kind: "error", message: t("error") });
    }
  }

  function requestFromCurrent() {
    if (inFlight.current) return;
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "error", message: t("geoError") });
      return;
    }
    inFlight.current = true;
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!inFlight.current) return; // selectOrigin 등으로 취소됨
        await fetchRoute(pos.coords.latitude, pos.coords.longitude);
        inFlight.current = false;
      },
      () => {
        setStatus({ kind: "error", message: t("geoError") });
        inFlight.current = false;
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // 출발지 변경: 기존 장소 검색(/api/places) 재사용
  async function runOriginSearch() {
    const q = originQuery.trim();
    if (!q) return;
    try {
      const res = await fetch(
        `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}`,
      );
      const body = (await res.json()) as PlaceSearchResult;
      setOriginResults(res.ok ? (body.places ?? []) : []);
    } catch {
      setOriginResults([]);
    }
  }

  function selectOrigin(place: Place) {
    inFlight.current = false; // 진행 중 geolocation 콜백 무효화
    setShowOriginSearch(false);
    setOriginResults([]);
    setOriginQuery("");
    void fetchRoute(place.lat, place.lng);
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const liveMessage =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "error"
          ? status.message
          : status.kind === "empty"
            ? t("noRoute")
            : status.kind === "done"
              ? t("ready")
              : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={requestFromCurrent}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("button")}
      </button>
      <button
        type="button"
        onClick={() => setShowOriginSearch((v) => !v)}
        aria-expanded={showOriginSearch}
        className="ml-3 min-h-11 text-sm font-medium text-blue-700 underline dark:text-blue-300"
      >
        {t("changeOrigin")}
      </button>

      {showOriginSearch && (
        <div className="mt-2">
          <label htmlFor={originInputId} className="block text-sm font-medium">
            {t("originLabel")}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={originInputId}
              type="text"
              value={originQuery}
              onChange={(e) => setOriginQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runOriginSearch();
              }}
              placeholder={t("originPlaceholder")}
              className="min-h-11 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={runOriginSearch}
              className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
            >
              {t("originLabel")}
            </button>
          </div>
          {originResults.length > 0 && (
            <ul className="mt-1">
              {originResults.map((p) => (
                <li key={`${p.lat},${p.lng}`}>
                  <button
                    type="button"
                    onClick={() => selectOrigin(p)}
                    className="min-h-11 w-full text-left text-sm underline"
                    lang="ko"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <div
          className="mt-2 rounded-md border border-gray-300 p-3"
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", { name: dest.name })}
          </h3>
          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-blue-700 underline dark:text-blue-300"
          >
            {tActions("close")}
          </button>
          <RouteView
            route={status.result.recommended}
            t={t}
            locale={locale}
            dest={dest.name}
          />

          {status.result.alternatives.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowAlts((v) => !v)}
                aria-expanded={showAlts}
                className="min-h-11 text-sm font-medium text-blue-700 underline dark:text-blue-300"
              >
                {t("showAlternatives")}
              </button>
              {showAlts &&
                status.result.alternatives.map((alt, i) => (
                  <div key={i} className="mt-2 border-t border-gray-200 pt-2">
                    <h4 className="text-sm font-semibold">
                      {t("alternativeHeading", { index: i + 1 })}
                    </h4>
                    <RouteView
                      route={alt}
                      t={t}
                      locale={locale}
                      dest={dest.name}
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 경로 1개의 요약 + 구간 리스트. 고유명(노선·정류장)은 lang="ko". */
function RouteView({
  route,
  t,
  locale,
  dest,
}: {
  route: TransitRoute;
  t: ReturnType<typeof useTranslations<"route.transit">>;
  locale: string;
  dest: string;
}) {
  let boardSeen = 0;
  return (
    <>
      <p className="mt-1 text-sm">
        {t("summary", {
          minutes: route.summary.totalMinutes,
          fare: route.summary.fare.toLocaleString(locale),
          transfers: route.summary.transfers,
        })}
        {route.summary.walkMinutes > 0 && (
          <> {t("walkSummary", { minutes: route.summary.walkMinutes })}</>
        )}
      </p>
      <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
        {route.legs.map((leg, i) => {
          if (leg.mode === "walk") {
            return <li key={i}>{t("legWalk", { minutes: leg.minutes })}</li>;
          }
          // 고유명(노선·정류장)은 <line>/<from> 태그 핸들러로 lang="ko" 주입
          const messageKey = boardSeen++ === 0 ? "legBoard" : "legTransfer";
          return (
            <li key={i}>
              {t.rich(messageKey, {
                line: (chunks) => <span lang="ko">{leg.lineName ?? chunks}</span>,
                from: (chunks) => <span lang="ko">{leg.fromName ?? chunks}</span>,
                count: leg.stationCount ?? 0,
              })}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-sm">
        {t.rich("arrive", {
          name: () => (
            <span lang="ko">{route.summary.arriveName ?? dest}</span>
          ),
        })}
      </p>
    </>
  );
}
