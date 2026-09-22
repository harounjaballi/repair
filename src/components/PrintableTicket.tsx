import React, { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Invoice, StoreSettings } from '../types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface Props {
  invoice: Invoice;
  ownerId?: string;
}

export const PrintableTicket = forwardRef<HTMLDivElement, Props>(({ invoice, ownerId }, ref) => {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    const finalOwnerId = ownerId || invoice.ownerId || 'store';
    const unsubscribe = onSnapshot(doc(db, 'settings', finalOwnerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    });
    return unsubscribe;
  }, [ownerId, invoice.ownerId]);

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

  const storeName = storeSettings?.storeName || 'MARKET-POS';
  const storeAddress = storeSettings?.address || 'Atelier de réparation';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';

  return (
    <div ref={ref} className="bg-white text-black font-mono" style={{ 
      width: '40mm', 
      height: '30mm', 
      margin: '0 auto', 
      padding: '4px',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start'
    }}>
      {/* Titre SmarTech */}
      <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', letterSpacing: '0.5px', marginBottom: '2px', textTransform: 'uppercase', flexShrink: 0 }}>
        SmarTech
      </div>
      <div style={{ borderTop: '1px dashed black', margin: '2px 0', flexShrink: 0 }}></div>
      
      {/* Date et heure */}
      <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: '600', marginBottom: '2px', flexShrink: 0 }}>
        {dateStr}
      </div>
      
      {/* Code à barre et infos produit pour chaque article */}
      <div style={{ borderTop: '1px dashed black', margin: '2px 0', flexShrink: 0 }}></div>
      <div style={{ marginTop: '2px', marginBottom: '2px', overflow: 'hidden', flexShrink: 0 }}>
        {invoice.items.map((item, index) => (
          <div key={index} style={{ borderBottom: '1px dashed #ccc', paddingBottom: '1px', marginBottom: '1px', overflow: 'hidden' }}>
            {/* Code à barre si disponible */}
            {item.barcode && (
              <div style={{ textAlign: 'center', margin: '1px 0', fontSize: '8px', fontWeight: 'bold', wordBreak: 'break-all', letterSpacing: '0.5px', overflow: 'hidden' }}>
                {item.barcode}
              </div>
            )}
            
            {/* Nom de l'article */}
            <div style={{ fontWeight: 'bold', fontSize: '9px', textAlign: 'center', marginBottom: '1px', wordBreak: 'break-word', lineHeight: '1.1', overflow: 'hidden' }}>
              {item.name}
            </div>
            
            {/* Référence si disponible */}
            {item.reference && (
              <div style={{ textAlign: 'center', fontSize: '7px', color: '#444', marginBottom: '1px', fontWeight: '600', overflow: 'hidden' }}>
                Réf: {item.reference}
              </div>
            )}
            
            {/* Quantité et prix */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', fontWeight: '600', overflow: 'hidden' }}>
              <span>{item.quantity}x {item.price.toFixed(3)}</span>
              <span>{item.total.toFixed(3)} {currency}</span>
            </div>
          </div>
        ))}
      </div>
      
      <div style={{ borderTop: '1px dashed black', margin: '2px 0', flexShrink: 0 }}></div>
      
      {/* Infos facture */}
      <div style={{ textAlign: 'center', fontSize: '7px', marginBottom: '2px', flexShrink: 0 }}>
        <div style={{ fontWeight: '600', marginBottom: '1px' }}>Ticket: {invoice.number}</div>
        <div style={{ fontWeight: '600', fontSize: '7px', wordBreak: 'break-word' }}>{invoice.clientName}</div>
      </div>
      
      <div style={{ borderTop: '1px dashed black', margin: '2px 0', flexShrink: 0 }}></div>
      
      {/* Total et paiement */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '9px', marginBottom: '1px', flexShrink: 0 }}>
        <span>TOTAL</span>
        <span>{invoice.total.toFixed(3)} {currency}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginBottom: '1px', flexShrink: 0 }}>
        <span>Payé</span>
        <span>{invoice.paid.toFixed(3)}</span>
      </div>
      {invoice.debt > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#d32f2f', fontWeight: 'bold', flexShrink: 0 }}>
          <span>Reste</span>
          <span>{invoice.debt.toFixed(3)}</span>
        </div>
      )}
      
      <div style={{ borderTop: '1px dashed black', margin: '2px 0', flexShrink: 0 }}></div>
      
      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '1px', fontSize: '7px', flexShrink: 0 }}>
        Merci !
      </div>
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';

// Style d'impression global
const printStyles = `
  @media print {
    * {
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 80mm !important;
      height: 30mm !important;
    }
    .print-container {
      width: 80mm !important;
      height: 30mm !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    [ref] {
      width: 80mm !important;
      height: 30mm !important;
      margin: 0 !important;
      padding: 0 !important;
      page-break-after: avoid !important;
      page-break-inside: avoid !important;
      page-break-before: avoid !important;
      overflow: hidden !important;
    }
  }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.getElementById('print-styles') || document.createElement('style');
  styleEl.id = 'print-styles';
  styleEl.textContent = printStyles;
  if (!document.head.querySelector('#print-styles')) {
    document.head.appendChild(styleEl);
  }
}
