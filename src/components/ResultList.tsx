"use client";

import { useTranslations } from "next-intl";
import type { CategoryGroup } from "@/lib/category";
import type { Place } from "@/lib/types";
import { PlaceCard } from "./PlaceCard";

export function ResultList({
  groups,
  onOpen,
}: {
  groups: CategoryGroup[];
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations("category");
  return (
    <div className="mt-3 flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.bucket}>
          <h3 className="text-lg font-semibold">
            {t("groupHeading", {
              label: t(group.bucket),
              count: group.places.length,
            })}
          </h3>
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
