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
