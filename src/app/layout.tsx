import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Local Workbench — AI Document Editor",
  description:
    "Browser-based, workspace-aware document editor with pluggable preview engine and AI assistant. Edit Markdown, JSON, YAML, TOML, XML, Mermaid and TOON with live previews, diagnostics, and AI actions.",
  keywords: [
    "document editor",
    "workbench",
    "Monaco",
    "Markdown",
    "JSON",
    "YAML",
    "TOML",
    "Mermaid",
    "XML",
    "TOON",
    "AI assistant",
    "Next.js",
  ],
  authors: [{ name: "Local Workbench" }],
  openGraph: {
    title: "Local Workbench — AI Document Editor",
    description:
      "Browser-based, workspace-aware document editor with pluggable preview engine and AI assistant.",
    siteName: "Local Workbench",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Local Workbench",
    description:
      "Browser-based document editor with live previews and AI actions.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('workbench-theme') || 'dark';
                  document.documentElement.classList.toggle('dark', theme === 'dark');
                  document.documentElement.style.colorScheme = theme;
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
