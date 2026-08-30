/**
 * 도시철도역 메타(`StationMeta` 컴포넌트) 줄 조립 — 화면과 도구가 같은 문장을 읽는다.
 */
import { joinText } from "../format";
import type { StationMeta } from "../types";
import { pickLine, type LocalizedLine } from "./pick-line";
import type { TranslateFn } from "./translate";

/**
 * [영문역명 줄, 노선 줄(환승이면 배지 텍스트 흡수), 운영기관 줄].
 * 영문역명은 en·ko 모두 같은 문자열이고 로케일 차이는 화면 스타일(주/보조)뿐. 노선 줄은 en 계열
 * 로케일에서 서버 `linesEn`(E27)이 있을 때만 영문이고, 없으면 한국어 원문(`lang: "ko"`) — 라벨
 * `Lines`가 섞인 혼합 줄이라 영어 쪽은 태그하지 않는다.
 */
export function stationMetaLocalizedLines(
  meta: StationMeta,
  t: TranslateFn,
  locale: string = "ko",
): LocalizedLine[] {
  const transfer = meta.isTransfer && t("transfer");
  const linesKo = joinText(`${t("lines")} ${meta.lines.join(", ")}`, transfer);
  const lines = pickLine(
    locale,
    linesKo,
    [meta.linesEn ? meta.linesEn.join(", ") : undefined],
    ([en]) => joinText(`${t("lines")} ${en}`, transfer),
    { pure: false },
  );
  return [{ text: meta.nameEn }, lines, { text: `${t("operator")} ${meta.operator}` }];
}

/** 도구층·테스트용 평문(언어 태그 없음). */
export function stationMetaLines(meta: StationMeta, t: TranslateFn, locale: string = "ko"): string[] {
  return stationMetaLocalizedLines(meta, t, locale).map((l) => l.text);
}
