// 게이트 0 실측 전용 임시 페이지다. 프로덕션 노출용이 아니며 판정 후 삭제하거나 접근을 가린다.
import { setRequestLocale } from "next-intl/server";
import { WebMcpProbe } from "./WebMcpProbe";

export default async function WebMcpProbePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <WebMcpProbe />;
}
