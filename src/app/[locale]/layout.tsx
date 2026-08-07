import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SITE_ORIGIN } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";
import { Header } from "@/components/Header";
import { SWRegister } from "@/components/SWRegister";
import { IdleReset } from "@/components/IdleReset";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// PWA 테마 색상(accent=#1d4ed8) — 상태바·주소창 채색.
export const viewport: Viewport = { themeColor: "#1d4ed8" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return {
    // 상대 canonical·OG URL을 대외 정본 도메인으로 절대화한다.
    metadataBase: new URL(SITE_ORIGIN),
    title: t("title"),
    description: t("tagline"),
    appleWebApp: { capable: true, title: "길동무", statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <Header />
          <main className="mx-auto max-w-2xl px-4 py-6">
            {children}
          </main>
          <SWRegister />
          <IdleReset locale={locale} />
        </NextIntlClientProvider>
        {/* 웹 방문 통계(익명·무쿠키). 시각 요소가 없어 접근성 트리에 영향이 없다. */}
        <Analytics />
      </body>
    </html>
  );
}
