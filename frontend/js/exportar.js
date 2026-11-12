// Exportar una tabla a un archivo de Excel (.xlsx) real: encabezado con el azul de la marca, columnas
// con ancho, números como números, fechas como fechas, fila de títulos fija y filtros.
// No usa librerías: un .xlsx es un zip con unos cuantos archivos XML, y aquí se arma a mano.
//
//   descargarExcel('cierres.xlsx', 'Cierres de turno', columnas, filas);
//   columnas: [{ titulo, valor: (fila) => ..., tipo: 'texto' | 'numero' | 'fecha', ancho: 12, centrar: true }]
//   (las fechas se entregan como texto 'AAAA-MM-DD')

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // caracteres que XML no permite
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// Letra de columna: 0 -> A, 25 -> Z, 26 -> AA
const letra = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Excel guarda las fechas como días desde el 30/12/1899.
const serieFecha = (iso) => {
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return null;
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};

// Estilos (s=): 0 normal · 1 encabezado · 2 número con miles · 3 fecha dd/mm/aaaa · 4 número centrado · 5 texto centrado
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B5C7A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xmlHoja(columnas, filas) {
  const ultima = `${letra(columnas.length - 1)}${filas.length + 1}`;
  const anchos = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || Math.max(12, c.titulo.length + 4)}" customWidth="1"/>`)
    .join('');

  const encabezado = columnas
    .map((c, i) => `<c r="${letra(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c.titulo)}</t></is></c>`)
    .join('');

  const cuerpo = filas
    .map((fila, r) => {
      const n = r + 2;
      const celdas = columnas
        .map((c, i) => {
          const ref = `${letra(i)}${n}`;
          const v = c.valor(fila);
          if (c.tipo === 'numero' && v !== '' && v != null && !Number.isNaN(Number(v))) return `<c r="${ref}" s="${c.centrar ? 4 : 2}"><v>${Number(v)}</v></c>`;
          if (c.tipo === 'fecha' && serieFecha(v) != null) return `<c r="${ref}" s="3"><v>${serieFecha(v)}</v></c>`;
          return `<c r="${ref}"${c.centrar ? ' s="5"' : ''} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${n}">${celdas}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${ultima}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${anchos}</cols>
<sheetData><row r="1" ht="22" customHeight="1">${encabezado}</row>${cuerpo}</sheetData>
<autoFilter ref="A1:${ultima}"/>
</worksheet>`;
}

// ---------------------------------------------------------------- zip sin compresión
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function armarZip(archivos) {
  const texto = new TextEncoder();
  const partes = [];
  const central = [];
  let posicion = 0;
  // Hora fija (1/1/2026 00:00) para que el archivo salga igual siempre.
  const hora = 0;
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1;

  archivos.forEach(({ nombre, contenido }) => {
    const nom = texto.encode(nombre);
    const datos = texto.encode(contenido);
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nom, datos);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, hora, true);
    dir.setUint16(14, fecha, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, datos.length, true);
    dir.setUint32(24, datos.length, true);
    dir.setUint16(28, nom.length, true);
    dir.setUint32(42, posicion, true);
    central.push(new Uint8Array(dir.buffer), nom);

    posicion += 30 + nom.length + datos.length;
  });

  const tamanoCentral = central.reduce((t, p) => t + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, posicion, true);

  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Arma el .xlsx y lo manda a descargar. También se puede pedir solo el archivo: armarExcel(...).
export function armarExcel(nombreHoja, columnas, filas) {
  const hoja = esc(nombreHoja.replace(/[[\]:*?/\\"']/g, ' ').slice(0, 31));
  const ultima = `$${letra(columnas.length - 1)}$${filas.length + 1}`;
  return armarZip([
    {
      nombre: '[Content_Types].xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${hoja}'!$A$1:${ultima}</definedName></definedNames></workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: xmlHoja(columnas, filas) },
  ]);
}

export function descargarExcel(nombreArchivo, nombreHoja, columnas, filas) {
  const archivo = armarExcel(nombreHoja, columnas, filas);
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(archivo);
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}
