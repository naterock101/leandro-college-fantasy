export const metadata = {
  title: "Austin College Football Fantasy League",
  description: "College football squad league standings",
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
