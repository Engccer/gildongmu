"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BikeStation } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; stations: BikeStation[]; at: string };

/**
 * 근처 따릉이 대여소 + 대여 가능 수 — 지도 없이 완결되는 공공자전거 정보.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회.
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침"으로 신선도를 보장한다
 * (스크린 리더 반복 통지 방지 — 접근성 결정). BusArrivals와 동형.
 */
export function BikeStations(
  props: { mode: "current" } | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bike");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/bike/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stations = (body.stations ?? []) as BikeStation[];
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

  // 펼친 결과를 다시 감춘다(idle 복귀). 포커스를 트리거 버튼으로 되돌린다.
  function close() {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

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
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            id={headingId}
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
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-3">
            {status.stations.map((s) => (
              <li key={s.stationId}>
                <p className="font-medium" lang="ko">
                  {s.name}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("stationDistance", {
                      distance: formatDistance(s.distanceMeters),
                    })}
                  </span>
                </p>
                <p className="text-sm">
                  {t("availability", {
                    bikes: s.bikesAvailable,
                    racks: s.racksTotal,
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </section>
      )}
    </div>
  );
}
