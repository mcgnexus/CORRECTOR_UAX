import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Correctora UAX",
  description: "Corrección rápida de exámenes tipo test desde el móvil.",
  manifest: "/manifest.webmanifest",
  applicationName: "Correctora UAX",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d3557",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
        {children}
      </body>
    </html>
  );
}
