// Générateur de code-barres Code128 (sous-jeu B) en SVG, sans dépendance externe.
// Suffisant pour encoder des numéros de réparation type "REP-2026-0001".
// Code 128B couvre les caractères ASCII 32..126 (chiffres, lettres, tirets, etc.).

// Patrons de barres Code128 : chaque entrée = largeurs de 6 modules (barre, espace, barre, ...).
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];

const START_B = 104;
const STOP = 106;

/**
 * Retourne les largeurs de modules (nombres) représentant le code-barres Code128B
 * pour la chaîne donnée. On peut ensuite les dessiner en SVG.
 */
function encode128B(text: string): number[] {
  const modules: number[] = [];
  const pushPattern = (code: number) => {
    const pat = PATTERNS[code];
    for (const ch of pat) modules.push(parseInt(ch, 10));
  };

  pushPattern(START_B);
  let checksum = START_B;

  let pos = 1;
  for (const ch of text) {
    let value = ch.charCodeAt(0) - 32; // Code128B : ASCII 32 => valeur 0
    if (value < 0 || value > 94) value = 0; // caractère hors plage => espace
    pushPattern(value);
    checksum += value * pos;
    pos++;
  }

  pushPattern(checksum % 103);
  pushPattern(STOP);
  return modules;
}

/**
 * Génère le markup SVG d'un code-barres Code128B pour `text`.
 * @param text  contenu à encoder (ex: "REP-2026-0001")
 * @param opts  hauteur des barres, largeur d'un module, marge
 */
export function barcodeSvg(
  text: string,
  opts: { height?: number; moduleWidth?: number; margin?: number } = {}
): string {
  const height = opts.height ?? 40;
  const mw = opts.moduleWidth ?? 1.6;
  const margin = opts.margin ?? 6;

  const modules = encode128B(text);
  const totalWidth = modules.reduce((s, m) => s + m, 0) * mw + margin * 2;

  let x = margin;
  let bar = true; // Code128 commence toujours par une barre
  const rects: string[] = [];
  for (const m of modules) {
    const w = m * mw;
    if (bar) {
      rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="#000"/>`);
    }
    x += w;
    bar = !bar;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}" height="${height}" viewBox="0 0 ${totalWidth.toFixed(2)} ${height}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Code-barres pour étiquettes produit (imprimante thermique 203 dpi, douchette laser)
// ---------------------------------------------------------------------------
// - 13 chiffres avec clé valide → EAN-13 ; 8 chiffres valides → EAN-8
//   (format natif des codes produits, lu par toutes les douchettes).
// - Sinon → Code128 (jeu C pour les chiffres, plus compact ; jeu B sinon).
// - Largeur de module fixe (0,25 mm = 2 points à 203 dpi) : pas d'étirement,
//   barres nettes, et zones blanches (quiet zones) obligatoires de chaque côté.

const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const EAN13_PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

function eanChecksumOk(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // pondération 3/1 en partant de la droite (hors clé)
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// Retourne une chaîne de bits (1 = barre, 0 = espace), sans zones blanches.
function encodeEan13(code: string): string {
  const d = code.split('').map(Number);
  const parity = EAN13_PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += parity[i - 1] === 'L' ? EAN_L[d[i]] : EAN_G[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[d[i]];
  return bits + '101';
}

function encodeEan8(code: string): string {
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += EAN_L[d[i]];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += EAN_R[d[i]];
  return bits + '101';
}

// Code128 avec jeu C pour les suites de chiffres (réduit fortement la largeur).
function encode128Auto(text: string): string {
  const START_B_ = 104, START_C = 105, CODE_B = 100, CODE_C = 99;
  const values: number[] = [];
  const isDigits = (s: string) => /^[0-9]+$/.test(s);
  let i = 0;
  let set: 'B' | 'C';

  const digitRunAt = (pos: number) => { let n = 0; while (pos + n < text.length && /[0-9]/.test(text[pos + n])) n++; return n; };

  if (isDigits(text) && text.length % 2 === 0) { values.push(START_C); set = 'C'; }
  else if (digitRunAt(0) >= 4 && digitRunAt(0) % 2 === 0) { values.push(START_C); set = 'C'; }
  else { values.push(START_B_); set = 'B'; }

  while (i < text.length) {
    if (set === 'C') {
      if (digitRunAt(i) >= 2) { values.push(parseInt(text.substr(i, 2), 10)); i += 2; continue; }
      values.push(CODE_B); set = 'B'; continue;
    }
    // jeu B : passe en C si une suite paire d'au moins 4 chiffres suit
    // (ou si le reste du texte est entièrement numérique et pair)
    const run = digitRunAt(i);
    if (run >= 4 && (run % 2 === 0 || i + run === text.length && run % 2 === 0)) { values.push(CODE_C); set = 'C'; continue; }
    if (run >= 5 && run % 2 === 1) {
      // un chiffre en B puis le reste (pair) en C
      values.push(text.charCodeAt(i) - 32); i++;
      values.push(CODE_C); set = 'C'; continue;
    }
    let v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) v = 0;
    values.push(v); i++;
  }

  let checksum = values[0];
  for (let k = 1; k < values.length; k++) checksum += values[k] * k;
  values.push(checksum % 103);
  values.push(106);

  let bits = '';
  for (const v of values) {
    const pat = PATTERNS[v];
    let bar = true;
    for (const ch of pat) { bits += (bar ? '1' : '0').repeat(parseInt(ch, 10)); bar = !bar; }
  }
  return bits;
}

/**
 * SVG d'un code-barres d'étiquette produit, dimensionné en millimètres réels.
 * @param text        valeur du code-barres (celle scannée par la douchette)
 * @param opts.heightMm   hauteur des barres (défaut 10 mm)
 * @param opts.maxWidthMm largeur maximale disponible (défaut 38 mm)
 */
export function productBarcodeSvg(
  text: string,
  opts: { heightMm?: number; maxWidthMm?: number } = {}
): string {
  const heightMm = opts.heightMm ?? 10;
  const maxWidthMm = opts.maxWidthMm ?? 38;
  const value = (text || '').trim();

  let bits: string;
  let quietLeft: number, quietRight: number;
  if (/^[0-9]{13}$/.test(value) && eanChecksumOk(value)) {
    bits = encodeEan13(value); quietLeft = 11; quietRight = 7;
  } else if (/^[0-9]{8}$/.test(value) && eanChecksumOk(value)) {
    bits = encodeEan8(value); quietLeft = 7; quietRight = 7;
  } else {
    bits = encode128Auto(value); quietLeft = 10; quietRight = 10;
  }

  const totalModules = quietLeft + bits.length + quietRight;
  // Module = multiple exact d'un point d'imprimante 203 dpi (0,125 mm) : 0,375 / 0,25 / 0,125 mm
  const candidates = [0.375, 0.25, 0.125];
  const moduleMm = candidates.find(m => m * totalModules <= maxWidthMm) ?? 0.125;
  const widthMm = totalModules * moduleMm;

  const rects: string[] = [];
  let x = quietLeft;
  let k = 0;
  while (k < bits.length) {
    if (bits[k] === '1') {
      let w = 0;
      while (k + w < bits.length && bits[k + w] === '1') w++;
      rects.push(`<rect x="${x + k}" y="0" width="${w}" height="1" fill="#000"/>`);
      k += w;
    } else {
      k++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${totalModules} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block">${rects.join('')}</svg>`;
}
