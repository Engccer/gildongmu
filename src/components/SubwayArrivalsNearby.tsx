"use client";

import { useLocale, useTranslations } from "next-intl";
import type { NearbySubwayStation, NearestSubwayStation } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";
import { SubwayArrivalList } from "./SubwayArrivalList";
import { TransitBilingualName } from "./TransitBilingualName";

/**
 * done 데이터 — 목록 한 필드. `nearest`는 0건(empty.detail)일 때만 실린다:
 * 반경 밖 최근접 역이라 목록에 섞으면 "탈 수 있는 역"으로 오독된다.
 */
interface SubwayData {
  stations: NearbySubwayStation[];
  nearest?: NearestSubwayStation;
}

/**
 * 역명·노선 조각의 언어 선택(E27 §3.6 줄 단위 원자성). en 계열은 영문 역명과 노선 영문(`linesEn`)이
 * **둘 다** 있을 때만 영어 조각이고, 하나라도 없으면 둘 다 한국어 원문이다 — 한 헤딩 안에서
 * `Gangnam, 2호선`처럼 언어가 섞이지 않게. 거리("about 350m")는 UI 문장이라 어느 쪽에도 붙는다(혼합 줄, 태그 없음).
 */
function stationParts(
  isEn: boolean,
  s: { stationName: string; nameEn?: string; lines: string[]; linesEn?: string[] },
): { en: boolean; name: string; ko?: string; lines: string } {
  const linesEn = s.lines.length === 0 ? [] : s.linesEn;
  if (isEn && s.nameEn && linesEn) {
    return { en: true, name: s.nameEn, ko: s.stationName, lines: linesEn.join(", ") };
  }
  return { en: false, name: s.stationName, lines: s.lines.join(", ") };
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
  const locale = useLocale();
  const isEn = prefersEnglish(locale);
  const { status, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<SubwayData>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        // `lang=en`은 노선·도착 영문 필드(E27)를 additive로 받는다. ko는 종전 URL과 같다.
        fetch(`/api/station/subway-arrival/nearby?lat=${lat}&lng=${lng}&lang=${dataLocale(locale)}`, {
          cache: "no-store",
        }),
      parse: (body) => {
        const b = body as { stations?: NearbySubwayStation[]; nearest?: NearestSubwayStation };
        const stations = b.stations ?? [];
        if (stations.length === 0) {
          return { kind: "empty", detail: { stations, nearest: b.nearest } };
        }
        return { kind: "done", data: { stations } };
      },
    });

  // 0건일 때 최근접 역 거리를 덧붙인다 — "1km 안에 없다"(강동 1.5km)와 "이 지역엔
  // 도시철도가 없다"(강릉 90km)를 사용자가 거리로 구분한다. 서버가 판정선을 긋지
  // 않는 이유는 provider 주석(findNearestStationInfo) 참고.
  const nearest = status.kind === "empty" ? status.detail?.nearest : undefined;
  const nearestParts = nearest ? stationParts(isEn, nearest) : undefined;
  const live =
    nearest && nearestParts
      ? t("emptyNearest", {
          station: joinText(nearestParts.name, nearestParts.lines),
          distance: formatDistance(nearest.distanceMeters),
        })
      : nearbyLiveMessage(status, t, tCommon);

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
          {status.data.stations.map((s) => {
            const parts = stationParts(isEn, s);
            const tail = joinText(parts.lines, t("stationDistance", { distance: formatDistance(s.distanceMeters) }));
            return (
              <li key={`${s.stationName}-${s.distanceMeters}`}>
                {/* 한 줄 = 한 객체: 역명(현재 언어)·노선·거리를 한 heading 텍스트로 합쳐 VoiceOver가
                    한 번에 낭독한다. en은 역명·노선이 다 영문일 때만 영문이고(괄호 한글은 시각 전용,
                    aria-hidden), 아니면 둘 다 한국어 원문이다(E27 §3.6). */}
                <h4 className="font-medium">
                  {parts.en ? <TransitBilingualName en={parts.name} ko={parts.ko} /> : parts.name}
                  {tail ? `, ${tail}` : ""}
                </h4>
                {/* 4-state를 뭉개지 않는다: 조회 실패 / 운행 시간 밖(첫차 동반) /
                    실시간 미제공 / 정상. closed인데 첫차가 없으면 판정 근거가 반쪽이므로
                    "운행이 끝났다"고 말하지 않고 미제공으로 물러선다. */}
                {s.arrivalStatus === "unavailable" ? (
                  <p className="mt-1 text-sm opacity-70">{t("arrivalUnavailable")}</p>
                ) : s.arrivalStatus === "closed" && s.firstTime ? (
                  <p className="mt-1 text-sm opacity-70">
                    {t("closed", { time: s.firstTime })}
                  </p>
                ) : s.arrivalStatus === "closed" || s.arrivalStatus === "unknown" ? (
                  <p className="mt-1 text-sm opacity-70">{t("noRealtime")}</p>
                ) : (
                  <SubwayArrivalList arrivals={s.arrivals} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </NearbyPanelShell>
  );
}
