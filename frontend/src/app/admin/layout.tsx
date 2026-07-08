import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./glacier.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Docolab — Admin",
  description: "System Controller Access",
};

// The admin panel runs its own "Glacier" dark theme, scoped to `.glacier` so it
// never touches the main app's light design system. This nested layout only
// provides the theme wrapper — the root layout still owns <html>/<body>.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`glacier ${inter.variable}`}>{children}</div>;
}
