"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { StationFacilities as Facilities } from "@/lib/types";
import { korailFacilityLines } from "@/lib/place-lines/station-facilities";
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
 * 역 교통약자 편의시설 — "지도 없이 완결되는 접근성 정보" 실험.
 *
 * CarRouteBriefing과 동일한 온디맨드 패턴: 버튼 → fetch → aria-live 통지 →
 * 텍스트 정본. 역일 때만 PlaceDetail이 이 컴포넌트를 렌더한다.
 * 데이터 미커버 역(도시철도 등)은 "정보 없음"으로 안내한다.
 */
export function StationFacilities({ stationName }: { stationName: string }) {
  const t = useTranslations("station");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle", gen: 0 });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const genRef = useRef(0);

  // 펼친 결과를 다시 감춘다(idle 복귀). 닫은 뒤 포커스를 트리거 버튼으로 복원.
  // 세대를 올려 도구 대기자를 `superseded`로 끝낸다(사용자 조작 우선).
  const close = useCallback(() => {
    setStatus({ kind: "idle", gen: ++genRef.current });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  // in-flight 가드 — 클로저의 status.kind만으로는 같은 렌더에서 빠른
  // 더블클릭/Enter 반복 시 중복 fetch를 막지 못한다(setState 비동기). ref로
  // 동기 가드한다.
  const inFlightRef = useRef(false);

  /**
   * 조회. `force`는 done이어도 재조회(직전 데이터 유지, 실패 시 refreshError). `source:"tool"`은
   * 헤딩 착지만 건너뛴다 — 도구 호출의 착지는 최종 화면 하나뿐이다(spec §6).
   */
  const load = useCallback(
    async (force: boolean, source: "user" | "tool") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const gen = ++genRef.current;
      // 직전 데이터는 상태 안에 든다(refresh 실패 시 되돌릴 근거) — 최신 상태는 함수형 갱신으로 읽는다.
      setStatus((prev) => ({
        kind: "loading",
        gen,
        previous: force && prev.kind === "done" ? prev.facilities : undefined,
      }));
      try {
        const res = await fetch(
          `/api/station/facilities?station=${encodeURIComponent(stationName)}`,
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
  // 도구층 소스: 상태는 ref로 읽고(커밋 뒤 값), 줄은 화면과 같은 함수로 조립한다.
  const toSnapshot = useCallback(
    (s: Status): AxisSnapshot => {
      const facilities = s.kind === "done" ? s.facilities : s.kind === "loading" ? s.previous : undefined;
      return {
        status: s.kind,
        gen: s.gen,
        data: facilities ? { lines: korailFacilityLines(facilities, t) } : undefined,
        refreshError: s.kind === "done" && s.refreshError ? true : undefined,
      };
    },
    [t],
  );
  const loadForTool = useCallback((force: boolean, source: "user" | "tool") => void load(force, source), [load]);
  useAxisSource("facilities", status, toSnapshot, loadForTool);

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
            {t("heading", {
              name: status.facilities.stationName || stationName,
            })}
          </h3>
          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>
          {/* 문장 정본은 place-lines(도구층과 공용) */}
          <ul className="mt-1 text-sm leading-relaxed">
            {korailFacilityLines(status.facilities, t).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
