"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusRouteStop } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; stops: BusRouteStop[] };

/**
 * 노선 경유정류소 펼치기 — 도착 버스 항목에서 lazy fetch.
 * 거의 불변 데이터라 서버 라우트가 하루 캐시한다.
 */
export function BusRouteStops({
  cityCode,
  routeId,
  routeNo,
}: {
  cityCode: string;
  routeId: string;
  routeNo: string;
}) {
  const t = useTranslations("bus");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/bus/route?cityCode=${encodeURIComponent(cityCode)}&routeId=${encodeURIComponent(routeId)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stops = (body.stops ?? []) as BusRouteStop[];
      if (stops.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      setStatus({ kind: "done", stops });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    } finally {
      inFlightRef.current = false;
    }
  }

  const busy = status.kind === "loading";
  const live =
    status.kind === "loading"
      ? t("routeStopsLoading")
      : status.kind === "empty"
        ? t("routeStopsEmpty")
        : status.kind === "error"
          ? t("routeStopsError")
          : "";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 text-xs font-medium text-accent underline aria-disabled:opacity-50"
      >
        {t("routeStopsButton", { route: routeNo })}
      </button>

      <p aria-live="polite" role="status" className="min-h-4 text-xs">
        {live}
      </p>

      {status.kind === "done" && (
        <div className="mt-1">
          <h4
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xs font-semibold"
          >
            {t("routeStopsHeading", { route: routeNo })}
          </h4>
          <ol className="mt-1 list-decimal pl-5 text-xs" lang="ko">
            {status.stops.map((s) => (
              <li key={s.nodeId}>{s.name}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
