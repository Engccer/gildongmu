"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const t = useTranslations("search");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex gap-2"
      role="search"
    >
      <label htmlFor="place-query" className="sr-only">
        {t("label")}
      </label>
      <input
        id="place-query"
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("placeholder")}
        autoComplete="off"
        className="min-h-12 flex-1 rounded-md border border-border bg-background px-4 text-lg"
      />
      <button
        type="submit"
        aria-disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-5 text-lg font-semibold text-accent-foreground aria-disabled:opacity-50"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
        {t("button")}
      </button>
    </form>
  );
}
