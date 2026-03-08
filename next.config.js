/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,

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