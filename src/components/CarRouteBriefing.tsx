"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CarRouteBriefing as Briefing } from "@/lib/types";
import { durationToMinutes, formatDistance } from "@/lib/format";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; briefing: Briefing };

/**
 * 자동차 경로 텍스트 브리핑 — "지도 없이 완결되는 경로 정보" 실험.
 *
 * 현재 위치(Geolocation) → /api/route/car → 턴바이턴 안내문을
 * 순서 있는 리스트로 표시한다. 스크린 리더 사용자가 출발 전에
 * 경로 전체를 미리 들을 수 있게 하는 것이 목적 — 실주행 내비는
 * 딥링크로 네이티브 앱에 위임한다 (SPEC §3).
 */
export function CarRouteBriefing({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("route.briefing");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  function requestBriefing() {
    if (
      status.kind === "locating" ||
      status.kind === "loading"
    ) {
      return;
    }
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "error", message: t("geoError") });
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setStatus({ kind: "loading" });
        try {
          const origin = `${position.coords.latitude},${position.coords.longitude}`;
          const res = await fetch(
            `/api/route/car?origin=${origin}&dest=${dest.lat},${dest.lng}`,
          );
          const body = await res.json();
          if (!res.ok) {
            setStatus({
              kind: "error",
              message: typeof body.error === "string" ? body.error : t("error"),
            });
            return;
          }
          setStatus({ kind: "done", briefing: body as Briefing });
          requestAnimationFrame(() => headingRef.current?.focus());
        } catch {
          setStatus({ kind: "error", message: t("error") });
        }
      },
      () => setStatus({ kind: "error", message: t("geoError") }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const liveMessage =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "error"
          ? status.message
          : status.kind === "done"
            ? t("ready")
            : "";

  return (
    <div className="mt-3">
      {/* disabled 대신 aria-disabled — 진행 중에도 포커스를 잃지 않게 한다 */}
      <button
        type="button"
        onClick={requestBriefing}
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
        // 헤딩 텍스트를 aria-labelledby로 참조 — aria-label 중복 발표 방지
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-gray-300 p-3"
        >
          <h4
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", { name: dest.name })}
          </h4>
          <p className="mt-1 text-sm">
            {t("summary", {
              distance: formatDistance(status.briefing.distanceMeters),
              minutes: durationToMinutes(status.briefing.durationSeconds),
              taxi: status.briefing.taxiFare.toLocaleString(locale),
            })}
            {status.briefing.tollFare > 0 && (
              <>
                {" "}
                {t("toll", {
                  toll: status.briefing.tollFare.toLocaleString(locale),
                })}
              </>
            )}
          </p>
          <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
            {status.briefing.guides.map((guide, i) => (
              <li key={`${i}-${guide.guidance}`}>
                {guide.name ? `${guide.name} — ` : ""}
                {guide.guidance}
                {guide.distanceMeters > 0 &&
                  ` (${formatDistance(guide.distanceMeters)})`}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs opacity-70">{t("disclaimer")}</p>
        </section>
      )}
    </div>
  );
}
