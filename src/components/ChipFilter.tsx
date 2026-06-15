"use client";

/**
 * 단일 축 칩 필터 (카테고리·지역 공용).
 *
 * 라벨·번역은 호출부 책임으로 두고 이 컴포넌트는 표시만 한다 — 카테고리는
 * 고정 버킷(t("category.*")), 지역은 시·도 slug(t("region.*"))로 키 체계가
 * 다르기 때문. 제네릭 키 T로 타입 안전성을 유지한다(as 캐스팅 불필요).
 *
 * 항목이 1개 이하면 분류 의미가 없어 스스로 숨는다 — 이 규칙 덕에 검색 성격에
 * 따라(브랜드 검색=지역 다수, 지역 검색=카테고리 다수) 필요한 축만 자동 노출된다.
 */

export interface ChipFilterItem<T extends string> {
  key: T;
  /** 번역된 표시 라벨(카운트 제외) */
  label: string;
  count: number;
}

export function ChipFilter<T extends string>({
  groupLabel,
  allLabel,
  items,
  selected,
  onSelect,
}: {
  /** role="group"의 aria-label */
  groupLabel: string;
  /** 전체(필터 해제) 칩 라벨 */
  allLabel: string;
  items: ChipFilterItem<T>[];
  selected: T | null;
  onSelect: (key: T | null) => void;
}) {
  if (items.length <= 1) return null; // 항목이 하나뿐이면 필터 불필요

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
    <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-2">
      {chip("all", allLabel, selected === null, () => onSelect(null))}
      {items.map((it) =>
        chip(
          it.key,
          `${it.label} ${it.count}`,
          selected === it.key,
          () => onSelect(it.key),
        ),
      )}
    </div>
  );
}
