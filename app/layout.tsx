const TITLE = "Austin College Football Fantasy League";
const DESC =
  "Live standings for an 8-person college football squad league. Every win scores, " +
  "3 points for a power conference team and 2 for everyone else.";

export const metadata = {
  /* Absolute URLs are required for og:image, and static export has no request
     to infer the host from. */
  metadataBase: new URL("https://leandro-college-fantasy.vercel.app"),
  title: TITLE,
  description: DESC,
  openGraph: {
    title: TITLE,
    description: DESC,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/og.png"],
  },
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0D1520" />
      </head>
      <body>{children}</body>
    </html>
  );
}
