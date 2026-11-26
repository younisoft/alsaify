export interface ExportColumn<T> { label: string; value: (row: T) => string | number | null | undefined }

export async function exportXlsx<T>(filename: string, sheet: string, columns: ExportColumn<T>[], rows: T[], title?: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DARK-CLOUD';
  const ws = wb.addWorksheet(sheet.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: title ? 3 : 1 }] });
  if (title) { ws.addRow([title]).font = { bold: true, size: 14 }; ws.addRow([]); }
  const header = ws.addRow(columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10243A' } }; });
  for (const r of rows) ws.addRow(columns.map((c) => c.value(r) ?? ''));
  ws.columns.forEach((col, i) => { col.width = Math.min(40, Math.max(10, columns[i]?.label.length + 4 || 12)); });
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

export function exportCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
