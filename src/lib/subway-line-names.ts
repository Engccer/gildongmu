/**
 * 지하철 노선명 영문 표(E27 §3.3, 순수). 전국 노선명은 닫힌 집합이라 정적 표가 정답이다.
 *
 * 입력은 세 생산자에서 온다 — seed `lineName`(`"부산 도시철도 1호선"`), 서울 실시간 subwayId
 * 표(`"경의중앙선"`), ODsay lane `nameKor`(`"수도권 9호선(급행)"`), TAGO `routeName`(`"수인분당"`·
 * `"인천1호선"`·`"공항"`)과 그 `displayLineName` 결과(`"수인분당선"`). 표 키는 공백·마침표를 뺀
 * 모양이고 `수도권` 접두만 벗긴다(그 밖의 지역 접두는 노선 식별 정보라 표에 그대로 둔다).
 *
 * 영문은 각 운영기관 공식 표기이되 en dash(`–`)는 낭독 미확인이라 하이픈으로 쓴다.
 * **미지 입력은 null** — 음차·provider 영문 폴백 없이 소비자가 한국어 원문으로 폴백한다
 * (모든 소비자가 같은 정책, 설계 리뷰 #11). ODsay 영문(`Suin·Bundang Line`·`Busan 1 Line`)은
 * 급행 표지를 잃고 비공식이라 쓰지 않는다.
 *
 * ⚠ 표에 노선을 더할 때 `subway-line-names-drift.test.ts`가 생산자 5축 전수를 다시 판정한다.
 */

const LINE_EN: Record<string, string> = {
  // 수도권 도시철도(서울교통공사·서울시메트로9호선)
  "1호선": "Line 1",
  "2호선": "Line 2",
  "3호선": "Line 3",
  "4호선": "Line 4",
  "5호선": "Line 5",
  "6호선": "Line 6",
  "7호선": "Line 7",
  "8호선": "Line 8",
  "9호선": "Line 9",
  "도시철도7호선": "Line 7",
  "광역철도8호선": "Line 8",
  "도시철도9호선": "Line 9",
  "서울도시철도9호선": "Line 9",
  // 수도권 광역·경전철
  "경의중앙선": "Gyeongui-Jungang Line",
  "경의중앙": "Gyeongui-Jungang Line",
  "중앙선": "Jungang Line",
  "경춘선": "Gyeongchun Line",
  "경춘": "Gyeongchun Line",
  "수인분당선": "Suin-Bundang Line",
  "수인분당": "Suin-Bundang Line",
  "분당선": "Bundang Line",
  "수인선": "Suin Line",
  "신분당선": "Shinbundang Line",
  "신분당": "Shinbundang Line",
  "경강선": "Gyeonggang Line",
  "경강": "Gyeonggang Line",
  "서해선": "Seohae Line",
  "서해": "Seohae Line",
  "우이신설선": "Ui-Sinseol Line",
  "우이신설": "Ui-Sinseol Line",
  "신림선": "Sillim Line",
  "신림": "Sillim Line",
  "경량도시철도신림선": "Sillim Line",
  "공항철도": "AREX",
  "공항": "AREX",
  "공항선": "AREX",
  "인천국제공항선": "AREX",
  "GTX-A": "GTX-A",
  "GTX-A선": "GTX-A",
  "김포도시철도": "Gimpo Goldline",
  "김포골드라인": "Gimpo Goldline",
  "의정부": "Uijeongbu LRT",
  "의정부경전철": "Uijeongbu LRT",
  "에버라인": "EverLine",
  "용인에버라인": "EverLine",
  "진접선": "Jinjeop Line",
  // 코레일 선로명(seed가 노선명 자리에 두는 역이 있다)
  "경부선": "Gyeongbu Line",
  "경원선": "Gyeongwon Line",
  "경인선": "Gyeongin Line",
  "안산과천선": "Ansan-Gwacheon Line",
  "일산선": "Ilsan Line",
  "장항선": "Janghang Line",
  // 인천
  "인천지하철1호선": "Incheon Line 1",
  "인천지하철2호선": "Incheon Line 2",
  "인천1호선": "Incheon Line 1",
  "인천2호선": "Incheon Line 2",
  "자기부상철도": "Incheon Airport Maglev",
  // 부산·울산
  "부산도시철도1호선": "Busan Line 1",
  "부산도시철도2호선": "Busan Line 2",
  "부산도시철도3호선": "Busan Line 3",
  "부산경량도시철도4호선": "Busan Line 4",
  "부산1호선": "Busan Line 1",
  "부산2호선": "Busan Line 2",
  "부산3호선": "Busan Line 3",
  "부산4호선": "Busan Line 4",
  "부산김해경전철": "Busan-Gimhae LRT",
  "동해선": "Donghae Line",
  "동해": "Donghae Line",
  // 대구
  "대구도시철도1호선": "Daegu Line 1",
  "대구도시철도2호선": "Daegu Line 2",
  "대구도시철도3호선": "Daegu Line 3",
  "대구1호선": "Daegu Line 1",
  "대구2호선": "Daegu Line 2",
  "대구3호선": "Daegu Line 3",
  "대경선": "Daegyeong Line",
  // 대전·광주
  "대전도시철도1호선": "Daejeon Line 1",
  "대전1호선": "Daejeon Line 1",
  "광주도시철도1호선": "Gwangju Line 1",
  "광주1호선": "Gwangju Line 1",
};

const EXPRESS_TAIL = /\(급행\)$/;

/** 표 키 정규화 — 공백·마침표 제거, `수도권` 접두 제거, 급행 꼬리 분리. */
export function subwayLineKey(ko: string): { key: string; express: boolean } {
  let s = ko.trim().replace(/[\s.]/g, "");
  s = s.replace(/^수도권/, "");
  const express = EXPRESS_TAIL.test(s);
  if (express) s = s.replace(EXPRESS_TAIL, "");
  return { key: s, express };
}

const warned = new Set<string>();

/**
 * 한국어 노선명 → 영문. 미지는 null(소비자는 한국어 원문 + `lang="ko"`).
 * 급행(`(급행)`)은 ` Express` 접미 — ODsay 영문이 잃는 표지를 표가 되살린다.
 * 미지 키는 프로세스당 1회 계측한다(설계 리뷰 #10·#17 — 조용한 한국어 강등을 로그로 남긴다).
 */
export function subwayLineNameEn(ko: string | undefined | null): string | null {
  if (!ko) return null;
  const { key, express } = subwayLineKey(ko);
  const en = LINE_EN[key];
  if (!en) {
    if (key && !warned.has(key)) {
      warned.add(key);
      console.warn(`[subway-line-names] 미지 노선명: ${ko}`);
    }
    return null;
  }
  return express ? `${en} Express` : en;
}

/** 배열형 투영 — 하나라도 미지면 **전체 부재**(한 줄 안 언어 혼합 금지, §3.3). */
export function subwayLineNamesEn(ko: string[]): string[] | undefined {
  const out: string[] = [];
  for (const name of ko) {
    const en = subwayLineNameEn(name);
    if (!en) return undefined;
    out.push(en);
  }
  return out;
}
