"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Place } from "@/lib/types";
import { formatDistance, hasHangul, joinText } from "@/lib/format";

export function PlaceCard({
  place,
  onOpen,
}: {
  place: Place;
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations("place");
  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => onOpen(place)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          {/* 카카오 장소명·분류는 en 페이지에서도 한국어다 — 블록마다 lang="ko"(A26). 이미 별도
              블록이라 새 분절은 없다. TourAPI en 데이터처럼 한글이 없으면 페이지 언어를 따른다. */}
          <span className="block text-lg font-bold" lang={hasHangul(place.name) ? "ko" : undefined}>
            {place.name}
          </span>
          <span
            className="mt-0.5 block text-sm text-muted"
            lang={hasHangul(place.category) ? "ko" : undefined}
          >
            {joinText(
              place.category,
              place.distanceMeters != null &&
                t("distance", {
                  distance: formatDistance(place.distanceMeters),
                }),
            )}
          </span>
          {/* 영문 주소가 없어 한글 주소를 그대로 보일 땐 lang="ko"를 줘
              영문 UI에서도 SR이 올바른 음성 엔진으로 읽게 한다(ko에선 무해). */}
          <span
            className="mt-0.5 block text-sm"
            lang={place.englishAddress ? undefined : "ko"}
          >
            {place.englishAddress ?? (place.roadAddress || place.address)}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
      </button>
    </li>
  );
}
