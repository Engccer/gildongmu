"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { TransitRoute, TransitRouteResult } from "@/lib/types";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { formatDistance, joinText } from "@/lib/format";
import { alternativeNameKey } from "@/lib/transit-alternative-name";
import { quickExitText } from "@/lib/quick-exit-text";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" } // 경로 없음(graceful)
  | { kind: "outOfCoverage" }
  | { kind: "done"; result: TransitRouteResult };

/**
 * 대중교통 경로 텍스트 브리핑 — 자동차 브리핑(CarRouteBriefing)과 동형.
 * 채팅 렌더 카드(MessageBubble `transit-route`) 전용 온디맨드 위젯 — 장소 상세
 * 진입점은 "여기까지 길찾기"(DirectionsView)와 중복이라 제거(2026-07-30).
 * 출발지는 현재 위치 기본. 추천경로 1개를 낭독 정본으로 표시하고 대안은
 * 펼치기. 실주행은 딥링크 위임(설계 §1).
 */
export function TransitRouteBriefing({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("route.transit");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // ⚠ 담기는 것은 "펼쳐진 것"이 아니라 **"기본값에서 뒤집힌 것"**이다 — 추천은
  // 기본 펼침, 대안은 기본 접힘이라 한 집합으로 둘을 다루려면 이 의미여야 하고,
  // 새 조회 때 비우면 그대로 각자의 기본 상태가 된다. 키는 인덱스가 아니라
  // `routeKey`다(순서가 바뀌면 인덱스는 다른 경로를 가리킨다).
  const [toggledRoutes, setToggledRoutes] = useState<Set<string>>(new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const reqId = useRef(0);
  const focusedRef = useRef(false);

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
      // 커버리지 마커는 200이라 res.ok보다 먼저 검사한다(NightClinicsNearby 정본 순서).
      if (isOutOfCoverageBody(body)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
      if (!res.ok) {
        // 서버의 한국어 `error` 문자열은 낭독하지 않는다 — status로 자기 언어 문장을 고른다
        // (`useVoiceRecorder` 선례, A26).
        setStatus({
          kind: "error",
          message: res.status === 503 ? t("notConfigured") : t("error"),
        });
        return;
      }
      if (!body.result) {
        setStatus({ kind: "empty" });
        return;
      }
      setToggledRoutes(new Set());
      setStatus({ kind: "done", result: body.result as TransitRouteResult });
    } catch {
      if (myReq === reqId.current)
        setStatus({ kind: "error", message: t("error") });
    }
  }

  // done 진입 시 결과 헤딩으로 포커스 이동 — fetch 콜백 rAF는 React 커밋과
  // 인과관계가 없어 레이스(repo 실측) — useEffect는 커밋 이후 실행 보장.
  useEffect(() => {
    if (status.kind === "done") {
      if (!focusedRef.current) {
        focusedRef.current = true;
        headingRef.current?.focus();
      }
    } else {
      focusedRef.current = false;
    }
  }, [status.kind]);

  function requestFromCurrent() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(내 주변 버튼들과 동형, navigator.geolocation 직접 호출 금지).
    void awaitGeolocation().then(async (g) => {
      if (g.status !== "ready") {
        setStatus({ kind: "error", message: t("geoError") });
        inFlight.current = false;
        return;
      }
      if (!isInKorea(g.coords.lat, g.coords.lng)) {
        setStatus({ kind: "outOfCoverage" });
        inFlight.current = false;
        return;
      }
      await fetchRoute(g.coords.lat, g.coords.lng);
      inFlight.current = false;
    });
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
            : status.kind === "outOfCoverage"
              ? tCommon("outOfCoverage")
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
          {/* 추천·대안을 한 목록으로(길찾기 뷰와 동형). 라벨·컨트롤·본문 구성이
              같고 초기 펼침 상태만 다르다 — 추천만 펼친 채로 시작한다. */}
          {[
            {
              route: status.result.recommended,
              // 1순위는 축 라벨을 갖지 않는다(annotateHighlights) — 고정 이름.
              name: t("recommended"),
              defaultExpanded: true,
            },
            ...status.result.alternatives.map((alt) => {
              // 이름 산출은 길찾기 뷰와 공유한다(두 화면의 이름이 갈리면
              // 같은 경로가 다른 이름으로 불린다)
              const named = alternativeNameKey(alt);
              return {
                route: alt,
                name: t(named.key, named.values),
                defaultExpanded: false,
              };
            }),
          ].map(({ route, name, defaultExpanded }) => {
            const expanded = toggledRoutes.has(route.routeKey)
              ? !defaultExpanded
              : defaultExpanded;
            return (
              <div key={route.routeKey} className="mt-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setToggledRoutes((prev) => {
                      const next = new Set(prev);
                      if (next.has(route.routeKey)) next.delete(route.routeKey);
                      else next.add(route.routeKey);
                      return next;
                    })
                  }
                  className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                >
                  {joinText(
                    name,
                    t("summary", {
                      minutes: route.summary.totalMinutes,
                      fare: route.summary.fare.toLocaleString(locale),
                      transfers: route.summary.transfers,
                    }),
                    route.summary.walkMinutes > 0
                      ? t("walkSummary", { minutes: route.summary.walkMinutes })
                      : null,
                  )}
                </button>
                {expanded && (
                  <TransitRouteResult
                    route={route}
                    t={t}
                    locale={locale}
                    dest={dest.name}
                    includeSummary={false}
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

/** 경로 1개의 요약 + 구간 리스트. 고유명(노선·정류장)은 lang="ko".
    includeSummary=false는 대안 펼침 전용 — 펼침 버튼 라벨이 이미 요약이라
    본문에서 재낭독하지 않는다(인접 중복 금지). */
export function TransitRouteResult({
  route,
  t,
  locale,
  dest,
  includeSummary = true,
}: {
  route: TransitRoute;
  t: ReturnType<typeof useTranslations<"route.transit">>;
  locale: string;
  dest: string;
  includeSummary?: boolean;
}) {
  let boardSeen = 0;
  return (
    <>
      {includeSummary && (
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
      )}
      <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
        {route.legs.map((leg, i) => {
          if (leg.mode === "walk") {
            // 마지막 도보는 provider가 이름을 모른다(뒤에 탑승 구간이 없다).
            // 소비자가 목적지 이름을 알면 그것을, 모르면 "목적지까지"라는 구간
            // 의미를 쓴다(이름 부재와 구간 의미 부재는 다른 층이다).
            const name = leg.toName ?? dest;
            // 거리는 3-state: 필드가 없으면 "0m"가 아니라 거리 없는 문구로 떨어진다
            const distance =
              leg.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
            const key = name
              ? distance
                ? "legWalkTo"
                : "legWalkToNoDistance"
              : distance
                ? "legWalkToDest"
                : "legWalkToDestNoDistance";
            return (
              <li key={i}>
                {t(key, {
                  minutes: leg.minutes,
                  ...(name ? { name } : {}),
                  ...(distance ? { distance } : {}),
                })}
              </li>
            );
          }
          // 고유명(노선·정류장)은 <line>/<from> 태그 핸들러로 lang="ko" 주입
          const messageKey = boardSeen++ === 0 ? "legBoard" : "legTransfer";
          const quickExit = quickExitText(t, leg.toName ?? "", leg.quickExit);
          return (
            <li key={i}>
              {t.rich(messageKey, {
                // 버스 번호는 그대로면 "370"이라 무엇인지 알 수 없다(지하철은
                // "수도권 5호선"이라 수단이 드러난다). ⚠ 이 자리는 번역문이라
                // lang="ko"를 씌우지 않는다 — en "bus 370"의 "bus"까지 한국어
                // 음성으로 낭독된다. 감싸도 되는 건 ODsay 원문뿐이다.
                line: (chunks) =>
                  leg.mode === "bus" && leg.lineName ? (
                    t("busNo", { route: leg.lineName })
                  ) : (
                    <span lang="ko">{leg.lineName ?? chunks}</span>
                  ),
                from: (chunks) => <span lang="ko">{leg.fromName ?? chunks}</span>,
                count: leg.stationCount ?? 0,
              })}
              {/* 배차간격은 같은 li 텍스트에 쉼표로 이어붙인다(한 줄=한 객체) */}
              {leg.intervalMinutes != null && (
                <>, {t("legInterval", { minutes: leg.intervalMinutes })}</>
              )}
              {/* 운행 밖만 표기한다. 정상·정보없음까지 표기하면 매 항목에 노이즈가
                  붙는다(조건부 실패 표기 원칙). 같은 li에 쉼표로 이어 한 줄=한 객체 유지 */}
              {leg.serviceStatus === "outside" &&
                leg.firstServiceTime &&
                leg.lastServiceTime && (
                  <>
                    ,{" "}
                    {t("legServiceOutside", {
                      first: leg.firstServiceTime,
                      last: leg.lastServiceTime,
                    })}
                  </>
                )}
              {/* 빠른하차는 별도 문장이라 같은 줄에 쉼표로 잇지 않고 다음 블록으로 둔다
                  (한 줄=한 객체는 "한 줄을 쪼개지 말라"이지 "여러 문장을 합치라"가 아니다).
                  판정 불가·미커버는 필드 부재라 이 자리가 통째로 비고 문구도 없다 */}
              {quickExit && <p className="mt-0.5">{quickExit}</p>}
            </li>
          );
        })}
      </ol>
      {/* 마지막 구간이 도보면 그 문장이 이미 목적지 도착을 말한다. 뒤에 하차역
          이름으로 "도착"을 덧붙이면 순서가 거꾸로다(도보는 하차역에서 목적지로 간다) */}
      {route.legs[route.legs.length - 1]?.mode !== "walk" && (
        <p className="mt-1 text-sm">
          {t.rich("arrive", {
            name: () => (
              <span lang="ko">{route.summary.arriveName ?? dest}</span>
            ),
          })}
        </p>
      )}
    </>
  );
}
