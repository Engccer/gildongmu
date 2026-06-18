"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { JusoAddress } from "@/lib/types";

/**
 * juso 주소 검색 결과 목록. 항목 선택 → onSelect(addr) → 상위가 좌표 지오코딩 후
 * 상세로 진입한다. 영문 UI(en)는 공식 영문 주소를 메인, 한글 도로명을 보조로
 * 보인다(한글은 lang="ko"로 SR 음성 엔진 정합). 정보 정본은 텍스트.
 */
export function AddressResultList({
  addresses,
  onSelect,
}: {
  addresses: JusoAddress[];
  onSelect: (addr: JusoAddress) => void;
}) {
  const t = useTranslations("address");
  const locale = useLocale();
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {addresses.map((addr, i) => {
        const useEng = locale === "en" && Boolean(addr.engAddr);
        return (
          <li
            key={`${addr.roadAddr}-${i}`}
            className="rounded-lg border border-border bg-surface"
          >
            <button
              type="button"
              onClick={() => onSelect(addr)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <span>
                <span
                  className="block text-lg font-bold"
                  lang={useEng ? undefined : "ko"}
                >
                  {useEng ? addr.engAddr : addr.roadAddr}
                </span>
                {useEng && (
                  <span className="mt-0.5 block text-sm text-muted" lang="ko">
                    {addr.roadAddr}
                  </span>
                )}
                <span className="mt-0.5 block text-sm text-muted">
                  {t("jibun")} <span lang="ko">{addr.jibunAddr}</span>
                </span>
                {addr.zipNo && (
                  <span className="mt-0.5 block text-sm text-muted">
                    {t("postalCode")} {addr.zipNo}
                  </span>
                )}
              </span>
              <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
