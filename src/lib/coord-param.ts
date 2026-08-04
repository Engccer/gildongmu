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
export const coordParam = (min: number, max: number, label = "좌표") =>
  z
    .string()
    .trim()
    // 기본 메시지("Too small: expected string to have >=1 characters")는 그대로
    // CLI 출력에 실려, 이 가드가 겨냥한 소비자가 "좌표를 안 보냈다"가 아니라
    // "문자열이 짧다"를 읽게 된다(리뷰 검출).
    .min(1, `${label}가 필요합니다`)
    // .transform(Number)를 그대로 .pipe(z.number())에 태우면 비수치 입력이
    // NaN이 되어 zod 기본 영문 메시지("Invalid input: expected number, received
    // NaN")로 빠진다. 라벨이 사라져 이 가드가 겨냥한 CLI/MCP 소비자가 다시
    // 원인을 못 읽는다(dodo 3차 이식 중 실측, 역이식 2026-08-05).
    .transform((val, ctx) => {
      const n = Number(val);
      // isNaN이 아니라 isFinite: "Infinity"·"1e400"도 NaN과 같은 경로로 잡아야
      // z.number()의 라벨 없는 기본 메시지로 새지 않는다(리뷰 검출).
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `${label} 형식이 올바르지 않습니다` });
        return z.NEVER;
      }
      return n;
    })
    .pipe(
      z
        .number()
        .min(min, `${label}가 범위를 벗어났습니다`)
        .max(max, `${label}가 범위를 벗어났습니다`),
    );

/** 위도(-90~90). */
export const latParam = () => coordParam(-90, 90, "위도(lat)");

/** 경도(-180~180). */
export const lngParam = () => coordParam(-180, 180, "경도(lng)");
