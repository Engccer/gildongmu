import rawGuides from "./data/voice-guides.json";

/**
 * 서울교통공사 음성유도기 설치 위치 정적 seed(OA-22526 CSV → build-voice-guides.py).
 * 서버 전용 import(클라이언트 번들 제외, subway-stations 동형). 키는
 * normalizeStationName 결과와 동일 규칙으로 빌드 시 사전 계산돼 있다.
 */
const GUIDES = rawGuides as { asOf: string; entries: Array<{ key: string; line: string; location: string }> };

/** 출처 병기용 데이터 기준일(YYYY-MM): 오래된 시설 정보의 정직성 장치(스펙 §1-C). */
export const VOICE_GUIDES_AS_OF = GUIDES.asOf;

/** 정규화 역명 키 → 설치 위치 목록(원문 순서 보존). 미커버는 []. */
export function findVoiceGuides(nameKey: string): Array<{ line: string; location: string }> {
  if (!nameKey) return [];
  return GUIDES.entries
    .filter((e) => e.key === nameKey)
    .map(({ line, location }) => ({ line, location }));
}
