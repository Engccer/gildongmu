"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { JusoAddress } from "@/lib/types";
import { bilingualName } from "@/lib/bilingual-name";
import { KoTail, langFor } from "@/components/BilingualName";

/**
 * juso 주소 검색 결과 목록. 항목 선택 → onSelect(addr) → 상위가 좌표 지오코딩 후
 * 상세로 진입한다. 영문 UI(en)는 공식 영문 주소를 메인으로 보이고 한글 도로명은
 * 같은 줄 끝 괄호(시각 전용, E28 — 종전 보조 블록은 버튼 이름에 한글이 섞여 낭독됐다).
 * 정보 정본은 텍스트.
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
        // 다른 소비 지점과 같은 가드(`bilingualName` 규칙 2 — 한글 섞인 후보 배제)를 지난다. juso `engAddr`에
        // 미번역 한글 조각이 섞이면 한글 도로명으로 물러난다(코드 리뷰 검출).
        const name = bilingualName(locale, addr.roadAddr, { en: addr.engAddr });
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
                <span className="block text-lg font-bold" lang={langFor(name.primary)}>
                  {name.primary}
                  <KoTail secondary={name.secondary} />
                </span>
                {/* 라벨+지번을 한 텍스트로 — 라벨·공백·지번 span으로 나뉘면 StaticText 셋(Chrome AX 실측
                    2026-08-31). 지번은 한국어라 줄 전체 lang="ko"(A26 혼합 줄 축). */}
                <span className="mt-0.5 block text-sm text-muted" lang="ko">
                  {`${t("jibun")} ${addr.jibunAddr}`}
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
