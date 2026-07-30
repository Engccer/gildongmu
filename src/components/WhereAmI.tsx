"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import type { WhereAmI as WhereAmIData } from "@/lib/types";
import { buildLocationNarrative } from "@/lib/where-am-i";
import { formatDistance } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** done 데이터 — 정위 결과 한 필드. */
interface WhereAmIState {
  data: WhereAmIData;
}

/**
 * "현재 위치" 정위 카드 — 홈 "내 주변" 묶음 맨 위 별도 버튼. SurroundingsNearby
 * 동형(공유 geolocation·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).
 * 차이: 카테고리 리스트가 아니라 도로명·행정동·근접역·기준점을 결정론 산문 두세
 * 단락으로 제시(buildLocationNarrative).
 */
export function WhereAmI() {
  const t = useTranslations("whereAmI");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<WhereAmIState>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/where-am-i?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        // 조각이 하나도 안 잡히면 라우트가 data:null로 200을 준다(오류 아님).
        const b = body as { data?: WhereAmIData | null };
        if (!b.data) return { kind: "empty" };
        return { kind: "done", data: { data: b.data } };
      },
    });
  // done 통지는 헤딩 포커스(ready+asOf 텍스트)가 담당 — 접근성 헌장 §5(재포커스
  // 라벨이 곧 상태 신호, 별도 announce 중복 금지).
  const live = nearbyLiveMessage(status, t, tCommon, () => "");

  const narrative =
    status.kind === "done" ? buildLocationNarrative(status.data.data) : null;

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done" && narrative !== null}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {narrative && (
        <>
          {/* 단락 1 — 위치 + 가장 가까운 역. 결정론 산문 한 단락을 한 텍스트 런으로:
              장소·역명·노선을 <span>으로 감싸지 않고 문자열로 보간해 VoiceOver가
              문장을 끊지 않고 한 번에 낭독한다(산문 템플릿 자체는 불변). */}
          <p className="mt-2 text-sm leading-relaxed">
            {narrative.place &&
              t.rich("narrative.here", {
                place: () => narrative.place,
              })}
            {narrative.station && (
              <>
                {" "}
                {t.rich("narrative.station", {
                  name: () => narrative.station!.name,
                  line: () =>
                    narrative.station!.line
                      ? ` (${narrative.station!.line})`
                      : "",
                  direction: t(`direction.${narrative.station.bearing}`),
                  distance: formatDistance(narrative.station.distanceMeters),
                })}
              </>
            )}
          </p>

          {/* 단락 2 — 주변 기준점(거리순 상위 6) */}
          {narrative.landmarks.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed">
              {t("narrative.landmarksLead")}
              {narrative.landmarks.map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 && ", "}
                  {t.rich("narrative.landmarkItem", {
                    name: () => l.name,
                    category: t(`category.${l.category}`),
                    direction: t(`direction.${l.bearing}`),
                    distance: formatDistance(l.distanceMeters),
                  })}
                </Fragment>
              ))}
              {t("narrative.landmarksTail")}
            </p>
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
