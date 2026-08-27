"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationTimetable as Timetable } from "@/lib/types";
import { prefersEnglish } from "@/lib/data-locale";
import { timetableHeaderLine, timetableLineItems } from "@/lib/place-lines/station-timetable";

type Status =
  | { kind: "hidden" } // 미커버(null)·로딩 전 — 섹션 미노출
  | { kind: "error" } // 조회 실패 — 숨기지 않고 문장 노출(3-state)
  | { kind: "done"; timetable: Timetable };

/**
 * 역 첫차·막차 자동 섹션 — StationMeta 동형(진입 시 fetch, region 랜드마크).
 * 차이: 시간표는 의사결정 정보라 실패를 조용히 숨기지 않는다(스펙 §2-D) —
 * 미커버(null)만 미노출, 실패·빈 결과는 문장으로 구분해 낭독한다.
 */
export function StationTimetable({ stationName }: { stationName: string }) {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "hidden" });
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/station/timetable?station=${encodeURIComponent(stationName)}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) {
          setStatus({ kind: "error" });
          return;
        }
        const body = await res.json();
        const timetable = (body.timetable as Timetable) ?? null;
        setStatus(timetable ? { kind: "done", timetable } : { kind: "hidden" });
      } catch {
        // cleanup의 abort는 active=false라 여기서 걸러진다. active=true로 도달하면
        // 진짜 네트워크·파싱 실패이므로 실패 문장을 노출한다(미커버 위장 금지, 3-state).
        if (active) setStatus({ kind: "error" });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [stationName]);

  if (status.kind === "hidden") return null;

  const isEn = prefersEnglish(locale);

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
