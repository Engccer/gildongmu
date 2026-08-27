"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BarrierFreeDetail } from "@/lib/types";
import { barrierFreeLines } from "@/lib/place-lines/barrier-free";
import { useAxisBridge } from "@/hooks/useAxisBridge";
import type { AxisSnapshot, AxisSource } from "@/lib/webmcp/tools/context";

/**
 * 화면은 `done`만 그리지만 도구층엔 3-state를 구조로 준다(매칭 실패·0건은 `empty`, 조회 실패는
 * `error`). `gen`은 요청 세대(WebMCP 축 결박, spec §5.4).
 */
type Status =
  | { kind: "loading"; gen: number; previous?: BarrierFreeDetail }
  | { kind: "empty"; gen: number }
  | { kind: "error"; gen: number }
  | { kind: "done"; gen: number; detail: BarrierFreeDetail; refreshError?: true };

/**
 * 장소 상세 무장애 편의시설(자동 등장 region) — StationMeta 동형.
 * 좌표+이름 교차검증(서버 match)이 성공할 때만 표시. 매칭 실패·에러·시설 0건은
 * 조용히 숨김(null) — 틀린 무장애 정보가 정보 없음보다 위험(false positive 차단).
 * 버튼 없이 조용히 나타나므로 region 랜드마크가 유일한 발견 경로.
 */
export function BarrierFreeInfo({
  lat,
  lng,
  name,
}: {
  lat: number;
  lng: number;
  name: string;
}) {
  const t = useTranslations("barrierFreeInfo");
  const [status, setStatus] = useState<Status>({ kind: "loading", gen: 0 });
  const headingId = useId();
  const genRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // 장소(props) 변경 시 렌더 단계에서 이전 데이터 즉시 폐기 — A(시설 표시 중)→B
  // 전환 때 B의 fetch 완료 전까지 A의 무장애 정보가 화면에 남아 낭독되는 false
  // positive를 차단한다(active 가드는 늦은 응답만 막지 이미 렌더된 stale은 못 지움).
  // React 공식 "prop 변경 시 상태 리셋" 패턴 — effect 내 동기 setState(cascading
  // 렌더 경고)·post-paint 깜빡임을 모두 피한다.
  const placeKey = `${lat},${lng},${name}`;
  const [prevKey, setPrevKey] = useState(placeKey);
  if (placeKey !== prevKey) {
    setPrevKey(placeKey);
    // 세대는 렌더에서 올리지 않는다(ref 접근 금지) — 뒤따르는 load effect가 새 세대를 낸다.
    setStatus({ kind: "loading", gen: status.gen });
  }

  /** 조회. `force`는 캐시 무시 재조회(직전 데이터 유지, 실패 시 refreshError). 마운트 축이라 착지 없음. */
  const load = useCallback(
    async (force: boolean, _source: "user" | "tool") => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const gen = ++genRef.current;
      const previous = force && statusRef.current.kind === "done" ? statusRef.current.detail : undefined;
      setStatus({ kind: "loading", gen, previous });
      try {
        const res = await fetch(
          `/api/places/barrier-free/match?lat=${lat}&lng=${lng}&name=${encodeURIComponent(name)}`,
          { signal: controller.signal, ...(force ? { cache: "no-store" as const } : {}) },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (controller.signal.aborted) return;
        // 시설 0건도 숨김 — 무장애 관광지로 매칭됐어도 표시할 항목이 없으면 노이즈.
        const d = body.detail as BarrierFreeDetail | null;
        setStatus(d && d.facilities.length > 0 ? { kind: "done", gen, detail: d } : { kind: "empty", gen });
      } catch {
        if (controller.signal.aborted) return;
        setStatus(previous ? { kind: "done", gen, detail: previous, refreshError: true } : { kind: "error", gen });
      }
    },
    [lat, lng, name],
  );
  useEffect(() => {
    void load(false, "user");
    return () => controllerRef.current?.abort();
  }, [load]);
  const axisSource = useMemo<AxisSource>(
    () => ({
      read: (): AxisSnapshot => {
        const s = statusRef.current;
        const detail = s.kind === "done" ? s.detail : s.kind === "loading" ? s.previous : undefined;
        return {
          status: s.kind,
          gen: s.gen,
          data:
            s.kind === "empty"
              ? { match: { kind: "unmatched" }, facilities: [], source: t("source") }
              : detail
                ? {
                    match: { kind: "matched", facilityCount: detail.facilities.length },
                    facilities: barrierFreeLines(detail).map(({ label, value }) => ({ label, value })),
                    source: t("source"),
                  }
                : undefined,
          refreshError: s.kind === "done" && s.refreshError ? true : undefined,
        };
      },
      load: (force, source) => void load(force, source),
    }),
    [load, t],
  );
  useAxisBridge("barrierFree", axisSource, status);

  if (status.kind !== "done") return null;
  const detail = status.detail;

  return (
    // 자동 등장 보조 섹션은 region 랜드마크 유지 — 버튼 없이 조용히 나타나
    // 회전자 탐색이 유일한 발견 경로다(미니멀 ARIA의 예외, CLAUDE.md 참조).
    <section aria-labelledby={headingId} className="mt-3 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      <div className="mt-1 space-y-1 text-sm leading-relaxed">
        {/* 라벨+값 단일 텍스트(span 분절 제거) — 문장 정본은 place-lines(도구층과 공용) */}
        {barrierFreeLines(detail).map((line, i) => (
          <p key={detail.facilities[i].key} lang="ko">{line.text}</p>
        ))}
      </div>
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}
