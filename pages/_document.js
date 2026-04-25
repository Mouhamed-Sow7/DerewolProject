import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="fr">
      <Head>
        {/* Security Meta Tags for Secure Printing SaaS */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://docs.google.com https://docs.googleusercontent.com https://www.gstatic.com https://ssl.gstatic.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://docs.google.com https://docs.googleusercontent.com https://www.gstatic.com https://ssl.gstatic.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com https://docs.google.com https://docs.googleusercontent.com https://www.gstatic.com https://ssl.gstatic.com; img-src 'self' data: https: https://docs.googleusercontent.com; frame-src https://docs.google.com https://docs.googleusercontent.com blob:; connect-src 'self' https://*.supabase.co https://docs.google.com https://docs.googleusercontent.com https://www.gstatic.com https://ssl.gstatic.com; base-uri 'self';"
        />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta
          name="permissions-policy"
          content="accelerometer=(), gyroscope=(), magnetometer=(), payment=(), camera=(), microphone=()"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
