// GET /api/chat/models — 실험판 「채팅 답변 모델」이 고를 수 있는 Gemini 밖 모델(E89 spec C11).
// 서버에 키가 있는 회사만 싣는다. 처음 값 Gemini는 목록에 없다(언제나 선택지). 앱 설정의 선택지가 이 목록으로 정해진다.
import { connection } from "next/server";
import { availableChatModels } from "@/lib/chat/chat-models";

export async function GET() {
  // 요청 시점의 키 상태로 답한다. 이 한 줄이 없으면 빌드 때 한 번 구워져 빌드 환경의 키 유무가 목록으로 굳는다.
  await connection();
  return Response.json({ models: availableChatModels() }, { headers: { "Cache-Control": "no-store" } });
}
