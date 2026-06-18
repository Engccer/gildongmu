"use client";

import { useTranslations } from "next-intl";

/**
 * 검색 종류 토글 — 장소(POI) ⁄ 주소(도로명·우편번호).
 * 라디오 그룹(fieldset/legend)으로 스크린리더가 종류·선택 상태를 정확히 낭독한다
 * (탭/칩보다 시맨틱 정확 — 미니멀 접근성: 네이티브 시맨틱으로 충분, ARIA 불요).
 */
export function SearchKindToggle({
  value,
  onChange,
}: {
  value: "place" | "address";
  onChange: (v: "place" | "address") => void;
}) {
  const t = useTranslations("search.kind");
  return (
    <fieldset className="mb-3">
      <legend className="sr-only">{t("label")}</legend>
      <div className="flex gap-2">
        {(["place", "address"] as const).map((kind) => (
          <label
            key={kind}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-base font-medium has-[:checked]:border-accent has-[:checked]:bg-accent/10"
          >
            <input
              type="radio"
              name="searchKind"
              value={kind}
              checked={value === kind}
              onChange={() => onChange(kind)}
              className="accent-accent"
            />
            {t(kind)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
