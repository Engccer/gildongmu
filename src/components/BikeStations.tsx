"use client";

import { useTranslations } from "next-intl";
import type { BikeStation } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** done 데이터 — 목록 한 필드. */
interface BikeData {
  stations: BikeStation[];
}

/**
 * 근처 따릉이 대여소 + 대여 가능 수 — 지도 없이 완결되는 공공자전거 정보.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회.
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침"으로 신선도를 보장한다
 * (스크린 리더 반복 통지 방지 — 접근성 결정). BusArrivals와 동형.
 */
export function BikeStations(
  props: { mode: "current" } | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bike");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<BikeData>({
      source:
        props.mode === "place"
          ? { kind: "place", lat: props.lat, lng: props.lng }
          : { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/bike/nearby?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        const b = body as { stations?: BikeStation[] };
        const stations = b.stations ?? [];
        if (stations.length === 0) return { kind: "empty" };
        return { kind: "done", data: { stations } };
      },
    });
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={
        status.kind === "done"
          ? t("refresh")
          : props.mode === "current"
            ? t("currentButton")
            : t("placeButton")
      }
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
        <ul className="mt-2 space-y-3">
          {status.data.stations.map((s) => (
            <li key={s.stationId}>
              <h4 className="font-medium" lang="ko">
                {joinText(
                  s.name,
                  t("stationDistance", {
                    distance: formatDistance(s.distanceMeters),
                  }),
                )}
              </h4>
              <p className="text-sm">
                {t("availability", {
                  bikes: s.bikesAvailable,
                  racks: s.racksTotal,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </NearbyPanelShell>
  );
}
