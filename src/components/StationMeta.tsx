"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationMeta as Meta } from "@/lib/types";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { stationMetaLines, stationMetaLocalizedLines } from "@/lib/place-lines/station-meta";
import { TransitBilingualName } from "./TransitBilingualName";
import { useAxisSource } from "@/hooks/useAxisBridge";
import type { AxisSnapshot } from "@/lib/webmcp/tools/context";

/**
 * 화면은 `done`만 그리고 나머지는 조용히 숨기지만(보조 정보), 도구층엔 3-state를 구조로 준다.
 * `gen`은 요청 세대(WebMCP 축 결박, spec §5.4).
 */
type Status =
  | { kind: "loading"; gen: number; previous?: Meta }
  | { kind: "empty"; gen: number }
  | { kind: "error"; gen: number }
  | { kind: "done"; gen: number; meta: Meta; refreshError?: true };

/**
 * 도시철도역 메타(A3) — 영문역명·노선·환승을 장소 상세에 표시.
 *
 * 시설 컴포넌트(외부 API 온디맨드 버튼)와 달리 정적 seed라 빠르고, 영문역명은
 * 외국인에게 즉시 보여야 A3 성과(외국인 역명 정합)가 실현되므로 진입 시 자동 fetch.
 * 보조 정보라 매칭 실패/에러는 조용히 숨긴다(null 렌더). en 로케일은 영문역명을
 * 메인으로(한글명 보조 lang="ko"), ko 로케일은 영문역명을 보조로 한 줄 보강.
 * seed는 서버 전용이라 /api/station/meta 경유. 자동 등장 보조 정보라 live region 불필요.
 */
export function StationMeta({ stationName }: { stationName: string }) {
  const t = useTranslations("stationMeta");
  const locale = useLocale();
  // ⚠ 초기 loading의 세대는 마운트 로드의 세대(1)와 같아야 한다 — 도구가 게시 직후(첫 커밋 전)
  // 읽은 세대에 결박해 기다리므로, 다르면 마운트 로드가 곧 "사용자가 건드렸다"(superseded)로 오판된다.
  const [status, setStatus] = useState<Status>({ kind: "loading", gen: 1 });
  const headingId = useId();
  const genRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  /**
   * 조회. 결과를 항상 갱신(미커버는 empty). 앞선 요청은 abort한다(늦은 응답이 새 세대를 덮지 않게).
   * 역 전환은 `PlaceDetail`의 `key` 리마운트가 정본이라 같은 인스턴스의 `stationName` 변경은 사실상 없다.
   * `force`는 캐시 무시 재조회(직전 데이터 유지, 실패 시 refreshError). 마운트 축이라 착지가 없어
   * `source`는 계약 일치용이다.
   */
  const load = useCallback(
    async (force: boolean, _source: "user" | "tool") => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const gen = ++genRef.current;
      setStatus((prev) => ({
        kind: "loading",
        gen,
        previous: force && prev.kind === "done" ? prev.meta : undefined,
      }));
      try {
        const res = await fetch(
          // `lang=en`은 노선 영문(`linesEn`, E27)을 additive로 받는다. ko는 종전 URL과 같다.
          `/api/station/meta?station=${encodeURIComponent(stationName)}&lang=${dataLocale(locale)}`,
          { signal: controller.signal, ...(force ? { cache: "no-store" as const } : {}) },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (controller.signal.aborted) return;
        const meta = (body.meta as Meta) ?? null;
        setStatus(meta ? { kind: "done", gen, meta } : { kind: "empty", gen });
      } catch {
        // 보조 정보 — 실패는 조용히 숨긴다(취소는 무시).
        if (controller.signal.aborted) return;
        setStatus((prev) =>
          prev.kind === "loading" && prev.gen === gen && prev.previous
            ? { kind: "done", gen, meta: prev.previous, refreshError: true }
            : { kind: "error", gen },
        );
      }
    },
    [stationName, locale],
  );
  useEffect(() => {
    void load(false, "user");
    return () => controllerRef.current?.abort();
  }, [load]);
  const toSnapshot = useCallback(
    (s: Status): AxisSnapshot => {
      const meta = s.kind === "done" ? s.meta : s.kind === "loading" ? s.previous : undefined;
      return {
        status: s.kind,
        gen: s.gen,
        data: meta ? { lines: stationMetaLines(meta, t, locale) } : undefined,
        refreshError: s.kind === "done" && s.refreshError ? true : undefined,
      };
    },
    [t, locale],
  );
  const loadForTool = useCallback((force: boolean, source: "user" | "tool") => void load(force, source), [load]);
  useAxisSource("basic", status, toSnapshot, loadForTool);

  if (status.kind !== "done") return null;
  const meta = status.meta;

  const isEn = prefersEnglish(locale);
  // 문장 정본은 place-lines(도구층과 공용) — 여기서는 렌더만 한다.
  const [nameLine, linesLine, operatorLine] = stationMetaLocalizedLines(meta, t, locale);

  return (
    // 자동 등장 보조 섹션은 region 랜드마크 유지 — 버튼 없이 조용히 나타나
    // 회전자 탐색이 유일한 발견 경로다(미니멀 ARIA의 예외, CLAUDE.md 참조).
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>

      {/* 역명은 현재 언어 하나만 — en은 영문역명, ko는 영문역명 한 줄 보강.
          en에서 한글 보조명은 드롭(블라인드 영어 사용자에겐 한글 낭독이 노이즈,
          한 줄 한 객체 원칙). 단일 언어라 분절 없음. */}
      {isEn ? (
        // 한 줄 괄호 병기(E27 §3.6): 시각 `Gangnam (강남)`, 접근 가능한 이름은 영문뿐. 순수 데이터 영어 줄이라
        // 비-en 로케일(ja·fr…)에서는 `lang="en"`(일본어 음성이 영문을 읽지 않게).
        <p className="mt-1 text-lg font-semibold" lang={locale.startsWith("en") ? undefined : "en"}>
          <TransitBilingualName en={nameLine.text} ko={meta.name} />
        </p>
      ) : (
        <p className="mt-1 text-sm opacity-80" lang="en">
          {nameLine.text}
        </p>
      )}

      {/* 정의 리스트 대신 평문 한 줄 = 한 객체 — 라벨+값+환승 배지를 단일
          텍스트로 합친다(볼드 라벨·배지 분절 제거, 환승은 의미 정보라 텍스트 흡수). */}
      {/* 노선 줄은 en에서 `linesEn`이 있을 때만 영문이고 없으면 한국어 원문 + lang="ko"(줄 단위 원자성, E27). */}
      <div className="mt-1 text-sm leading-relaxed">
        <p lang={linesLine.lang}>{linesLine.text}</p>
        <p>{operatorLine.text}</p>
      </div>

      {/* source는 로케일 메시지(en/ko) — 페이지 기본 lang을 따르므로 lang 미지정. */}
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}
