// hooks/usePrinter.js
import { useState, useEffect } from 'react';
import { getPrinterBySlug } from '../lib/supabase';

// Résout un slug → { id, slug, name } depuis Supabase
// Retourne { printer, loading, notFound }

export default function usePrinter(slug) {
  const [printer, setPrinter]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;

    getPrinterBySlug(slug).then(data => {
      if (!data) {
        setNotFound(true);
      } else {
        setPrinter(data);
      }
      setLoading(false);
    });
  }, [slug]);

  return { printer, loading, notFound };
}