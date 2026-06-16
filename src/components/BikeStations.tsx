"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BikeStation } from "@/lib/types";
import { formatDistance } from "@/lib/format";

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
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

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
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus({ kind: "geoerror", reason: "unsupported" });
      done();
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void fetchAt(pos.coords.latitude, pos.coords.longitude).finally(done);
      },
      () => {
        setStatus({ kind: "geoerror", reason: "denied" });
        done();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
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
