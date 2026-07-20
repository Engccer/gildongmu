"use client";

import type { Place } from "@/lib/types";
import { PlaceCard } from "./PlaceCard";

/**
 * 정확도순 플랫 리스트. 버킷 섹션 분할은 폐지(2026-07-21) — 고정 섹션 서열이
 * 정확도 1위를 최하단에 매몰시키는 회귀 6사례 실측(신명중학교·롯데타워·곰두리 등).
 * 순위는 provider 관련도가 전담하고, 버킷은 칩 필터로만 쓴다.
 */
export function ResultList({
  places,
  onOpen,
}: {
  places: Place[];
  onOpen: (place: Place) => void;
}) {
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {places.map((place) => (
        <PlaceCard key={place.id} place={place} onOpen={onOpen} />
      ))}
    </ul>
  );
}
