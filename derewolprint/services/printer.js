const pdfToPrinter = require('pdf-to-printer');

async function getAvailablePrinters() {
  return await pdfToPrinter.getPrinters();
}

async function getDefaultPrinter() {
  const printers = await getAvailablePrinters();
  return printers[0] || null;
}

module.exports = { getAvailablePrinters, getDefaultPrinter };