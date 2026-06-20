"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusStop } from "@/lib/types";
import { formatDistance, durationToMinutes } from "@/lib/format";
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
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
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
    void awaitGeolocation().then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        setStatus({
          kind: "geoerror",
          reason: g.status === "unsupported" ? "unsupported" : "denied",
        });
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
        onClick={load}
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
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
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
              <li key={`${stop.cityCode}-${stop.nodeId}`}>
                <h4 className="font-medium" lang="ko">
                  {stop.name}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("stopDistance", {
                      distance: formatDistance(stop.distanceMeters),
                    })}
                  </span>
                </h4>
                {stop.arrivalStatus === "unavailable" ? (
                  // 도착조회 실패 ≠ 버스 없음(개정 노트 §1) — 별도 문구로 통지
                  <p className="text-sm opacity-70">{t("arrivalUnavailable")}</p>
                ) : stop.arrivals.length === 0 ? (
                  <p className="text-sm opacity-70">{t("noArrivals")}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {stop.arrivals.map((a, i) => (
                      <li key={`${a.routeId}-${i}`}>
                        <span lang="ko">
                          {t("arrival", {
                            route: a.routeNo,
                            type: a.routeType || (a.lowFloor ? t("lowFloor") : t("normalBus")),
                            prev: a.prevStationCount,
                            min: durationToMinutes(a.arrivalSeconds),
                          })}
                        </span>
                        {a.lowFloor && (
                          <span className="ml-1 rounded bg-accent/10 px-1 text-xs text-accent">
                            {t("lowFloor")}
                          </span>
                        )}
                        <BusRouteStops
                          cityCode={stop.cityCode}
                          routeId={a.routeId}
                          routeNo={a.routeNo}
                        />
                      </li>
                    ))}
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
