import type { Metadata } from "next";
import { Archivo, Cutive_Mono, IBM_Plex_Mono, Nunito, Special_Elite } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

// The field-input screen's look: a monospaced body face and a heavy, wide display face for headings.
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["600", "700", "800"] });

// Sign-in screen: a typewriter wordmark and a light monospaced body.
const specialElite = Special_Elite({ variable: "--font-wordmark", subsets: ["latin"], weight: "400" });
const cutiveMono = Cutive_Mono({ variable: "--font-cutive", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Daiisi",
  description: "Satellite + weather field monitoring for small farms",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${plexMono.variable} ${archivo.variable} ${specialElite.variable} ${cutiveMono.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
