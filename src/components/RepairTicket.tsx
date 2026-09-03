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
// Contenu centré et police réduite pour tenir sur un minimum de longueur de rouleau.
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
  // Ligne clé/valeur centrée (au lieu d'un alignement gauche/droite)
  const Row = ({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) => (
    <div className={`text-center ${bold ? 'font-bold' : ''}`}>
      <span>{label} : </span><span>{value}</span>
    </div>
  );

  return (
    <div ref={ref} className="p-2 w-full bg-white text-black font-mono text-[7px] leading-snug text-center box-border">
      <div className="font-bold text-[9px] uppercase">{storeName}</div>
      <div>{storeAddress}</div>
      {storePhone && <div>Tél: {storePhone}</div>}
      {line}
      <div className="font-bold text-[8px]">BON DE DÉPÔT / RÉPARATION</div>
      {line}
      <Row label="N°" value={repair.number} bold />
      {repair.number && (
        <div className="flex justify-center my-1">
          <Barcode value={repair.number} height={26} moduleWidth={1} />
        </div>
      )}
      <Row label="Date dépôt" value={dateStr} />
      <Row label="Statut" value={REPAIR_STATUS_LABELS[repair.status]} />
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
            <div key={i}>{p.name} x{p.quantity} — {p.total.toFixed(2)}</div>
          ))}
          {line}
        </>
      )}
      {(repair.laborCost || 0) > 0 && (
        <Row label="Main d'œuvre" value={`${(repair.laborCost || 0).toFixed(2)} ${currency}`} />
      )}
      {(repair.estimatedCost || 0) > 0 && (
        <Row label="Devis estimé" value={`${(repair.estimatedCost || 0).toFixed(2)} ${currency}`} />
      )}
      <Row label="TOTAL" value={`${(repair.total || 0).toFixed(2)} ${currency}`} bold />
      <Row label="Acompte" value={`${(repair.paid || 0).toFixed(2)} ${currency}`} />
      <Row label="RESTE DÛ" value={`${(repair.debt || 0).toFixed(2)} ${currency}`} bold />
      {repair.warrantyDays ? <Row label="Garantie" value={`${repair.warrantyDays} j`} /> : null}
      {line}
      <div className="text-[5.5px] leading-snug mt-1">
        Conditions : appareil laissé sous la responsabilité du client.
        Les données peuvent être perdues lors de la réparation ; sauvegarde
        à la charge du client. Tout appareil non récupéré sous 90 jours pourra
        être recyclé pour couvrir les frais. La garantie ne couvre que la panne
        réparée, hors casse, oxydation et mauvaise manipulation.
      </div>
      <div className="mt-3 flex justify-center gap-6 text-[6px]">
        <div className="text-center">
          <div className="border-t border-black w-[20mm] mb-0.5" />
          Signature client
        </div>
        <div className="text-center">
          <div className="border-t border-black w-[20mm] mb-0.5" />
          L'atelier
        </div>
      </div>
      <div className="mt-2 text-[6px]">
        Conservez ce bon pour récupérer votre appareil.<br />{storeName}
      </div>
    </div>
  );
});

RepairTicket.displayName = 'RepairTicket';
