"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationMeta as Meta } from "@/lib/types";
import { prefersEnglish } from "@/lib/data-locale";
import { joinText } from "@/lib/format";

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
  const [meta, setMeta] = useState<Meta | null>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // 결과를 항상 setMeta로 갱신(미커버는 null) — PlaceDetail은 역 전환 시
    // 리마운트되지 않으므로 이전 역 메타 잔상을 새 응답으로 덮는다.
    (async () => {
      try {
        const res = await fetch(
          `/api/station/meta?station=${encodeURIComponent(stationName)}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) {
          setMeta(null);
          return;
        }
        const body = await res.json();
        if (active) setMeta((body.meta as Meta) ?? null);
      } catch {
        // 보조 정보 — 실패/취소는 조용히 숨김(활성 시에만 비움).
        if (active) setMeta(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [stationName]);

  if (!meta) return null;

  const isEn = prefersEnglish(locale);

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
        <p className="mt-1 text-lg font-semibold">{meta.nameEn}</p>
      ) : (
        <p className="mt-1 text-sm opacity-80" lang="en">
          {meta.nameEn}
        </p>
      )}

      {/* 정의 리스트 대신 평문 한 줄 = 한 객체 — 라벨+값+환승 배지를 단일
          텍스트로 합친다(볼드 라벨·배지 분절 제거, 환승은 의미 정보라 텍스트 흡수). */}
      <div className="mt-1 text-sm leading-relaxed">
        <p>
          {joinText(
            `${t("lines")} ${meta.lines.join(", ")}`,
            meta.isTransfer && t("transfer"),
          )}
        </p>
        <p>{`${t("operator")} ${meta.operator}`}</p>
      </div>

      {/* source는 로케일 메시지(en/ko) — 페이지 기본 lang을 따르므로 lang 미지정. */}
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}
