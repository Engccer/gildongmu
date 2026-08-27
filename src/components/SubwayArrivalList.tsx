"use client";

import { useTranslations } from "next-intl";
import type { SubwayArrival } from "@/lib/types";
import { arrivalItems } from "@/lib/place-lines/station-arrivals";

/**
 * 한 역의 실시간 도착 열차 목록 — 상세(SeoulSubwayArrival)·홈 근접
 * (SubwayArrivalsNearby) 공용 표현부. 두 곳의 도착 렌더가 갈리지 않도록 추출.
 *
 * 평면 리스트(방향 그룹핑 없음): 환승역은 노선이 섞여(예 강남=2호선 외선 +
 * 신분당선 상행) 방향만으로 묶으면 외려 혼란 — 각 항목이 노선·방향·방면·메시지로
 * 자체완결하는 편이 스크린리더 순차 낭독에 명확하다(미니멀 접근성, A2 정본).
 * arvlMsg2(message)가 완성 한국어 문장이라 낭독 정본 — lang="ko".
 *
 * 한 줄 = 한 접근성 객체(joinText): 노선·방면·급행·현재위치를 인라인 span으로
 * 쪼개면 VoiceOver가 조각마다 멈춘다(가운뎃점까지 별도 객체). 두 줄(편성/메시지)은
 * 블록이라 자연 분리되지만, 각 줄 내부는 단일 텍스트로 합쳐 한 번에 낭독한다.
 */
export function SubwayArrivalList({ arrivals }: { arrivals: SubwayArrival[] }) {
  const t = useTranslations("subwayArrival");

  if (arrivals.length === 0) {
    return <p className="mt-2 text-sm opacity-70">{t("noArrivals")}</p>;
  }

  // 문장 정본은 place-lines(도구층과 공용) — 편성/메시지 두 줄을 그대로 그린다.
  const items = arrivalItems(arrivals, t);

  return (
    <ul className="mt-2 space-y-2 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={`${arrivals[i].line ?? ""}-${arrivals[i].trainLineNm}-${i}`} lang="ko">
          <div className="font-medium">{item.line}</div>
          <div>{item.message}</div>
        </li>
      ))}
    </ul>
  );
}
