import React, { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Repair, StoreSettings, REPAIR_STATUS_LABELS } from '../types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Barcode } from './Barcode';

interface Props {
  repair: Repair;
  ownerId?: string;
}

// Bon de dépôt / de réparation — format ticket 80mm, imprimable via le
// même mécanisme .print-container que le ticket de caisse.
export const RepairTicket = forwardRef<HTMLDivElement, Props>(({ repair, ownerId }, ref) => {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    const finalOwnerId = ownerId || repair.ownerId || 'store';
    const unsub = onSnapshot(doc(db, 'settings', finalOwnerId), (snap) => {
      if (snap.exists()) setStoreSettings(snap.data() as StoreSettings);
    });
    return unsub;
  }, [ownerId, repair.ownerId]);

  let dateStr = '';
  try {
    if (repair.date && typeof repair.date.toDate === 'function') {
      dateStr = format(repair.date.toDate(), 'dd/MM/yyyy HH:mm');
    } else {
      dateStr = format(new Date(), 'dd/MM/yyyy HH:mm');
    }
  } catch { dateStr = format(new Date(), 'dd/MM/yyyy HH:mm'); }

  const storeName = storeSettings?.storeName || 'SmarTech Repair';
  const storeAddress = storeSettings?.address || 'Atelier de réparation';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';

  const line = <div className="border-t border-dashed border-black my-1" />;

  return (
    <div ref={ref} className="p-5 w-[80mm] mx-auto bg-white text-black font-mono text-[10px] leading-tight">
      <div className="text-center font-bold text-[13px] uppercase">{storeName}</div>
      <div className="text-center">{storeAddress}</div>
      {storePhone && <div className="text-center">Tél: {storePhone}</div>}
      {line}
      <div className="text-center font-bold text-[11px]">BON DE DÉPÔT / RÉPARATION</div>
      {line}
      <div className="flex justify-between"><span>N°</span><span className="font-bold">{repair.number}</span></div>
      {repair.number && (
        <div className="flex justify-center my-1">
          <Barcode value={repair.number} height={38} moduleWidth={1.4} />
        </div>
      )}
      <div className="flex justify-between"><span>Date dépôt</span><span>{dateStr}</span></div>
      <div className="flex justify-between"><span>Statut</span><span>{REPAIR_STATUS_LABELS[repair.status]}</span></div>
      {line}
      <div className="font-bold">CLIENT</div>
      <div>{repair.clientName || '—'}</div>
      {repair.clientPhone && <div>Tél: {repair.clientPhone}</div>}
      {line}
      <div className="font-bold">APPAREIL</div>
      <div>{[repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ') || '—'}</div>
      {repair.imei && <div>IMEI/SN: {repair.imei}</div>}
      {repair.accessories && <div>Access.: {repair.accessories}</div>}
      {repair.deviceCondition && <div>État: {repair.deviceCondition}</div>}
      {line}
      <div className="font-bold">PANNE SIGNALÉE</div>
      <div className="whitespace-pre-wrap break-words">{repair.problem}</div>
      {repair.diagnostic && (
        <>
          <div className="font-bold mt-1">DIAGNOSTIC</div>
          <div className="whitespace-pre-wrap break-words">{repair.diagnostic}</div>
        </>
      )}
      {line}
      {repair.parts?.length > 0 && (
        <>
          <div className="font-bold">PIÈCES</div>
          {repair.parts.map((p, i) => (
            <div key={i} className="flex justify-between">
              <span className="max-w-[45mm] overflow-hidden text-ellipsis whitespace-nowrap">{p.name} x{p.quantity}</span>
              <span>{p.total.toFixed(2)}</span>
            </div>
          ))}
          {line}
        </>
      )}
      {(repair.laborCost || 0) > 0 && (
        <div className="flex justify-between"><span>Main d'œuvre</span><span>{(repair.laborCost || 0).toFixed(2)} {currency}</span></div>
      )}
      {(repair.estimatedCost || 0) > 0 && (
        <div className="flex justify-between"><span>Devis estimé</span><span>{(repair.estimatedCost || 0).toFixed(2)} {currency}</span></div>
      )}
      <div className="flex justify-between font-bold text-[11px]"><span>TOTAL</span><span>{(repair.total || 0).toFixed(2)} {currency}</span></div>
      <div className="flex justify-between"><span>Acompte</span><span>{(repair.paid || 0).toFixed(2)} {currency}</span></div>
      <div className="flex justify-between font-bold"><span>RESTE DÛ</span><span>{(repair.debt || 0).toFixed(2)} {currency}</span></div>
      {repair.warrantyDays ? (
        <div className="flex justify-between"><span>Garantie</span><span>{repair.warrantyDays} j</span></div>
      ) : null}
      {line}
      <div className="text-[8px] leading-snug mt-1">
        Conditions : appareil laissé sous la responsabilité du client.
        Les données peuvent être perdues lors de la réparation ; sauvegarde
        à la charge du client. Tout appareil non récupéré sous 90 jours pourra
        être recyclé pour couvrir les frais. La garantie ne couvre que la panne
        réparée, hors casse, oxydation et mauvaise manipulation.
      </div>
      <div className="mt-4 flex justify-between text-[9px]">
        <div className="text-center">
          <div className="border-t border-black w-[30mm] mb-0.5" />
          Signature client
        </div>
        <div className="text-center">
          <div className="border-t border-black w-[30mm] mb-0.5" />
          L'atelier
        </div>
      </div>
      <div className="text-center mt-3 text-[9px]">
        Conservez ce bon pour récupérer votre appareil.<br />{storeName}
      </div>
    </div>
  );
});

RepairTicket.displayName = 'RepairTicket';
