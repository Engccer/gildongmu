"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusRouteStop, BusSource } from "@/lib/types";

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
  source,
  cityCode,
  routeId,
  routeNo,
  onNotice,
}: {
  source: BusSource;
  /** tago만 사용(서울은 빈 문자열일 수 있음). */
  cityCode: string;
  routeId: string;
  routeNo: string;
  /** 상태 통지 — BusArrivals의 단일 live region으로 전달(도착 항목마다 별도
   * live region이 생기는 걸 막는다, 유일 호출부가 항상 전달하므로 필수). */
  onNotice: (message: string) => void;
}) {
  const t = useTranslations("bus");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);

  // 펼친 경유정류소 목록을 다시 감춘다(idle 복귀). 닫은 뒤 포커스를 트리거로 복원.
  const close = useCallback(() => {
    setStatus({ kind: "idle" });
    onNotice("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onNotice]);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    onNotice(t("routeStopsLoading", { route: routeNo }));
    try {
      const qs = new URLSearchParams({ source, routeId });
      if (source === "tago") qs.set("cityCode", cityCode);
      const res = await fetch(`/api/bus/route?${qs.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        onNotice(t("routeStopsError", { route: routeNo }));
        return;
      }
      const stops = (body.stops ?? []) as BusRouteStop[];
      if (stops.length === 0) {
        setStatus({ kind: "empty" });
        onNotice(t("routeStopsEmpty", { route: routeNo }));
        return;
      }
      setStatus({ kind: "done", stops });
      onNotice("");
    } catch {
      setStatus({ kind: "error" });
      onNotice(t("routeStopsError", { route: routeNo }));
    } finally {
      inFlightRef.current = false;
    }
  }

  // done 진입 시 헤딩으로 포커스 이동(접근성 1급). fetch 콜백 안 rAF는 React
  // 커밋과 인과관계가 없어 레이스가 생긴다(헤딩이 아직 DOM에 없을 수 있음) —
  // useEffect는 커밋 이후 실행이 보장되므로 안전하다(BusArrivals 동형).
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

  const busy = status.kind === "loading";

  return (
    <div className="mt-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 text-xs font-medium text-accent underline aria-disabled:opacity-50"
      >
        {t("routeStopsButton", { route: routeNo })}
      </button>

      {status.kind === "done" && (
        <div className="mt-1">
          <h5
            ref={headingRef}
            tabIndex={-1}
            className="text-xs font-semibold"
          >
            {t("routeStopsHeading", { route: routeNo })}
          </h5>
          <button
            type="button"
            onClick={close}
            className="min-h-11 text-xs text-accent underline"
          >
            {tActions("close")}
          </button>
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
