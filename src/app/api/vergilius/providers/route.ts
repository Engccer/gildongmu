// GET /api/vergilius/providers — 베르길리우스 「말로 묻기」가 고를 수 있는 답변 모델 회사(E82 spec V23·§4).
// 서버에 키가 있는 회사만 싣는다. 앱 설정의 「답변 모델」 선택지가 이 목록으로 정해진다.
import { connection } from "next/server";
import { availableVergiliusProviders } from "@/lib/vergilius/providers";

export async function GET() {
  // 요청 시점의 키 상태로 답한다. 이 한 줄이 없으면 요청을 읽지 않는 GET이라 빌드 때 한 번 구워져, 빌드 환경의 키 유무가 목록으로 굳는다.
  await connection();
  return Response.json(
    { providers: availableVergiliusProviders() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
