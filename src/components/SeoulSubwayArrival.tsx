"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SubwayStationArrivals } from "@/lib/types";
import { SubwayArrivalList } from "./SubwayArrivalList";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; data: SubwayStationArrivals; at: string };

/**
 * 서울 지하철 실시간 도착 — 다음 열차 메시지를 텍스트로 낭독.
 *
 * BusArrivals와 동일하게 실시간이라 자동 폴링하지 않고 수동 "새로고침" +
 * 조회시각(asOf)으로 신선도를 보장한다(스크린리더에 반복 통지가 끼어들지
 * 않도록 — 접근성 결정). 미커버 역(서울 도시철도 외)·키 없음은 라우트가
 * null → empty(graceful). arvlMsg2(message)가 완성 한국어 문장이라 낭독 정본.
 */
export function SeoulSubwayArrival({ stationName }: { stationName: string }) {
  const t = useTranslations("subwayArrival");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/station/subway-arrival?station=${encodeURIComponent(stationName)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const data = body.arrivals as SubwayStationArrivals | null;
      if (!data) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", data, at });
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
      ? t("loading")
      : status.kind === "empty"
        ? t("empty")
        : status.kind === "error"
          ? t("error")
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
        {status.kind === "done" ? t("refresh") : t("button")}
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
            {`${t("heading", { name: status.data.stationName || stationName })} ${t("asOf", { time: status.at })}`}
          </h3>

          <SubwayArrivalList arrivals={status.data.arrivals} />
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
