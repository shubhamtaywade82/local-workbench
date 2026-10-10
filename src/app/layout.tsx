import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
  description: "Browser-based, workspace-aware document editor with pluggable preview engine and AI assistant. Edit Markdown, JSON, YAML, TOML, XML, Mermaid and TOON with live previews, diagnostics, and AI actions.",
  keywords: ["document editor", "workbench", "Monaco", "Markdown", "JSON", "YAML", "TOML", "Mermaid", "XML", "TOON", "AI assistant", "Next.js"],
  authors: [{ name: "Local Workbench" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Local Workbench — AI Document Editor",
    description: "Browser-based, workspace-aware document editor with pluggable preview engine and AI assistant.",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Local Workbench",
    description: "Browser-based document editor with live previews and AI actions.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
