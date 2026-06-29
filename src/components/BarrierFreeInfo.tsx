"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { BarrierFreeDetail } from "@/lib/types";

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
  canShow,
}: {
  lat: number;
  lng: number;
  name: string;
  canShow: boolean;
}) {
  const t = useTranslations("barrierFreeInfo");
  const [detail, setDetail] = useState<BarrierFreeDetail | null>(null);
  const headingId = useId();

  useEffect(() => {
    if (!canShow) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/places/barrier-free/match?lat=${lat}&lng=${lng}&name=${encodeURIComponent(name)}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) return setDetail(null);
        const body = await res.json();
        // 시설 0건도 숨김 — 무장애 관광지로 매칭됐어도 표시할 항목이 없으면 노이즈.
        const d = body.detail as BarrierFreeDetail | null;
        setDetail(d && d.facilities.length > 0 ? d : null);
      } catch {
        if (active) setDetail(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng, name, canShow]);

  if (!detail) return null;

  return (
    // 자동 등장 보조 섹션은 region 랜드마크 유지 — 버튼 없이 조용히 나타나
    // 회전자 탐색이 유일한 발견 경로다(미니멀 ARIA의 예외, CLAUDE.md 참조).
    <section aria-labelledby={headingId} className="mt-3 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      <div className="mt-1 space-y-1 text-sm leading-relaxed">
        {detail.facilities.map((f) => (
          <p key={f.key}>
            <span className="font-medium">{f.label}</span>{" "}
            <span lang="ko">{f.value}</span>
          </p>
        ))}
      </div>
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}
