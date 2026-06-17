"use client";

import { useTranslations } from "next-intl";
import type { SubwayArrival } from "@/lib/types";

/**
 * 한 역의 실시간 도착 열차 목록 — 상세(SeoulSubwayArrival)·홈 근접
 * (SubwayArrivalsNearby) 공용 표현부. 두 곳의 도착 렌더가 갈리지 않도록 추출.
 *
 * 평면 리스트(방향 그룹핑 없음): 환승역은 노선이 섞여(예 강남=2호선 외선 +
 * 신분당선 상행) 방향만으로 묶으면 외려 혼란 — 각 항목이 노선·방향·방면·메시지로
 * 자체완결하는 편이 스크린리더 순차 낭독에 명확하다(미니멀 접근성, A2 정본).
 * arvlMsg2(message)가 완성 한국어 문장이라 낭독 정본 — lang="ko".
 */
export function SubwayArrivalList({ arrivals }: { arrivals: SubwayArrival[] }) {
  const t = useTranslations("subwayArrival");

  if (arrivals.length === 0) {
    return <p className="mt-2 text-sm opacity-70">{t("noArrivals")}</p>;
  }

  return (
    <ul className="mt-2 space-y-2 text-sm leading-relaxed">
      {arrivals.map((a, i) => (
        <li key={`${a.line ?? ""}-${a.trainLineNm}-${i}`} lang="ko">
          <div className="font-medium">
            {a.line ? `${a.line} ` : ""}
            {a.direction} · {a.trainLineNm}
            {a.express && (
              <span className="ml-1 rounded bg-accent/10 px-1 text-xs text-accent">
                {t("express")}
              </span>
            )}
          </div>
          <div>
            {a.message}
            {a.currentLocation && (
              <span className="opacity-70">
                {" "}
                ({t("currentLocation", { location: a.currentLocation })})
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
