import { z } from "zod";

/**
 * 좌표 쿼리 파라미터 스키마.
 *
 * ⚠ **`z.coerce.number()`에 곧바로 태우지 말 것.** 빈 문자열·null은
 * `Number("") === 0`이라 조용히 (0, 0)이 되고, 그 좌표는 한국 밖이라
 * 응답이 `outOfCoverage`가 된다 — 즉 **파라미터 누락이 "서비스 지역 밖"이라는
 * 엉뚱한 답으로 위장**한다. 정상 클라이언트는 좌표를 항상 보내므로 화면에서는
 * 안 드러나고 CLI/MCP 소비자에게만 보이는 정합 결함이다.
 *
 * 문자열 존재를 먼저 요구해 400으로 가른다. 같은 함정이 라우트 14곳에
 * 남아 있다(백로그 D3) — 새 좌표 라우트는 반드시 이 헬퍼를 쓴다.
 */
export const coordParam = (min: number, max: number) =>
  z.string().trim().min(1).transform(Number).pipe(z.number().min(min).max(max));

/** 위도(-90~90). */
export const latParam = () => coordParam(-90, 90);

/** 경도(-180~180). */
export const lngParam = () => coordParam(-180, 180);
