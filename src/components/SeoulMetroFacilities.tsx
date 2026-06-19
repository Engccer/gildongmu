"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoulMetroFacilities as Facilities } from "@/lib/types";

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
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", {
              name: status.facilities.stationName || stationName,
            })}
            {status.facilities.line && (
              <span className="ml-2 text-xs font-normal opacity-70" lang="ko">
                {status.facilities.line}
              </span>
            )}
          </h3>

          <div className="mt-2 space-y-3">
            {status.facilities.groups.map((g) => (
              <div key={g.kind}>
                <h4 className="text-sm font-semibold" lang="ko">
                  {t(`kind.${g.kind}`)}{" "}
                  <span className="font-normal opacity-70">
                    {t("count", { count: g.facilities.length })}
                  </span>
                </h4>
                <ul className="mt-1 space-y-1 text-sm leading-relaxed">
                  {g.facilities.map((f, i) => (
                    <li key={`${g.kind}-${i}`} lang="ko">
                      {f.name}
                      {f.location && ` — ${f.location}`}
                      {f.floors && ` (${f.floors})`}
                      {f.detail && ` · ${f.detail}`}
                      {f.operatingStatus && (
                        <span
                          className={
                            f.operatingStatus === "stopped"
                              ? "ml-1 rounded bg-red-500/10 px-1 text-xs text-red-600"
                              : "ml-1 text-xs opacity-70"
                          }
                        >
                          {f.operatingStatus === "normal"
                            ? t("operatingNormal")
                            : t("operatingStopped")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
