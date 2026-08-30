import { getTranslations, setRequestLocale } from "next-intl/server";

// 개인정보 처리방침 — ASC 처리방침 URL 겸 지원 URL(스펙 §3). 내용은 매니페스트·영양
// 라벨과 3자 일치가 불변식이라, 수집 항목을 바꾸면 이 페이지도 함께 갱신해야 한다.
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  return (
    <>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-2">{t("intro")}</p>
      <h3 className="mt-6 text-lg font-semibold">{t("useHeading")}</h3>
      <p className="mt-2">{t("location")}</p>
      <p className="mt-2">{t("chat")}</p>
      <p className="mt-2">{t("search")}</p>
      <p className="mt-2">{t("dictation")}</p>
      <p className="mt-2">{t("activity")}</p>
      <p className="mt-2">{t("placeHours")}</p>
      <p className="mt-2">{t("agent")}</p>
      <p className="mt-2">{t("analytics")}</p>
      <h3 className="mt-6 text-lg font-semibold">{t("contactHeading")}</h3>
      <p className="mt-2">{t("contact")}</p>
    </>
  );
}
