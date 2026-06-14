"use client";

import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Place } from "@/lib/types";

export function PlaceCard({
  place,
  onOpen,
}: {
  place: Place;
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations();
  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => onOpen(place)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        aria-label={t("place.openDetail", { name: place.name })}
      >
        <span>
          <span className="block text-lg font-bold">{place.name}</span>
          <span className="mt-0.5 block text-sm text-muted">
            {place.category}
          </span>
          <span className="mt-0.5 block text-sm">
            {place.englishAddress ?? (place.roadAddress || place.address)}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
      </button>
    </li>
  );
}
