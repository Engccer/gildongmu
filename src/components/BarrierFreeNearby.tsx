"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BarrierFreeDetail, BarrierFreePlace } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** done 데이터 — 목록 한 필드. */
interface BarrierFreeData {
  places: BarrierFreePlace[];
}

/** 캐시 값: 로딩 중 / 상세 객체 / 없음(에러 또는 contentId 미등록) */
type DetailEntry = "loading" | BarrierFreeDetail | null;

/**
 * 내 주변 무장애 관광지 — 홈 진입점 + 채팅 카드용(autoLoad).
 *
 * 한국관광공사 KorWithService2 locationBasedList2에서 가져온 무장애 여행지를
 * 거리순으로 나열하고, 항목마다 편의시설 상세를 disclosure(토글)로 lazy 제공한다.
 * 키 없음 / 403 → API가 {places:[]} 반환 → empty 상태로 graceful degrade.
 *
 * a11y 규칙:
 * - 항목 이름 <h4>, 섹션 헤더 <h3>.
 * - 편의시설 펼침은 버튼이 발견 경로라 <div>(자동 등장 region 아님).
 * - 편의시설 목록: 평문 <p> — definition list 금지(SR에서 "용어/정의" 낭독).
 * - 버튼 비활성은 aria-disabled, 토글은 aria-expanded.
 * - 단일 polite live region.
 * - UI 라벨 이모지 금지.
 *
 * autoLoad=true(채팅 카드): 마운트 시 자동 로드, 닫기 버튼 숨김,
 * 패널 스토어 dismissal 미참여(채팅 오버레이가 소유).
 */
export function BarrierFreeNearby({ autoLoad = false }: { autoLoad?: boolean }) {
  const t = useTranslations("barrierFreeNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  /** contentId → 상세 캐시 (한 번 가져온 항목은 재요청 안 함) */
  const [detailCache, setDetailCache] = useState<Record<string, DetailEntry>>({});
  /** 현재 펼쳐진 contentId 집합 */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  /** 펼침 상세 fetch in-flight(contentId별) — 메인 조회의 in-flight 잠금과 동형.
      detailCache 가드만으론 리렌더 전 더블클릭 두 클릭이 같은 구 스냅샷을 읽어
      둘 다 fetch를 시작(stale closure 경쟁)하므로 ref Set으로 즉시 차단한다. */
  const detailInFlightRef = useRef<Set<string>>(new Set());
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<BarrierFreeData>({
      source: { kind: "current", autoLoad },
      // 옵트인 확장 요청 — 라우트 기본 상한(8)은 limit 미지정 소비자(CLI/MCP·iOS)용,
      // "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다.
      fetchAt: ({ lat, lng }) =>
        fetch(
          `/api/places/barrier-free?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
          { cache: "no-store" },
        ),
      parse: (body) => {
        const b = body as { places?: BarrierFreePlace[] };
        const places = b.places ?? [];
        if (places.length === 0) return { kind: "empty" };
        return { kind: "done", data: { places } };
      },
      onClose: () => {
        setOpenIds(new Set());
        setDetailCache({});
      },
    });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(doneSeq);
  const live = nearbyLiveMessage(status, t, tCommon);

  /** 항목의 편의시설 펼침/접기 토글 — 펼칠 때 캐시 없으면 lazy fetch */
  async function toggleFacilities(contentId: string) {
    if (openIds.has(contentId)) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(contentId);
        return next;
      });
      return;
    }
    // 펼치기
    setOpenIds((prev) => new Set(prev).add(contentId));
    // 이미 캐시 있으면 재요청 안 함
    if (detailCache[contentId] !== undefined) return;
    // ref in-flight 가드 — 리렌더 전 더블클릭 중복 fetch 차단(stale closure 경쟁).
    if (detailInFlightRef.current.has(contentId)) return;
    detailInFlightRef.current.add(contentId);
    setDetailCache((prev) => ({ ...prev, [contentId]: "loading" }));
    try {
      const res = await fetch(
        `/api/places/barrier-free/detail?contentId=${encodeURIComponent(contentId)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setDetailCache((prev) => ({ ...prev, [contentId]: null }));
        return;
      }
      setDetailCache((prev) => ({
        ...prev,
        [contentId]: (body.detail as BarrierFreeDetail | null) ?? null,
      }));
    } catch {
      setDetailCache((prev) => ({ ...prev, [contentId]: null }));
    } finally {
      // 성공·실패 모두 해제 — 다음 펼침 시도가 막히지 않게.
      detailInFlightRef.current.delete(contentId);
    }
  }

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      showTrigger={!autoLoad}
      live={live}
      open={status.kind === "done"}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      onClose={autoLoad ? undefined : () => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          <ul className="mt-2 space-y-4">
            {status.data.places.slice(0, visibleCount).map((p, i) => {
              const isOpen = openIds.has(p.contentId);
              const cached = detailCache[p.contentId];
              return (
                <li key={p.contentId}>
                  <h4
                    className="font-medium"
                    lang="ko"
                    tabIndex={-1}
                    ref={(el) => {
                      itemHeadingRefs.current[i] = el;
                    }}
                  >
                    {joinText(
                      p.name,
                      p.category,
                      t("distance", {
                        distance: formatDistance(p.distanceMeters),
                      }),
                    )}
                  </h4>

                  <p className="mt-1 text-sm" lang="ko">
                    {p.address}
                  </p>

                  {/* 편의시설 펼침 — 버튼이 발견 경로라 <div>(자동 등장 region 아님).
                      aria-expanded으로 펼침 상태 통지. */}
                  <p className="mt-1 text-sm">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => void toggleFacilities(p.contentId)}
                      className="min-h-11 text-accent underline"
                    >
                      {isOpen ? t("hideFacilities") : t("showFacilities")}
                    </button>
                  </p>

                  {isOpen && (
                    <div className="mt-1 pl-2">
                      {cached === "loading" ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesLoading")}
                        </p>
                      ) : cached === null ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesEmpty")}
                        </p>
                      ) : cached.facilities.length === 0 ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesEmpty")}
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {cached.facilities.map((f) => (
                            <li key={f.key}>
                              {/* 평문 <p> 단일 텍스트 — definition list 금지(SR
                                  "용어/정의" 낭독 회피) + 라벨·값 span 분절 제거 */}
                              <p className="text-sm" lang="ko">
                                {`${f.label} ${f.value}`}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {status.data.places.length > visibleCount && (
            <button
              type="button"
              onClick={reveal}
              className="mt-2 min-h-11 text-sm text-accent underline"
            >
              {tActions("showMore")}
            </button>
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
