"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationTimetable as Timetable } from "@/lib/types";
import { prefersEnglish } from "@/lib/data-locale";
import { timetableHeaderLine, timetableLineItems } from "@/lib/place-lines/station-timetable";
import { useAxisBridge } from "@/hooks/useAxisBridge";
import type { AxisSnapshot, AxisSource } from "@/lib/webmcp/tools/context";

/** `gen`은 요청 세대(WebMCP 축 결박, spec §5.4). 화면은 loading·empty를 숨기고 error는 문장으로 낸다. */
type Status =
  | { kind: "loading"; gen: number; previous?: Timetable }
  | { kind: "empty"; gen: number } // 미커버(null) — 섹션 미노출
  | { kind: "error"; gen: number } // 조회 실패 — 숨기지 않고 문장 노출(3-state)
  | { kind: "done"; gen: number; timetable: Timetable; refreshError?: true };

/**
 * 역 첫차·막차 자동 섹션 — StationMeta 동형(진입 시 fetch, region 랜드마크).
 * 차이: 시간표는 의사결정 정보라 실패를 조용히 숨기지 않는다(스펙 §2-D) —
 * 미커버(null)만 미노출, 실패·빈 결과는 문장으로 구분해 낭독한다.
 */
export function StationTimetable({ stationName }: { stationName: string }) {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "loading", gen: 0 });
  const headingId = useId();
  const genRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const isEn = prefersEnglish(locale);

  /** 조회. `force`는 캐시 무시 재조회(직전 데이터 유지, 실패 시 refreshError). 마운트 축이라 착지 없음. */
  const load = useCallback(
    async (force: boolean, _source: "user" | "tool") => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const gen = ++genRef.current;
      const previous = force && statusRef.current.kind === "done" ? statusRef.current.timetable : undefined;
      setStatus({ kind: "loading", gen, previous });
      try {
        const res = await fetch(
          `/api/station/timetable?station=${encodeURIComponent(stationName)}`,
          { signal: controller.signal, ...(force ? { cache: "no-store" as const } : {}) },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (controller.signal.aborted) return;
        const timetable = (body.timetable as Timetable) ?? null;
        setStatus(timetable ? { kind: "done", gen, timetable } : { kind: "empty", gen });
      } catch {
        // 취소는 무시. 도달하면 진짜 네트워크·파싱 실패이므로 실패 문장을 노출한다(미커버 위장 금지, 3-state).
        if (controller.signal.aborted) return;
        setStatus(
          previous ? { kind: "done", gen, timetable: previous, refreshError: true } : { kind: "error", gen },
        );
      }
    },
    [stationName],
  );
  useEffect(() => {
    void load(false, "user");
    return () => controllerRef.current?.abort();
  }, [load]);
  const axisSource = useMemo<AxisSource>(
    () => ({
      read: (): AxisSnapshot => {
        const s = statusRef.current;
        const tt = s.kind === "done" ? s.timetable : s.kind === "loading" ? s.previous : undefined;
        return {
          status: s.kind,
          gen: s.gen,
          data: tt ? { basis: timetableHeaderLine(tt, t), lines: timetableLineItems(tt, t, isEn) } : undefined,
          refreshError: s.kind === "done" && s.refreshError ? true : undefined,
        };
      },
      load: (force, source) => void load(force, source),
    }),
    [load, t, isEn],
  );
  useAxisBridge("timetable", axisSource, status);

  if (status.kind === "loading" || status.kind === "empty") return null;

  return (
    // 자동 등장 보조 섹션 — region 랜드마크가 유일한 발견 경로(CLAUDE.md 규칙).
    <section aria-labelledby={headingId} className="mt-3 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      {status.kind === "error" ? (
        <p className="mt-1 text-sm">{t("error")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{timetableHeaderLine(status.timetable, t)}</p>
          <div className="mt-1 text-sm leading-relaxed">
            {/* 문장 정본은 place-lines(도구층과 공용). 매칭된 노선은 전부 온다(A19) —
                ok만 방향 행이고 나머지는 사유 문장 한 줄. */}
            {timetableLineItems(status.timetable, t, isEn).map((item) => (
              <p key={`${item.line}-${item.direction ?? item.coverage}`}>{item.text}</p>
            ))}
          </div>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </>
      )}
    </section>
  );
}
