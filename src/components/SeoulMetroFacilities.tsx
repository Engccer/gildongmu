"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoulMetroFacilities as Facilities } from "@/lib/types";
import { joinText } from "@/lib/format";
import { metroFacilityGroups } from "@/lib/place-lines/station-metro";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; facilities: Facilities };

/**
 * 서울 지하철역 교통약자 시설 — 위치·층·가동현황까지 텍스트로 낭독.
 *
 * 코레일 StationFacilities와 동일한 온디맨드 패턴(버튼→fetch→aria-live→텍스트).
 * 코레일은 전국 철도역(KTX/일반), 이 컴포넌트는 서울 1~8호선. PlaceDetail이
 * 역일 때 둘 다 렌더하고 각자 graceful(데이터 없으면 "정보 없음").
 */
export function SeoulMetroFacilities({ stationName }: { stationName: string }) {
  const t = useTranslations("subway");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);

  // 펼친 결과를 다시 감춘다(idle 복귀). 닫은 뒤 포커스를 트리거 버튼으로 복원.
  const close = useCallback(() => {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/station/metro-facilities?station=${encodeURIComponent(stationName)}`,
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
      <button
        ref={triggerRef}
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
            {joinText(
              t("heading", {
                name: status.facilities.stationName || stationName,
              }),
              status.facilities.line,
            )}
          </h3>

          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          {/* 문장 정본은 place-lines(도구층과 공용) — 그룹 헤딩·시설 줄 모두 */}
          <div className="mt-2 space-y-3">
            {metroFacilityGroups(status.facilities, t).map((g, gi) => (
              <div key={status.facilities.groups[gi].kind}>
                <h4 className="text-sm font-semibold">{g.name}</h4>
                <ul className="mt-1 space-y-1 text-sm leading-relaxed">
                  {g.lines.map((line, i) => (
                    <li key={`${status.facilities.groups[gi].kind}-${i}`} lang="ko">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {status.facilities.supplementFailed && (
            <p className="mt-2 text-sm">{t("supplementFailed")}</p>
          )}
          {status.facilities.groups.some((g) => g.kind === "voiceGuide") && (
            <p className="mt-2 text-xs opacity-70">{t("voiceGuideSource")}</p>
          )}
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
