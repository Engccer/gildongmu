import { NextRequest, NextResponse } from "next/server";
import { parseDeepgramTranscript } from "@/lib/deepgram";

/**
 * 음성 받아쓰기 프록시 — 클라이언트가 녹음한 오디오 Blob을 Deepgram
 * Nova-2로 보내 전사한다. DEEPGRAM_API_KEY는 서버에만 존재.
 * (dodo-planet에서 수입, gildongmu 파서/스타일로 적응)
 */
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const audio = formData.get("audio");
  const locale = (formData.get("locale") as string | null) ?? "ko";

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "오디오가 필요합니다." }, { status: 400 });
  }
  if (audio.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "오디오가 너무 큽니다. (최대 25MB)" },
      { status: 400 },
    );
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error("[stt] DEEPGRAM_API_KEY 미설정");
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const params = new URLSearchParams({
    model: "nova-2-conversationalai",
    smart_format: "true",
    punctuate: "true",
    diarize: "false",
    detect_language: "true",
  });

  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "audio/webm",
      },
      body: await audio.arrayBuffer(),
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
