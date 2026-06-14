"use client";

import { useTranslations } from "next-intl";
import type { CategoryBucket } from "@/lib/category";

export function ChipFilter({
  buckets,
  selected,
  counts,
  onSelect,
}: {
  buckets: CategoryBucket[];
  selected: CategoryBucket | null;
  counts: Record<CategoryBucket, number>;
  onSelect: (b: CategoryBucket | null) => void;
}) {
  const t = useTranslations("category");
  if (buckets.length <= 1) return null; // 버킷이 하나뿐이면 필터 불필요

  const chip = (
    key: string,
    label: string,
    isSelected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className="min-h-11 rounded-full border border-border px-4 text-sm font-medium aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={t("filterLabel")}
      className="flex flex-wrap gap-2"
    >
      {chip("all", t("all"), selected === null, () => onSelect(null))}
      {buckets.map((b) =>
        chip(b, `${t(b)} ${counts[b]}`, selected === b, () => onSelect(b)),
      )}
    </div>
  );
}
