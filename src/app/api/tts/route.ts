import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkTtsRateLimit } from "@/lib/rate-limit";
import { synthesizeChirpMp3 } from "@/lib/tts/chirp";

/**
 * POST /api/tts — 채팅 응답 '듣기' 버튼용 음성 합성(dodo-planet 이식, full 모드만).
 * 받은 텍스트를 Google Cloud TTS Chirp 3 HD(Puck)로 변환해 MP3 바이트를 반환한다.
 *
 * dodo와의 차이: mode=summary(요약 자동 듣기)는 gildongmu에 해당 기능이 없어 이식하지
 * 않았고, 인증(requireAuth) 대신 IP 레이트 리밋으로 비용을 방어한다(무인증 공개 앱).
 *
 * 실패(키 미설정·합성 오류·레이트 초과)는 모두 502 { fallback: true } — 클라이언트가
 * 온디바이스 낭독(AVSpeechSynthesizer)으로 폴백하므로 어떤 실패에도 UX는 끊기지 않는다.
 */

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(8000),
  locale: z.enum(["ko", "en", "es", "fr", "it"]),
});

function fallbackResponse(reason: string) {
  return NextResponse.json({ fallback: true, reason }, { status: 502 });
}

/** Vercel은 클라이언트 IP를 x-forwarded-for(첫 항목)·x-real-ip로 전달한다. */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  try {
    if (!checkTtsRateLimit(clientIp(request), Date.now())) {
      return fallbackResponse("rate_limited");
    }

    const parsed = ttsRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "잘못된 요청입니다" }, { status: 400 });
    }
    const { text, locale } = parsed.data;

    try {
      const mp3 = await synthesizeChirpMp3(text, locale);
      return new Response(Buffer.from(mp3), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      console.error("Chirp TTS failed:", error);
      return fallbackResponse("tts_failed");
    }
  } catch (error) {
    console.error("TTS API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
