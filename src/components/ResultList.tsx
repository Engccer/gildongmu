"use client";

import { useTranslations } from "next-intl";
import type { CategoryGroup } from "@/lib/category";
import type { Place } from "@/lib/types";
import { PlaceCard } from "./PlaceCard";

export function ResultList({
  groups,
  onOpen,
  headingLevel = 3,
}: {
  groups: CategoryGroup[];
  onOpen: (place: Place) => void;
  /** 카테고리 그룹 헤딩 레벨. 두 섹션(장소+주소)이 모두 노출되어 섹션 헤딩(h3)이
   * 있을 때는 4를 전달해 outline 계층을 맞춘다. 기본값 3(단독 섹션, 기존 동작). */
  headingLevel?: 3 | 4;
}) {
  const t = useTranslations("category");
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <div className="mt-3 flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.bucket}>
          <Heading className="text-lg font-semibold">
            {t("groupHeading", {
              label: t(group.bucket),
              count: group.places.length,
            })}
          </Heading>
          <ul className="mt-2 flex flex-col gap-3">
            {group.places.map((place) => (
              <PlaceCard key={place.id} place={place} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
