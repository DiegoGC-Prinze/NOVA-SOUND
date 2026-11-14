// Funciones de ayuda compartidas por todas las pantallas.

// Escapa texto antes de meterlo en innerHTML. Úsalo con TODO dato que venga del back.
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// 2550 -> "2,550"
export function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('es-MX') : '—';
}

// 85 -> "85.0%"
export function pct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
}

// "2026-10-15" -> "15/10/2026" (sin convertir zonas horarias)
export function fechaCorta(iso) {
  const [a, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
}

const dos = (n) => String(n).padStart(2, '0');
const aISO = (f) => `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;

// Fecha de hoy en formato "YYYY-MM-DD" con la hora local.
export function hoyISO() {
  return aISO(new Date());
}

// Fecha relativa a hoy: fechaRelativa(-1) es ayer, fechaRelativa(3) es dentro de 3 días.
export function fechaRelativa(dias) {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return aISO(f);
}

// Días que hay de una fecha ISO a otra (b - a).
export function diasEntre(isoA, isoB) {
  const t = (iso) => {
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((t(isoB) - t(isoA)) / 86400000);
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "2026-11-11" -> "mié 11 nov"
export function fechaLarga(iso) {
  const [a, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number);
  if (!a) return '—';
  const f = new Date(a, m - 1, d);
  return `${DIAS[f.getDay()]} ${d} ${MESES[m - 1]}`;
}

// "Hoy", "Ayer" o la fecha corta. Sirve para mostrar cuándo pasó algo.
export function diaRelativo(iso) {
  const dias = diasEntre(iso, hoyISO());
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return fechaCorta(iso);
}

// Turnos del caso: 1 = 06:00 a 14:00, 2 = 14:00 a 22:00. Fuera de eso devuelve null.
export function turnoPorHora(fecha = new Date()) {
  const h = fecha.getHours();
  if (h >= 6 && h < 14) return 1;
  if (h >= 14 && h < 22) return 2;
  return null;
}

// "Hora" en formato 24 h: 17:05
export function horaActual(fecha = new Date()) {
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

// Minúsculas y sin acentos, para buscar sin que importe cómo se escribió.
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Porcentaje seguro: pctDe(1, 4) = 25. Si el total es 0 devuelve 0.
export function pctDe(parte, total) {
  return total > 0 ? (parte / total) * 100 : 0;
}

// Descarga un CSV que abre bien en Excel.
//   columnas: [{ titulo: 'Línea', valor: (fila) => fila.linea }]
export function descargarCSV(nombreArchivo, columnas, filas) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [columnas.map((c) => celda(c.titulo)).join(',')];
  filas.forEach((f) => lineas.push(columnas.map((c) => celda(c.valor(f))).join(',')));
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}
