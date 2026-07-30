"use client";

import { useTranslations } from "next-intl";
import type { KidsPlace } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

/** done 데이터 — 목록 한 필드. */
interface KidsData {
  kids: KidsPlace[];
}

/**
 * 근처 아이 놀 곳(키즈카페·놀이터·어린이공원, B3) — 홈 진입점.
 *
 * 따릉이/지하철/소아진료 nearby와 동형: 버튼 → geolocation → 좌표 조회.
 * 카카오 로컬 좌표 근접이지만 **키워드 매칭 ≠ 키즈 장소**라 서버에서 카테고리
 * 화이트리스트로 거짓양성을 거른 결과만 받는다(시각장애인 정합). 실내/실외는
 * 3-state 라벨(놀이터 모호 시 "정보 없음") — 우천 시 사용자가 듣고 판단.
 * 자기완결 정보 리스트(상세 연동 비포함) — 길찾기는 카카오맵 링크로 위임.
 */
export function KidsPlacesNearby() {
  const t = useTranslations("kidsNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<KidsData>({
      source: { kind: "current" },
      // 옵트인 확장 요청 — 라우트 기본 상한(8)은 limit 미지정 소비자(CLI/MCP·iOS)용,
      // "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다.
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/places/kids?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`, {
          cache: "no-store",
        }),
      parse: (body) => {
        const b = body as { kids?: KidsPlace[] };
        const kids = b.kids ?? [];
        if (kids.length === 0) return { kind: "empty" };
        return { kind: "done", data: { kids } };
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
            {status.data.kids.slice(0, visibleCount).map((k, i) => (
              <li key={k.id}>
                {/* 한 줄 = 한 객체: 이름·분류·실내외·거리를 단일 텍스트로 합친다.
                    분류·실내외·거리는 번역(로케일 정합)이고 이름은 한국어 전용이라,
                    SubwayArrivalsNearby와 동형으로 lang 없이 페이지 로케일을 따른다. */}
                <h4
                  className="font-medium"
                  tabIndex={-1}
                  ref={(el) => {
                    itemHeadingRefs.current[i] = el;
                  }}
                >
                  {joinText(
                    k.name,
                    t(`kind.${k.kind}`),
                    t(`indoor.${k.indoorOutdoor}`),
                    t("distance", { distance: formatDistance(k.distanceMeters) }),
                  )}
                </h4>

                <p className="mt-1 text-sm" lang="ko">
                  {k.address}
                </p>

                {/* 전화번호가 있으면 1탭 통화(키즈카페 예약·운영 확인 — 시각장애인 정합,
                    NightClinicsNearby의 tel: 패턴 동형). 공원·놀이터는 대개 미제공. */}
                {k.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${k.phone}`} className="text-accent underline">
                      {joinText(k.phone, t("call"))}
                    </a>
                  </p>
                )}

                {k.link && (
                  <p className="mt-1 text-sm">
                    <a
                      href={k.link}
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
          {status.data.kids.length > visibleCount && (
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
