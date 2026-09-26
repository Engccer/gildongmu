/**
 * 도시철도 운영기관명 영문 표(순수). 키는 역 seed `operator` 원문이고, seed가 연 1회 갱신되는
 * 닫힌 집합이라 정적 표가 정답이다. 영문은 각 기관의 공식 영문 표기다.
 *
 * **미지 입력은 null** — 소비자가 한국어 원문으로 폴백한다(노선명 표 `subwayLineNameEn`과 같은 정책).
 * ⚠ seed를 다시 만들면 `subway-operator-names-drift.test.ts`가 새 운영기관을 잡는다.
 */
const OPERATOR_EN: Record<string, string> = {
  "한국철도공사": "Korail",
  "서울교통공사": "Seoul Metro",
  "서울특별시 서울시메트로9호선㈜": "Seoul Metro Line 9 Corporation",
  "서울시메트로9호선㈜": "Seoul Metro Line 9 Corporation",
  "부산광역시 부산교통공사": "Busan Transportation Corporation",
  "대구교통공사": "Daegu Transportation Corporation",
  "인천교통공사": "Incheon Transit Corporation",
  "대전교통공사": "Daejeon Transportation Corporation",
  "광주교통공사": "Gwangju Transportation Corporation",
  "부산-김해경전철㈜": "Busan-Gimhae Light Rail Transit",
  "경기도 신분당선": "Shinbundang Line",
  "경기도 용인경전철": "Yongin EverLine",
  "의정부경량전철㈜": "Uijeongbu Light Rail Transit",
  "공항철도주식회사": "AREX",
  "우이신설경전철운영㈜": "Ui LRT",
  "남서울경전철 주식회사": "South Seoul LRT",
  "김포골드라인에스알에스㈜": "Gimpo Goldline",
  "인천광역시 인천국제공항공사": "Incheon International Airport Corporation",
  "남양주도시공사": "Namyangju Urban Corporation",
  "구리도시공사": "Guri Urban Corporation",
};

export function subwayOperatorNameEn(ko: string | undefined | null): string | null {
  if (!ko) return null;
  return OPERATOR_EN[ko.trim()] ?? null;
}
