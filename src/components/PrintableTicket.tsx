import React, { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Invoice, StoreSettings } from '../types';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { barcodeSvg } from '../lib/barcode';

interface Props {
  invoice: Invoice;
  ownerId?: string;
}

// Code-barres Code128 généré localement en SVG (aucune API externe),
// étiré pour occuper la largeur de l'étiquette.
const TicketBarcode = ({ value }: { value: string }) => {
  const svg = barcodeSvg(value, { height: 40, moduleWidth: 1, margin: 0 })
    .replace(/width="[^"]*" height="[^"]*"/, 'width="100%" height="100%" preserveAspectRatio="none"');
  return (
    <div
      style={{ width: '36mm', height: '8mm', marginBottom: '0.5px' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export const PrintableTicket = forwardRef<HTMLDivElement, Props>(({ invoice, ownerId }, ref) => {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  // Codes-barres retrouvés depuis la fiche produit (anciennes ventes sans code-barres enregistré)
  const [fallbackBarcodes, setFallbackBarcodes] = useState<Record<string, string>>({});

  useEffect(() => {
    const finalOwnerId = ownerId || invoice.ownerId || 'store';
    const unsubscribe = onSnapshot(doc(db, 'settings', finalOwnerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    });
    return unsubscribe;
  }, [ownerId, invoice.ownerId]);

  useEffect(() => {
    let cancelled = false;
    const missing = (invoice.items || [])
      .slice(0, 1)
      .filter(item => !item.barcode && item.productId);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async item => {
        try {
          const snap = await getDoc(doc(db, 'products', item.productId));
          const code = snap.exists() ? (snap.data() as any).barcode : '';
          return [item.productId, code || ''] as const;
        } catch {
          return [item.productId, ''] as const;
        }
      })
    ).then(entries => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      entries.forEach(([id, code]) => { if (code) map[id] = code; });
      setFallbackBarcodes(map);
    });
    return () => { cancelled = true; };
  }, [invoice]);

  let dateStr = '';
  try {
    if (invoice.date && typeof invoice.date.toDate === 'function') {
      dateStr = format(invoice.date.toDate(), 'dd/MM/yyyy HH:mm');
    } else if (invoice.date instanceof Date) {
      dateStr = format(invoice.date, 'dd/MM/yyyy HH:mm');
    } else if (typeof invoice.date === 'string') {
      dateStr = format(new Date(invoice.date), 'dd/MM/yyyy HH:mm');
    } else {
      dateStr = format(new Date(), 'dd/MM/yyyy HH:mm');
    }
  } catch (e) {
    dateStr = format(new Date(), 'dd/MM/yyyy HH:mm');
  }

  const currency = storeSettings?.currency || 'DT';

  return (
    <div ref={ref} style={{ 
      width: '40mm',
      height: '30mm',
      margin: 0,
      padding: '1.5px',
      boxSizing: 'border-box',
      overflow: 'hidden',
      backgroundColor: 'white',
      color: 'black',
      fontFamily: 'monospace',
      fontSize: '7.5px',
      lineHeight: '1'
    }}>
      <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '10px', marginBottom: '1px' }}>SmarTech</div>
      <div style={{ textAlign: 'center', fontSize: '7px', marginBottom: '1px' }}>{dateStr}</div>
      
      <div style={{ borderTop: '1px solid black', margin: '1px 0' }}></div>
      
      {invoice.items.slice(0, 1).map((item, i) => {
        const code = item.barcode || fallbackBarcodes[item.productId] || '';
        return (
          <div key={i} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {code && <TicketBarcode value={code} />}
            <div style={{ textAlign: 'center', fontSize: '8px', fontWeight: 'bold', marginBottom: '0.5px' }}>{item.name.substring(0, 18)}</div>
            {item.reference && <div style={{ textAlign: 'center', fontSize: '7px', marginBottom: '0.5px' }}>Réf: {item.reference}</div>}
            <div style={{ textAlign: 'center', fontSize: '8px', fontWeight: 'bold' }}>{item.total.toFixed(3)} {currency}</div>
          </div>
        );
      })}
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';
