import type { Metadata, Viewport } from "next";
import "advanced-texteditor-md/style.css";
import "./globals.css";
import { Analytics } from "@/components/analytics";
import { Footer } from "@/components/footer";
import { TopNav } from "@/components/topnav";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: a WYSIWYG editor that stores Markdown`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  alternates: { canonical: SITE.url },
  icons: { icon: `${SITE.basePath}/favicon.svg` },
  openGraph: { title: SITE.name, description: SITE.description, type: "website", url: SITE.url },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b0f17" }, { media: "(prefers-color-scheme: light)", color: "#f5f8fd" }] };

// Set the theme before first paint so there is no flash: the stored choice, else the OS, else dark (the house default).
const THEME_INIT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(SITE.themeKey)})}catch(e){}if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-atm-theme",t)})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The attributes are set by the script before hydration, so React must not warn about them.
    <html lang="en" data-theme="dark" data-atm-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to the content
        </a>
        <TopNav />
        <main id="main">{children}</main>
        <Footer related={{ label: "React bindings", href: "https://faraasat.github.io/react-advanced-texteditor-md/" }} />
        <Analytics />
      </body>
    </html>
  );
}
