"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusStop } from "@/lib/types";
import { formatDistance, durationToMinutes, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { BusRouteStops } from "./BusRouteStops";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; stops: BusStop[]; at: string };

/**
 * 근처 정류소 + 도착 예정 버스 — 지도 없이 완결되는 대중교통 정보 정본.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회(위치 단계 없음).
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침" + 조회시각으로 신선도를 보장한다
 * (스크린 리더에 반복 통지가 끼어들지 않도록 — 접근성 결정).
 */
export function BusArrivals(
  props:
    | { mode: "current" }
    | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bus");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/bus/nearby?lat=${lat}&lng=${lng}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stops = (body.stops ?? []) as BusStop[];
      if (stops.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", stops, at });
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load(force = false) {
    const prevStatus = status;
    // 홈(current)에서만 아코디언 점유를 가져간다 — 다른 펼친 패널이 스스로 닫힌다.
    // 상세(place)에선 단일 패널이라 조정 불필요.
    if (props.mode === "current") claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    if (props.mode === "place") {
      void fetchAt(props.lat, props.lng).finally(done);
      return;
    }
    // current 모드 — 공유 스토어에서 좌표를 얻는다(세션 1회 권한 획득 뒤 캐시 재사용,
    // 매 버튼마다 getCurrentPosition을 부르지 않아 팝업이 반복되지 않음).
    setStatus({ kind: "locating" });
    void awaitGeolocation({ force }).then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        // 새로고침(force) 실패 시 보던 데이터를 잃지 않는다 — done이면 직전 결과를
        // 복원하고, 첫 조회 실패면 geoerror. 실내 등에서 정밀 재취득(GPS)이 자주
        // 실패할 수 있어 데이터 소멸을 막는다.
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        done();
      }
    });
  }

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  // place 모드는 상세 화면의 단일 패널 → engaged=false로 아코디언/Esc 비활성.
  const { claim } = useNearbyPanel({
    engaged: props.mode === "current" && status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  // done 진입 시 결과 헤딩으로 포커스 이동(접근성 1급). fetch 완료 직후 rAF로
  // 옮기면 React 커밋과 인과관계가 없어 레이스가 생긴다(헤딩이 아직 DOM에
  // 없을 수 있음) — useEffect는 커밋 이후 실행이 보장되므로 안전하다
  // (PlaceDetail·PlaceSearch의 결과 헤딩 포커스와 동형).
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

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel =
    status.kind === "done"
      ? t("refresh")
      : props.mode === "current"
        ? t("currentButton")
        : t("placeButton");

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "empty"
          ? t("empty")
          : status.kind === "error"
            ? t("error")
            : status.kind === "geoerror"
              ? status.reason === "denied"
                ? t("geoDenied")
                : t("geoUnsupported")
              : status.kind === "done"
                ? t("ready")
                : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => load(status.kind === "done")}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <div
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {`${t("ready")} ${t("asOf", { time: status.at })}`}
          </h3>

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-3">
            {status.stops.map((stop) => (
              <li key={`${stop.source}-${stop.cityCode}-${stop.nodeId}`}>
                <h4 className="font-medium" lang="ko">
                  {joinText(
                    stop.name,
                    t("stopDistance", {
                      distance: formatDistance(stop.distanceMeters),
                    }),
                  )}
                </h4>
                {stop.arrivalStatus === "unavailable" ? (
                  // 도착조회 실패 ≠ 버스 없음(개정 노트 §1) — 별도 문구로 통지
                  <p className="text-sm opacity-70">{t("arrivalUnavailable")}</p>
                ) : stop.arrivals.length === 0 ? (
                  <p className="text-sm opacity-70">{t("noArrivals")}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {stop.arrivals.map((a, i) => {
                      const type =
                        a.routeType || (a.lowFloor ? t("lowFloor") : t("normalBus"));
                      return (
                        <li key={`${a.source}-${a.routeId}-${i}`}>
                          {/* 한 줄 = 한 객체: 도착 문장과 저상버스 배지를 단일
                              텍스트로 합친다. 저상 정보는 routeType이 없을 때 이미
                              type으로 낭독되므로, 중복 낭독을 피해 routeType이 있을
                              때만 배지를 흡수한다(정보 집합은 동일). */}
                          <span lang="ko">
                            {/* 서울은 arrmsg1 완성 문장이 정본(arrivalMessage), TAGO는 슬롯형. */}
                            {joinText(
                              a.arrivalMessage
                                ? t("arrivalMessage", {
                                    route: a.routeNo,
                                    type,
                                    message: a.arrivalMessage,
                                  })
                                : t("arrival", {
                                    route: a.routeNo,
                                    type,
                                    prev: a.prevStationCount,
                                    min: durationToMinutes(a.arrivalSeconds),
                                  }),
                              a.routeType && a.lowFloor && t("lowFloor"),
                            )}
                          </span>
                          <BusRouteStops
                            source={stop.source}
                            cityCode={stop.cityCode}
                            routeId={a.routeId}
                            routeNo={a.routeNo}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
