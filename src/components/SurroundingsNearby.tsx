"use client";

import { useTranslations } from "next-intl";
import type { SurroundingPlace } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/** done 데이터 — 목록 한 필드. */
interface SurroundingsData {
  places: SurroundingPlace[];
}

/**
 * 내 주변 둘러보기(기능 A) — 홈 진입점. KidsPlacesNearby 동형(geolocation 공유
 * 스토어 → 좌표 조회 → 자기완결 리스트). 차이: 각 항목에 **북 기준 8방위 방향**을
 * 거리와 함께 낭독("편의점 · 남동쪽 · 약 40m"). BlindSquare식 상시 인지.
 */
export function SurroundingsNearby() {
  const t = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<SurroundingsData>({
      source: { kind: "current" },
      // 옵트인 확장 요청 — 라우트 기본 상한(12)은 limit 미지정 소비자(CLI/MCP·iOS)용,
      // "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다.
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/places/around?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`, {
          cache: "no-store",
        }),
      parse: (body) => {
        const b = body as { places?: SurroundingPlace[] };
        const places = b.places ?? [];
        if (places.length === 0) return { kind: "empty" };
        return { kind: "done", data: { places } };
      },
    });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(doneSeq);
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          <ul className="mt-2 space-y-4">
            {status.data.places.slice(0, visibleCount).map((p, i) => (
              <li key={p.id}>
                <h4
                  className="font-medium"
                  tabIndex={-1}
                  ref={(el) => {
                    itemHeadingRefs.current[i] = el;
                  }}
                >
                  {joinText(
                    p.name,
                    t("item", {
                      category: t(`category.${p.category}`),
                      direction: t(`direction.${p.bearing}`),
                      distance: formatDistance(p.distanceMeters),
                    }),
                  )}
                </h4>

                {p.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${p.phone}`} className="text-accent underline">
                      {`${p.phone} ${t("call")}`}
                    </a>
                  </p>
                )}

                {p.link && (
                  <p className="mt-1 text-sm">
                    <a
                      href={p.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {t("mapLink")}
                    </a>
                  </p>
                )}
              </li>
            ))}
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
