import type { Metadata, Viewport } from "next";
import "./globals.css";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { COLOR_MODE_COOKIE, isColorMode } from "@/lib/colorMode";

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
  const saved = (await cookies()).get(COLOR_MODE_COOKIE)?.value;
  // Light is the default; "system" (an explicit choice) follows the operating system.
  const initialColorMode = isColorMode(saved) ? saved : saved === "system" ? null : "light";

  return (
    <html lang="en" data-color-mode={initialColorMode ?? undefined} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Providers initialColorMode={initialColorMode}>{children}</Providers>
      </body>
    </html>
  );
}
