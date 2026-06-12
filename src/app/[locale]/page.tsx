import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { activeProviderName } from "@/lib/providers/places";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-lg opacity-80">{t("tagline")}</p>
      </header>
      <PlaceSearch isMockMode={activeProviderName() === "mock"} />
    </main>
  );
}
