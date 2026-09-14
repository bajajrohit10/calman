import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { getViewer } from "@/lib/auth";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Calman",
  description: "Zeroinfy counselling CRM",
};

/**
 * §43.2. The palette is decided here, on the server, before a byte of HTML is
 * sent.
 *
 * Not in a client effect and not from localStorage: either of those paints the
 * wrong theme first and corrects it, which on a dark-by-default tool is a full
 * white flash on every navigation that misses the cache. getViewer() is
 * wrapped in React's cache(), so the app layout's own call to it costs
 * nothing extra, and the login page — where there is no profile — gets the
 * default like everybody else.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { profile } = await getViewer();
  const theme = profile?.theme === "light" ? "light" : "dark";

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-[13px] leading-normal">{children}</body>
    </html>
  );
}
