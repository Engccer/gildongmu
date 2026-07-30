"use client";

import { useLocale, useTranslations } from "next-intl";
import type { NearbySubwayStation } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { prefersEnglish } from "@/lib/data-locale";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { SubwayArrivalList } from "./SubwayArrivalList";

/** done 데이터 — 목록 한 필드. */
interface SubwayData {
  stations: NearbySubwayStation[];
}

/**
 * 내 주변 서울 지하철 실시간 도착 — 홈(idle) 진입점. 좌표→근접역→역별 실시간.
 *
 * BusArrivals/BikeStations(mode="current")와 동형: 버튼 → geolocation → 좌표로
 * 조회. 다만 좌표를 직접 받는 버스/따릉이와 달리 지하철은 라우트가 좌표→근접역
 * (A3 seed)→역별 실시간을 합성한다. 실시간이라 자동 폴링하지 않고 수동
 * "새로고침" + 조회시각(asOf)으로 신선도를 보장한다(스크린리더 반복 통지 방지).
 *
 * 부분 실패는 역별 arrivalStatus로 구분 — "조회 실패" 역은 별도 문구,
 * "도착 열차 없음"과 뭉개지 않는다(시각장애인 정합).
 */
export function SubwayArrivalsNearby() {
  const t = useTranslations("subwayNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const isEn = prefersEnglish(useLocale());
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<SubwayData>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/station/subway-arrival/nearby?lat=${lat}&lng=${lng}`, {
          cache: "no-store",
        }),
      parse: (body) => {
        const b = body as { stations?: NearbySubwayStation[] };
        const stations = b.stations ?? [];
        if (stations.length === 0) return { kind: "empty" };
        return { kind: "done", data: { stations } };
      },
    });
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
        <ul className="mt-2 space-y-4">
          {status.data.stations.map((s) => (
            <li key={`${s.stationName}-${s.distanceMeters}`}>
              {/* 한 줄 = 한 객체: 역명(현재 언어)·노선·거리를 단일 텍스트로
                  합쳐 VoiceOver가 한 번에 낭독한다. 한국어 데이터(노선)는
                  en 로케일에서도 한국어 표기뿐이라 그대로 둔다. */}
              <h4 className="font-medium">
                {joinText(
                  isEn ? s.nameEn || s.stationName : s.stationName,
                  s.lines.length > 0 && s.lines.join(", "),
                  t("stationDistance", {
                    distance: formatDistance(s.distanceMeters),
                  }),
                )}
              </h4>
              {s.arrivalStatus === "unavailable" ? (
                <p className="mt-1 text-sm opacity-70">{t("arrivalUnavailable")}</p>
              ) : (
                <SubwayArrivalList arrivals={s.arrivals} />
              )}
            </li>
          ))}
        </ul>
      )}
    </NearbyPanelShell>
  );
}
