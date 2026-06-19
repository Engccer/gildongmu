"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationMeta as Meta } from "@/lib/types";
import { prefersEnglish } from "@/lib/data-locale";

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
    <div
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>

      {/* en: 영문역명을 메인(외국인 정합), 한글명 보조. ko: 영문역명 한 줄 보강. */}
      {isEn ? (
        <p className="mt-1">
          <span className="text-lg font-semibold">{meta.nameEn}</span>
          <span className="ml-2 text-sm opacity-70" lang="ko">
            {meta.name}
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm opacity-80" lang="en">
          {meta.nameEn}
        </p>
      )}

      {/* 정의 리스트 대신 평문 — "용어/정의" 역할·콜론 낭독 노이즈 제거. */}
      <div className="mt-1 text-sm leading-relaxed">
        <p>
          <span className="font-medium">{t("lines")}</span>{" "}
          <span lang="ko">{meta.lines.join(", ")}</span>
          {meta.isTransfer && (
            <span className="ml-2 rounded bg-accent/10 px-1 text-xs text-accent">
              {t("transfer")}
            </span>
          )}
        </p>
        <p>
          <span className="font-medium">{t("operator")}</span>{" "}
          <span lang="ko">{meta.operator}</span>
        </p>
      </div>

      {/* source는 로케일 메시지(en/ko) — 페이지 기본 lang을 따르므로 lang 미지정. */}
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </div>
  );
}
