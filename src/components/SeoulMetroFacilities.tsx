"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SeoulMetroFacilities as Facilities } from "@/lib/types";
import { hasHangul } from "@/lib/format";
import { metroFacilityGroups, metroHeadingLine } from "@/lib/place-lines/station-metro";
import { useAxisSource } from "@/hooks/useAxisBridge";
import type { AxisSnapshot } from "@/lib/webmcp/tools/context";

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
  const locale = useLocale();
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

  /** 조회 — StationFacilities와 같은 계약(`force` 재조회·직전 데이터 유지, `source:"tool"`은 헤딩 착지 생략). */
  const load = useCallback(
    async (force: boolean, source: "user" | "tool") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const gen = ++genRef.current;
      setStatus((prev) => ({
        kind: "loading",
        gen,
        previous: force && prev.kind === "done" ? prev.facilities : undefined,
      }));
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
        setStatus((prev) =>
          prev.kind === "loading" && prev.gen === gen && prev.previous
            ? { kind: "done", gen, facilities: prev.previous, refreshError: true }
            : { kind: "error", gen },
        );
      } finally {
        inFlightRef.current = false;
      }
    },
    [stationName],
  );
  const toSnapshot = useCallback(
    (s: Status): AxisSnapshot => {
      const facilities = s.kind === "done" ? s.facilities : s.kind === "loading" ? s.previous : undefined;
      return {
        status: s.kind,
        gen: s.gen,
        data: facilities
          ? {
              groups: metroFacilityGroups(facilities, t, locale),
              supplementFailed: facilities.supplementFailed || undefined,
            }
          : undefined,
        refreshError: s.kind === "done" && s.refreshError ? true : undefined,
      };
    },
    [t, locale],
  );
  const loadForTool = useCallback((force: boolean, source: "user" | "tool") => void load(force, source), [load]);
  useAxisSource("facilitiesMetro", status, toSnapshot, loadForTool);

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
  const headingLine =
    status.kind === "done" ? metroHeadingLine(status.facilities, stationName, t, locale) : "";

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
          {/* 헤딩도 시설 줄과 같은 규칙 — 값(역명·노선명)이 한국어로 남으면 줄 통째로 ko
              (줄 중간 분절 없이 태그하는 유일한 방법, A26 선례). */}
          <h3
            ref={headingRef}
            tabIndex={-1}
            lang={hasHangul(headingLine) ? "ko" : undefined}
            className="text-base font-semibold"
          >
            {headingLine}
          </h3>

          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          {/* 보강 실패는 어느 종류를 펼칠지 고르기 전에 알아야 한다 — 종류 묶음 앞(E44 §4). */}
          {status.facilities.supplementFailed && (
            <p className="mt-2 text-sm">{t("supplementFailed")}</p>
          )}
          {/* 종류마다 접는다(E44 판정 ②, 기본 접힘) — 천호역 72행이 접힘 행 7개가 된다. 네이티브 details라
              펼침 상태를 브라우저가 낭독하고, 포커스는 펼친 뒤에도 요약 행에 남는다(다음 탐색이 첫 시설).
              문장 정본은 place-lines(도구층과 공용) — 묶음 이름·시설 줄 모두. */}
          <div className="mt-2 space-y-1">
            {metroFacilityGroups(status.facilities, t, locale).map((g, gi) =>
              // 줄이 하나도 없는 묶음(교통약자 도우미 — upstream이 수만 준다)은 펼쳐도 빈 컨트롤이라 평문 한 줄이다.
              g.lines.length === 0 && status.facilities.groups[gi].kind !== "voiceGuide" ? (
                <p key={status.facilities.groups[gi].kind} className="py-3 text-sm font-semibold">
                  {g.name}
                </p>
              ) : (
              <details key={status.facilities.groups[gi].kind}>
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
                  {g.name}
                </summary>
                <ul className="mt-1 mb-2 space-y-1 text-sm leading-relaxed">
                  {/* 시설 줄은 서버 한국어 원문이 대부분이지만 `parts`로 조립한 줄(엘리베이터 위치 등)은
                      비-ko 로케일에서 온전히 번역문일 수 있다 — 한글이 있을 때만 ko(a11y 감사 2026-08-31). */}
                  {g.lines.map((line, i) => (
                    <li
                      key={`${status.facilities.groups[gi].kind}-${i}`}
                      lang={hasHangul(line) ? "ko" : undefined}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
                {/* 음성유도기 기준일은 그 묶음의 마지막 자식 — 다른 종류와 무관한 설명이다(E44 §4). */}
                {status.facilities.groups[gi].kind === "voiceGuide" && (
                  <p className="mb-2 text-xs opacity-70">{t("voiceGuideSource")}</p>
                )}
              </details>
              ),
            )}
          </div>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
