// Shared cache for PDF pages
const cache = {};

module.exports = {
  get: (fileId) => cache[fileId] || null,
  set: (fileId, pages) => {
    cache[fileId] = pages;
    console.log(`[CACHE] Set ${fileId} -> ${pages} pages`);
  },
  getAll: () => cache,
  clear: () => {
    Object.keys(cache).forEach((key) => delete cache[key]);
    console.log(`[CACHE] Cleared`);
  },
};
