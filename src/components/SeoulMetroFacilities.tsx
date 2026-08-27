"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoulMetroFacilities as Facilities } from "@/lib/types";
import { joinText } from "@/lib/format";
import { metroFacilityGroups } from "@/lib/place-lines/station-metro";
import { useAxisBridge } from "@/hooks/useAxisBridge";
import type { AxisSnapshot, AxisSource } from "@/lib/webmcp/tools/context";

/** `gen`은 요청 세대(WebMCP 축 결박, spec §5.4). `previous`는 refresh 중 유지하는 직전 데이터. */
type Status =
  | { kind: "idle"; gen: number }
  | { kind: "loading"; gen: number; previous?: Facilities }
  | { kind: "empty"; gen: number }
  | { kind: "error"; gen: number }
  | { kind: "done"; gen: number; facilities: Facilities; refreshError?: true };

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
  const [status, setStatus] = useState<Status>({ kind: "idle", gen: 0 });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const genRef = useRef(0);

  // 펼친 결과를 다시 감춘다(idle 복귀). 닫은 뒤 포커스를 트리거 버튼으로 복원.
  // 세대를 올려 도구 대기자를 `superseded`로 끝낸다(사용자 조작 우선).
  const close = useCallback(() => {
    setStatus({ kind: "idle", gen: ++genRef.current });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // 도구층 소스가 커밋 뒤 상태를 읽는 통로(렌더 중 ref 접근 금지 — effect에서 갱신).
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  /** 조회 — StationFacilities와 같은 계약(`force` 재조회·직전 데이터 유지, `source:"tool"`은 헤딩 착지 생략). */
  const load = useCallback(
    async (force: boolean, source: "user" | "tool") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const gen = ++genRef.current;
      const previous = force && statusRef.current.kind === "done" ? statusRef.current.facilities : undefined;
      setStatus({ kind: "loading", gen, previous });
      try {
        const res = await fetch(
          `/api/station/metro-facilities?station=${encodeURIComponent(stationName)}`,
          force ? { cache: "no-store" } : undefined,
        );
        const body = await res.json();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!body.facilities) {
          setStatus({ kind: "empty", gen });
          return;
        }
        setStatus({ kind: "done", gen, facilities: body.facilities as Facilities });
        if (source === "user") requestAnimationFrame(() => headingRef.current?.focus());
      } catch {
        setStatus(
          previous ? { kind: "done", gen, facilities: previous, refreshError: true } : { kind: "error", gen },
        );
      } finally {
        inFlightRef.current = false;
      }
    },
    [stationName],
  );
  const axisSource = useMemo<AxisSource>(
    () => ({
      read: (): AxisSnapshot => {
        const s = statusRef.current;
        const facilities = s.kind === "done" ? s.facilities : s.kind === "loading" ? s.previous : undefined;
        return {
          status: s.kind,
          gen: s.gen,
          data: facilities
            ? { groups: metroFacilityGroups(facilities, t), supplementFailed: facilities.supplementFailed || undefined }
            : undefined,
          refreshError: s.kind === "done" && s.refreshError ? true : undefined,
        };
      },
      load: (force, source) => void load(force, source),
    }),
    [load, t],
  );
  useAxisBridge("facilitiesMetro", axisSource);

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
        onClick={() => void load(false, "user")}
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
