import React from 'react';
import { barcodeSvg } from '../lib/barcode';

interface BarcodeProps {
  value: string;
  height?: number;
  moduleWidth?: number;
  // Affiche la valeur en clair sous les barres (défaut : true)
  showText?: boolean;
  className?: string;
}

// Affiche un code-barres Code128 (SVG) pour la valeur donnée.
// Utilisé sur le bon de dépôt pour scanner rapidement le n° de réparation.
export function Barcode({ value, height = 40, moduleWidth = 1.6, showText = true, className }: BarcodeProps) {
  if (!value) return null;
  const svg = barcodeSvg(value, { height, moduleWidth });
  return (
    <div className={className} style={{ textAlign: 'center' }}>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {showText && (
        <div style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1px', marginTop: 2 }}>
          {value}
        </div>
      )}
    </div>
  );
}
