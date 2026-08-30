"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BusStop } from "@/lib/types";
import { formatDistance, durationToMinutes, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { BusRouteStops } from "./BusRouteStops";

/** done 데이터 — 목록 한 필드. */
interface BusData {
  stops: BusStop[];
}

/**
 * 근처 정류소 + 도착 예정 버스 — 지도 없이 완결되는 대중교통 정보 정본.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회(위치 단계 없음).
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침" + 조회시각으로 신선도를 보장한다
 * (스크린 리더에 반복 통지가 끼어들지 않도록 — 접근성 결정).
 */
export function BusArrivals(
  props:
    | { mode: "current" }
    | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bus");
  const bilingual = useBilingualName();
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  /** BusRouteStops(경유정류소) 통지 — 도착 항목마다 별도 live region이 생기지
   * 않도록 단일 live region으로 승격해 받는다. */
  const [routeStopsNotice, setRouteStopsNotice] = useState("");
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<BusData>({
      source:
        props.mode === "place"
          ? { kind: "place", lat: props.lat, lng: props.lng }
          : { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/bus/nearby?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        const b = body as { stops?: BusStop[] };
        const stops = b.stops ?? [];
        if (stops.length === 0) return { kind: "empty" };
        return { kind: "done", data: { stops } };
      },
      onClose: () => setRouteStopsNotice(""),
    });

  // 새 조회는 이전 경유정류소 통지를 먼저 지운다 — 아코디언 점유(claim)보다 앞선
  // 현행 순서 그대로다.
  const handleTrigger = () => {
    setRouteStopsNotice("");
    load(status.kind === "done");
  };

  // done 통지는 헤딩 포커스(ready+asOf 텍스트)가 담당 — 접근성 헌장 §5(재포커스
  // 라벨이 곧 상태 신호, 별도 announce 중복 금지). done이 빈 문자열이어야
  // 자식(BusRouteStops) 통지가 이 단일 채널에 노출된다.
  const live = nearbyLiveMessage(status, t, tCommon, () => "") || routeStopsNotice;

  return (
    <NearbyPanelShell
      triggerLabel={
        status.kind === "done"
          ? t("refresh")
          : props.mode === "current"
            ? t("currentButton")
            : t("placeButton")
      }
      onTrigger={handleTrigger}
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
          {status.data.stops.map((stop) => {
            const name = bilingual(stop.name, { roman: stop.nameRoman });
            const line = joinText(
              name.primary,
              t("stopDistance", {
                distance: formatDistance(stop.distanceMeters),
              }),
            );
            return (
            <li key={`${stop.source}-${stop.cityCode}-${stop.nodeId}`}>
              {/* 정류소명 병기(E28 R1) — 도착 목록은 E27(대중교통 영문화) 소관이라 손대지 않는다. */}
              <h4 className="font-medium" lang={langFor(line)}>
                {line}
                <KoTail secondary={name.secondary} />
              </h4>
              {stop.arrivalStatus === "unavailable" ? (
                // 도착조회 실패 ≠ 버스 없음(개정 노트 §1) — 별도 문구로 통지
                <p className="text-sm opacity-70">{t("arrivalUnavailable")}</p>
              ) : stop.arrivals.length === 0 ? (
                <p className="text-sm opacity-70">{t("noArrivals")}</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {stop.arrivals.map((a, i) => {
                    const type =
                      a.routeType || (a.lowFloor ? t("lowFloor") : t("normalBus"));
                    return (
                      <li key={`${a.source}-${a.routeId}-${i}`}>
                        {/* 한 줄 = 한 객체: 도착 문장과 저상버스 배지를 단일
                            텍스트로 합친다. 저상 정보는 routeType이 없을 때 이미
                            type으로 낭독되므로, 중복 낭독을 피해 routeType이 있을
                            때만 배지를 흡수한다(정보 집합은 동일). */}
                        <span lang="ko">
                          {/* 서울은 arrmsg1 완성 문장이 정본(arrivalMessage), TAGO는 슬롯형. */}
                          {joinText(
                            a.arrivalMessage
                              ? t("arrivalMessage", {
                                  route: a.routeNo,
                                  type,
                                  message: a.arrivalMessage,
                                })
                              : t("arrival", {
                                  route: a.routeNo,
                                  type,
                                  prev: a.prevStationCount,
                                  min: durationToMinutes(a.arrivalSeconds),
                                }),
                            a.routeType && a.lowFloor && t("lowFloor"),
                          )}
                        </span>
                        <BusRouteStops
                          source={stop.source}
                          cityCode={stop.cityCode}
                          routeId={a.routeId}
                          routeNo={a.routeNo}
                          onNotice={setRouteStopsNotice}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </NearbyPanelShell>
  );
}
