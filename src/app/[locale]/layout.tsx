import type { Metadata } from "next";
import "../globals.css";
import { FC, Suspense, use } from "react";
import { Locale, localeConfig } from "@/localization/config";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { getDictionary } from "@/localization/dictionary";
import Sidebar from "@/components/shared/sidebar";
import FilterDrawer from "@/components/shared/filterDrawer";
import NextTopLoader from "nextjs-toploader";
import { notFound } from "next/navigation";
import LocaleSwitch from "@/components/shared/localeSwitch";
import SearchComponent from "@/components/shared/searchComponent";
import LangSetter from "@/components/shared/LangSetter";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { fetchEURtoRUBRate } from "@/lib/currency";
import { Toaster } from "sonner";

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>;

const RootLayout: FC<RootLayoutProps> = ({ children, params }) => {
  const locale = use(params).locale as Locale;
  const dictionary = use(getDictionary(locale));
  const eurToRubRate = use(fetchEURtoRUBRate());

  if (!localeConfig.locales.includes(locale)) {
    return notFound();
  }

  return (
    <LocaleProvider dictionary={dictionary}>
      <CurrencyProvider eurToRubRate={eurToRubRate}>
        <LangSetter locale={locale} />
        {children}
        <Sidebar locale={locale} />
        <Suspense fallback={null}>
          <FilterDrawer />
        </Suspense>
        <LocaleSwitch locale={locale} />
        <SearchComponent locale={locale}/>
        <NextTopLoader color="#3563E9" height={4} showSpinner={false} />
        <Toaster position="top-right" richColors />
      </CurrencyProvider>
    </LocaleProvider>
  );
};

export default RootLayout;

export const generateStaticParams = async () => {
  const locales = localeConfig.locales;
  return locales.map((locale) => ({ locale }));
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const dictionary = await getDictionary(locale);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://koenigcarpet.ru";

  return {
    title: {
      default: dictionary.meta.title,
      template: `%s | Koenig Carpet`,
    },
    description: dictionary.meta.description,
    keywords: dictionary.meta.keywords,
    icons: {
      icon: "/favicon.ico",
    },
    openGraph: {
      title: dictionary.meta.openGraph.title,
      description: dictionary.meta.openGraph.description,
      url: `${baseUrl}/${locale}`,
      siteName: "Koenig Carpet",
      images: [
        {
          url: dictionary.meta.openGraph.image,
          width: 1200,
          height: 630,
          alt: "Koenig Carpet",
        },
      ],
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dictionary.meta.twitter.title,
      description: dictionary.meta.twitter.description,
      images: [dictionary.meta.twitter.image],
    },
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        en: `${baseUrl}/en`,
        ru: `${baseUrl}/ru`,
      },
    },
  };
}
