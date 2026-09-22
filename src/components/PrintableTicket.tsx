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
    <div ref={ref} className="p-2 w-[40mm] mx-auto bg-white text-black font-mono text-[9px] leading-tight">
      {/* Titre SmarTech */}
      <div className="text-center font-bold text-[14px] uppercase tracking-wider mb-1">SmarTech</div>
      <div className="border-t border-dashed border-black my-1"></div>
      
      {/* Date et heure */}
      <div className="text-center text-[8px] font-semibold">{dateStr}</div>
      
      {/* Code à barre et infos produit pour chaque article */}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="my-2 space-y-2">
        {invoice.items.map((item, index) => (
          <div key={index} className="border-b border-dashed border-gray-300 pb-1">
            {/* Code à barre si disponible */}
            {item.barcode && (
              <div className="text-center my-0.5">
                <div className="font-bold text-[8px] tracking-widest break-all">{item.barcode}</div>
              </div>
            )}
            
            {/* Nom de l'article */}
            <div className="font-bold text-[9px] text-center break-words mb-0.5">
              {item.name}
            </div>
            
            {/* Référence si disponible */}
            {item.reference && (
              <div className="text-center text-[7px] text-gray-700 mb-0.5 font-semibold">
                Réf: {item.reference}
              </div>
            )}
            
            {/* Quantité et prix */}
            <div className="flex justify-between text-[8px] font-semibold">
              <span>{item.quantity}x {item.price.toFixed(3)}</span>
              <span>{item.total.toFixed(3)} {currency}</span>
            </div>
          </div>
        ))}
      </div>
      
      <div className="border-t border-dashed border-black my-1"></div>
      
      {/* Infos facture */}
      <div className="text-center text-[7px] mb-1 space-y-0.5">
        <div className="font-semibold">#{invoice.number}</div>
        <div className="font-semibold">{invoice.clientName}</div>
      </div>
      
      <div className="border-t border-dashed border-black my-1"></div>
      
      {/* Total et paiement */}
      <div className="flex justify-between font-bold text-[9px] mb-0.5">
        <span>TOTAL</span>
        <span>{invoice.total.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between text-[8px] mb-0.5">
        <span>Payé</span>
        <span className="font-semibold">{invoice.paid.toFixed(3)}</span>
      </div>
      {invoice.debt > 0 && (
        <div className="flex justify-between text-[8px] text-red-600 font-bold">
          <span>Reste</span>
          <span>{invoice.debt.toFixed(3)}</span>
        </div>
      )}
      
      <div className="border-t border-dashed border-black my-1"></div>
      
      {/* Footer */}
      <div className="text-center mt-1 text-[7px] leading-tight">
        Merci !
      </div>
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';
