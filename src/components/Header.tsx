import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./LanguageSwitcher";

/**
 * 사이트 헤더 — 제목 + 언어 전환기. 제목은 로케일 메시지에서 오므로
 * /ko·/en에서 각각 단일 언어로만 표시된다(한/영 혼용 제거).
 */
export async function Header() {
  const t = await getTranslations("app");
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div>
          <p className="text-lg font-bold">{t("title")}</p>
          <p className="text-xs text-muted">{t("tagline")}</p>
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
