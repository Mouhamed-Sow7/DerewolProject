/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,

  // NOTE: For static export, HTTP headers are not available.
  // Security is handled via:
  // 1. Meta tags in _document.js (CSP, viewport, etc.)
  // 2. Client-side JavaScript protections in pages/p/index.js
  // 3. CSS protections in styles/globals.css
  // 4. iframe sandbox attributes on preview iframes
  //
  // For production deployment, add these headers via your web server:
  // - X-Frame-Options: DENY
  // - Content-Security-Policy: (see _document.js)
  // - X-Content-Type-Options: nosniff
  // - X-XSS-Protection: 1; mode=block
  // - Referrer-Policy: strict-origin-when-cross-origin
  // - Permissions-Policy: (see next.config.js comments)

  // Routes dynamiques /p/[slug] et /p/[slug]/upload etc.
  // Nécessaire pour static export avec pages dynamiques
  // Les slugs sont générés au runtime côté client
  // => pas besoin de generateStaticParams ici car on utilise
  //    le router.query côté client uniquement

  // Désactive l'optimisation d'images (incompatible avec static export)
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
