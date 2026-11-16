import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flight Instructor Tools · Photo review",
  description: "Local review workspace for handwritten flight-school records.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
