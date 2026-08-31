"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import type { Place } from "@/lib/types";
import { formatDistance, hasHangul, joinText } from "@/lib/format";
import { pickCategory } from "@/lib/kakao-category";

export function PlaceCard({
  place,
  onOpen,
}: {
  place: Place;
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations("place");
  const name = useBilingualName()(place.name, { roman: place.nameRoman });
  // 분류는 서버 `categoryEn`(A28, 세그먼트 전부 등재일 때만)을 비-ko에서 우선하고, 없으면 원문 + lang="ko".
  const category = pickCategory(useLocale(), place);
  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => onOpen(place)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          {/* 카카오 장소명·분류가 en 페이지에서 한국어로 남으면 블록마다 lang="ko"(A26). 이미 별도
              블록이라 새 분절은 없다. 영문(TourAPI en·categoryEn)이면 페이지 언어를 따른다. */}
          <span className="block text-lg font-bold" lang={langFor(name.primary)}>
            {name.primary}
            <KoTail secondary={name.secondary} />
          </span>
          <span
            className="mt-0.5 block text-sm text-muted"
            lang={hasHangul(category) ? "ko" : undefined}
          >
            {joinText(
              category,
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
