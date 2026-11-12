import type { Metadata, Viewport } from "next";
import "./globals.css";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { Providers } from "@/components/providers";
import { COLOR_MODE_COOKIE, isColorMode } from "@/lib/colorMode";
import { ObservabilityLoader } from "@/components/observability/ObservabilityLoader";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/observability/consent";
import { workspaceSlugFromPath } from "@/lib/observability/routes";
import { loadObservabilityConfig } from "@/lib/views/components";

export const metadata: Metadata = {
  title: { default: "Space Works Workspace", template: "%s · Space Works" },
  description: "The private workspace for the Space Works maker community.",
  applicationName: "Space Works Workspace",
  appleWebApp: { capable: true, title: "Space Works", statusBarStyle: "default" },
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3100"),
  robots: { index: false, follow: false },
};

// Browser chrome matches the canvas: Warm Cream in light mode, Deep Ink in dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF4E8" },
    { media: "(prefers-color-scheme: dark)", color: "#142C2A" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // proxy.ts injects a per-request CSP nonce; waiting for the request lets
  // Next.js attach it to every framework script.
  await connection();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const saved = cookieStore.get(COLOR_MODE_COOKIE)?.value;
  const path = requestHeaders.get("x-sw-path");
  const obsConfig = await loadObservabilityConfig({ params: { workspaceSlug: (path && workspaceSlugFromPath(path)) || "" } }).catch(() => null);
  const observability = obsConfig ? { ...obsConfig, nonce: requestHeaders.get("x-nonce") ?? "", consent: parseConsentCookie(cookieStore.get(CONSENT_COOKIE)?.value) } : null;
  // Light is the default; "system" (an explicit choice) follows the operating system.
  const initialColorMode = isColorMode(saved) ? saved : saved === "system" ? null : "light";

  return (
    <html lang="en" data-color-mode={initialColorMode ?? undefined} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col" data-clarity-mask="True">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Providers initialColorMode={initialColorMode}>{children}</Providers>
        {observability ? <ObservabilityLoader {...observability} /> : null}
      </body>
    </html>
  );
}
