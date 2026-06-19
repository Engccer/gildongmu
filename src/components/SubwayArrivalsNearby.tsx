"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { NearbySubwayStation } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { SubwayArrivalList } from "./SubwayArrivalList";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; stations: NearbySubwayStation[]; at: string };

/**
 * 내 주변 서울 지하철 실시간 도착 — 홈(idle) 진입점. 좌표→근접역→역별 실시간.
 *
 * BusArrivals/BikeStations(mode="current")와 동형: 버튼 → geolocation → 좌표로
 * 조회. 다만 좌표를 직접 받는 버스/따릉이와 달리 지하철은 라우트가 좌표→근접역
 * (A3 seed)→역별 실시간을 합성한다. 실시간이라 자동 폴링하지 않고 수동
 * "새로고침" + 조회시각(asOf)으로 신선도를 보장한다(스크린리더 반복 통지 방지).
 *
 * 부분 실패는 역별 arrivalStatus로 구분 — "조회 실패" 역은 별도 문구,
 * "도착 열차 없음"과 뭉개지 않는다(시각장애인 정합).
 */
export function SubwayArrivalsNearby() {
  const t = useTranslations("subwayNearby");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/station/subway-arrival/nearby?lat=${lat}&lng=${lng}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stations = (body.stations ?? []) as NearbySubwayStation[];
      if (stations.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", stations, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
    claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
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

  // 펼친 결과를 다시 감춘다(idle 복귀). 닫기 버튼은 언마운트되므로 restoreFocus면
  // 포커스를 트리거 버튼으로 되돌려 스크린 리더 사용자가 맥락을 잃지 않게 한다
  // (직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel = status.kind === "done" ? t("refresh") : t("button");

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

          <ul className="mt-2 space-y-4">
            {status.stations.map((s) => (
              <li key={`${s.stationName}-${s.distanceMeters}`}>
                <p className="font-medium">
                  <span lang="ko">{s.stationName}</span>
                  {s.nameEn && (
                    <span className="ml-1 text-xs font-normal opacity-70" lang="en">
                      {s.nameEn}
                    </span>
                  )}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {s.lines.length > 0 && (
                      <span lang="ko">{s.lines.join(", ")} · </span>
                    )}
                    {t("stationDistance", {
                      distance: formatDistance(s.distanceMeters),
                    })}
                  </span>
                </p>
                {s.arrivalStatus === "unavailable" ? (
                  <p className="mt-1 text-sm opacity-70">{t("arrivalUnavailable")}</p>
                ) : (
                  <SubwayArrivalList arrivals={s.arrivals} />
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
