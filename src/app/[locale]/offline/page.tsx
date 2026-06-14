import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("offline");
  return (
    <section aria-label={t("heading")}>
      <h2 className="text-xl font-semibold">{t("heading")}</h2>
      <p className="mt-2">{t("body")}</p>
    </section>
  );
}
