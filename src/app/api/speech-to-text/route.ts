import { NextRequest, NextResponse } from "next/server";
import { buildDeepgramParams, parseDeepgramTranscript } from "@/lib/deepgram";
import { validateSttInput } from "@/lib/stt-validate";
import { checkSttRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { env, hasDeepgramKey } from "@/lib/env";

/**
 * 음성 받아쓰기 프록시 — 클라이언트가 녹음한 오디오 Blob을 Deepgram
 * Nova-2로 보내 전사한다. DEEPGRAM_API_KEY는 서버에만 존재.
 * (dodo-planet에서 수입, gildongmu 파서/스타일로 적응)
 */

const VALIDATION_ERROR: Record<string, string> = {
  missing: "오디오가 필요합니다.",
  empty: "빈 오디오입니다.",
  too_large: "오디오가 너무 큽니다. (최대 5MB)",
  bad_type: "오디오 형식이 올바르지 않습니다.",
};

export async function POST(request: NextRequest) {
  // 유료 Deepgram 비용 방어 — formData 파싱(메모리 적재) 전에 차단한다.
  if (!checkSttRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json(
      { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const audio = formData.get("audio");

  // 서버 경계 입력 검증(빈 blob·비-audio MIME·임의 locale 방어).
  const validation = validateSttInput(audio, formData.get("locale"));
  if (!validation.ok) {
    return NextResponse.json(
      { error: VALIDATION_ERROR[validation.reason] ?? "잘못된 요청입니다." },
      { status: 400 },
    );
  }
  const locale = validation.locale;
  // validateSttInput가 ok면 audio는 Blob임이 보장된다.
  const audioBlob = audio as Blob;

  if (!hasDeepgramKey()) {
    console.error("[stt] DEEPGRAM_API_KEY 미설정");
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }
  const apiKey = env.DEEPGRAM_API_KEY;

  // 자동감지 대신 로케일 명시(detect_language의 ko→vi 오인식 결함 차단, deepgram.ts 주석).
  const params = buildDeepgramParams(locale);

  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audioBlob.type || "audio/webm",
      },
      body: await audioBlob.arrayBuffer(),
    });
    if (!res.ok) {
      console.error("[stt] Deepgram 오류:", res.status);
      return NextResponse.json(
        { error: "음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    const transcript = parseDeepgramTranscript(await res.json(), locale);
    if (!transcript) {
      return NextResponse.json(
        { error: "음성을 인식하지 못했습니다. 다시 말씀해 주세요." },
        { status: 422 },
      );
    }
    return NextResponse.json(transcript);
  } catch (e) {
    console.error("[stt] 처리 실패:", e);
    return NextResponse.json(
      { error: "음성 인식 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
