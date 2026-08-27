"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SubwayStationArrivals } from "@/lib/types";
import { arrivalItems } from "@/lib/place-lines/station-arrivals";
import { useAxisSource } from "@/hooks/useAxisBridge";
import type { AxisSnapshot } from "@/lib/webmcp/tools/context";
import { SubwayArrivalList } from "./SubwayArrivalList";

/** `gen`은 요청 세대(WebMCP 축 결박, spec §5.4). `previous`는 refresh 중 유지하는 직전 데이터. */
type Done = { data: SubwayStationArrivals; at: string };
type Status =
  | { kind: "idle"; gen: number }
  | { kind: "loading"; gen: number; previous?: Done }
  | { kind: "empty"; gen: number }
  | { kind: "error"; gen: number }
  | ({ kind: "done"; gen: number; refreshError?: true } & Done);

/**
 * 서울 지하철 실시간 도착 — 다음 열차 메시지를 텍스트로 낭독.
 *
 * BusArrivals와 동일하게 실시간이라 자동 폴링하지 않고 수동 "새로고침" +
 * 조회시각(asOf)으로 신선도를 보장한다(스크린리더에 반복 통지가 끼어들지
 * 않도록 — 접근성 결정). 미커버 역(서울 도시철도 외)·키 없음은 라우트가
 * null → empty(graceful). arvlMsg2(message)가 완성 한국어 문장이라 낭독 정본.
 */
export function SeoulSubwayArrival({ stationName }: { stationName: string }) {
  const t = useTranslations("subwayArrival");
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

  /** 조회(실시간이라 항상 no-store). `source:"tool"`은 헤딩 착지 생략, `force` 실패는 직전 데이터 + refreshError. */
  const load = useCallback(
    async (force: boolean, source: "user" | "tool") => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const gen = ++genRef.current;
      setStatus((prev) => ({
        kind: "loading",
        gen,
        previous: force && prev.kind === "done" ? { data: prev.data, at: prev.at } : undefined,
      }));
      try {
        const res = await fetch(
          `/api/station/subway-arrival?station=${encodeURIComponent(stationName)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = body.arrivals as SubwayStationArrivals | null;
        if (!data) {
          setStatus({ kind: "empty", gen });
          return;
        }
        const at = new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
        setStatus({ kind: "done", gen, data, at });
        if (source === "user") requestAnimationFrame(() => headingRef.current?.focus());
      } catch {
        setStatus((prev) =>
          prev.kind === "loading" && prev.gen === gen && prev.previous
            ? { kind: "done", gen, ...prev.previous, refreshError: true }
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
      const done = s.kind === "done" ? s : s.kind === "loading" ? s.previous : undefined;
      return {
        status: s.kind,
        gen: s.gen,
        data: done ? { items: arrivalItems(done.data.arrivals, t) } : undefined,
        refreshError: s.kind === "done" && s.refreshError ? true : undefined,
      };
    },
    [t],
  );
  const loadForTool = useCallback((force: boolean, source: "user" | "tool") => void load(force, source), [load]);
  useAxisSource("arrivals", status, toSnapshot, loadForTool);

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
        {status.kind === "done" ? t("refresh") : t("button")}
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
            {`${t("heading", { name: status.data.stationName || stationName })} ${t("asOf", { time: status.at })}`}
          </h3>

          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <SubwayArrivalList arrivals={status.data.arrivals} />
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
