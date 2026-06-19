"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { StationFacilities as Facilities } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; facilities: Facilities };

/**
 * 역 교통약자 편의시설 — "지도 없이 완결되는 접근성 정보" 실험.
 *
 * CarRouteBriefing과 동일한 온디맨드 패턴: 버튼 → fetch → aria-live 통지 →
 * 텍스트 정본. 역일 때만 PlaceDetail이 이 컴포넌트를 렌더한다.
 * 데이터 미커버 역(도시철도 등)은 "정보 없음"으로 안내한다.
 */
export function StationFacilities({ stationName }: { stationName: string }) {
  const t = useTranslations("station");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // in-flight 가드 — 클로저의 status.kind만으로는 같은 렌더에서 빠른
  // 더블클릭/Enter 반복 시 중복 fetch를 막지 못한다(setState 비동기). ref로
  // 동기 가드한다.
  const inFlightRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/station/facilities?station=${encodeURIComponent(stationName)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      if (!body.facilities) {
        setStatus({ kind: "empty" });
        return;
      }
      setStatus({ kind: "done", facilities: body.facilities as Facilities });
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
      {/* disabled 대신 aria-disabled — 진행 중에도 포커스를 잃지 않게 한다 */}
      <button
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {t("button")}
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
            {t("heading", {
              name: status.facilities.stationName || stationName,
            })}
          </h3>
          <ul className="mt-1 text-sm leading-relaxed">
            <li>
              {t("accessibleToilet")}:{" "}
              {status.facilities.accessibleToilet ? t("yes") : t("no")}
            </li>
            <li>
              {t("accessibleSlope")}:{" "}
              {status.facilities.accessibleSlope ? t("yes") : t("no")}
            </li>
            <li>
              {t("wheelchairLifts")}:{" "}
              {status.facilities.wheelchairLifts ?? t("unknown")}
            </li>
            <li>
              {t("elevators")}: {status.facilities.elevators ?? t("unknown")}
            </li>
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
