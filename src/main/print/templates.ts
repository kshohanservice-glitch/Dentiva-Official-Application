import path from 'node:path';

/**
 * Reusable print document templates. The exact same HTML string is used for
 * on-screen preview (iframe) and for real printing/PDF (hidden window), so
 * preview == output by construction. Layouts are dedicated per paper family
 * (A4/A5 portrait vs 80mm/58mm thermal) — never a scaled-down A4.
 */

export interface PrintProfile {
  id: number;
  name: string;
  paperSize: 'A4' | 'A5' | '80mm' | '58mm' | 'custom';
  widthMm: number;
  heightMm: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  orientation: 'portrait' | 'landscape';
  scale: number;
}

export interface PrintClinic {
  name: string;
  logoPath: string | null;
  address: string;
  phone: string;
  altPhone?: string;
  email?: string;
  website?: string;
  openingHours?: string;
  footerMessage?: string;
  prescriptionMessage?: string;
  emergencyContact?: string;
}

export function esc(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fileUrl(p: string): string {
  let resolved = path.resolve(p);
  if (process.platform === 'win32') resolved = '/' + resolved.replace(/\\/g, '/');
  return encodeURI('file://' + resolved).replace(/#/g, '%23');
}

function fontCss(fontsDir: string): string {
  const f = (name: string, weight: number, file: string) => `
@font-face { font-family: '${name}'; font-style: normal; font-weight: ${weight}; font-display: block;
  src: url('${fileUrl(path.join(fontsDir, file))}') format('woff2'); }`;
  return [
    f('Inter', 400, 'inter-latin-400-normal.woff2'),
    f('Inter', 500, 'inter-latin-500-normal.woff2'),
    f('Inter', 600, 'inter-latin-600-normal.woff2'),
    f('Inter', 700, 'inter-latin-700-normal.woff2'),
    f('NotoBengali', 400, 'noto-sans-bengali-bengali-400-normal.woff2'),
    f('NotoBengali', 500, 'noto-sans-bengali-bengali-500-normal.woff2'),
    f('NotoBengali', 600, 'noto-sans-bengali-bengali-600-normal.woff2'),
    f('NotoBengali', 700, 'noto-sans-bengali-bengali-700-normal.woff2'),
  ].join('\n');
}

export interface DocOptions {
  profile: PrintProfile;
  fontsDir: string;
  title: string;
}

/** Shell document with @page sizing, fonts, and print base styles. */
export function docShell(opts: DocOptions, bodyClass: string, inner: string): string {
  const { profile } = opts;
  const w = profile.orientation === 'landscape' ? profile.heightMm : profile.widthMm;
  const h = profile.orientation === 'landscape' ? profile.widthMm : profile.heightMm;
  const thermal = profile.paperSize === '80mm' || profile.paperSize === '58mm';
  const marginCss = thermal
    ? `0mm`
    : `${profile.marginTop}mm ${profile.marginRight}mm ${profile.marginBottom}mm ${profile.marginLeft}mm`;
  const padCss = thermal
    ? `padding: ${profile.marginTop}mm ${profile.marginRight}mm ${profile.marginBottom}mm ${profile.marginLeft}mm;`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(opts.title)}</title>
<style>
${fontCss(opts.fontsDir)}
@page { size: ${w}mm ${h}mm; margin: ${marginCss}; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body {
  font-family: 'Inter', 'NotoBengali', sans-serif;
  color: #0f172a;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  font-size: ${thermal ? '10.5px' : '12px'};
  line-height: 1.45;
}
.page { width: ${w}mm; min-height: ${thermal ? 'auto' : h + 'mm'}; ${padCss} position: relative; }
h1,h2,h3 { font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
.small { font-size: 0.9em; }
.muted { color: #475569; }
.nowrap { white-space: nowrap; }
.bangla { font-family: 'NotoBengali', 'Inter', sans-serif; }
</style>
</head>
<body class="${bodyClass}">${inner}</body>
</html>`;
}

/* ================================ PRESCRIPTION ================================ */

export interface RxPrintData {
  code: string;
  date: string;
  patientName: string;
  gender: string | null;
  age: number | null;
  patientCode: string;
  dentistName: string;
  designations: string[];
  qualifications: string | null;
  availability: string | null;
  chiefComplaint: string;
  onExamination: string;
  examinationResult: string;
  advice: string;
  items: {
    medicineName: string;
    strength: string | null;
    form: string | null;
    dose: string | null;
    frequency: string | null;
    morning: boolean;
    noon: boolean;
    night: boolean;
    meal: string | null;
    duration: string | null;
    instruction: string | null;
    quantity: string | null;
    genericName: string | null;
  }[];
  signaturePath: string | null;
}

function frequencyText(item: RxPrintData['items'][number]): string {
  const parts: string[] = [];
  if (item.morning || item.noon || item.night) {
    const slots = [item.morning ? 'M' : null, item.noon ? 'N' : null, item.night ? 'NT' : null].filter(Boolean);
    parts.push(slots.join('-'));
  }
  if (item.frequency) parts.push(item.frequency);
  return parts.join(' ') || '—';
}

function mealText(item: RxPrintData['items'][number]): string {
  if (item.meal === 'before') return 'Before meal';
  if (item.meal === 'after') return 'After meal';
  if (item.meal === 'any') return 'Any time';
  return '';
}

export function renderPrescription(data: RxPrintData, clinic: PrintClinic, opts: DocOptions): string {
  const thermal = opts.profile.paperSize === '80mm' || opts.profile.paperSize === '58mm';
  const logo = clinic.logoPath
    ? `<img src="${fileUrl(clinic.logoPath)}" alt="" style="height:${thermal ? 10 : 14}mm;">`
    : '';
  const header = `
  <header style="display:flex; align-items:center; gap:${thermal ? 6 : 12}px; border-bottom:2px solid #0e7490; padding-bottom:${thermal ? 5 : 8}px; margin-bottom:${thermal ? 6 : 10}px;">
    ${logo}
    <div style="flex:1;">
      <div style="font-size:${thermal ? 13 : 19}px; font-weight:700; color:#0e7490;">${esc(clinic.name)}</div>
      ${clinic.address ? `<div class="small muted bangla">${esc(clinic.address)}</div>` : ''}
      ${clinic.phone ? `<div class="small muted">Phone: ${esc(clinic.phone)}</div>` : ''}
    </div>
    <div style="text-align:right;" class="small">
      <div style="font-weight:600;">${esc(data.dentistName)}</div>
      ${data.designations.length ? `<div class="muted">${esc(data.designations.join(', '))}</div>` : ''}
      ${data.qualifications ? `<div class="muted">${esc(data.qualifications)}</div>` : ''}
    </div>
  </header>`;

  const patientRow = `
  <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:${thermal ? 10.5 : 12.5}px; border-bottom:1px solid #e2e8f0; padding-bottom:6px; margin-bottom:${thermal ? 6 : 10}px;">
    <div><strong>${esc(data.patientName)}</strong></div>
    <div>${data.gender ? esc(data.gender) : ''}${data.gender && data.age != null ? ', ' : ''}${data.age != null ? data.age + ' y' : ''}</div>
    <div class="muted">${esc(data.patientCode)}</div>
    <div style="margin-left:auto;" class="muted">Date: ${esc(data.date)}</div>
  </div>`;

  const medRows = data.items
    .map(
      (it, i) => `
    <tr>
      <td style="padding:${thermal ? '3px 2px' : '5px 4px'}; vertical-align:top; border-bottom:1px dotted #cbd5e1;">
        <div style="font-weight:600;">${i + 1}. <span class="bangla">${esc(it.medicineName)}</span>${
          it.strength ? ' ' + esc(it.strength) : ''
        }${it.form ? ' (' + esc(it.form) + ')' : ''}</div>
        <div class="small muted">
          ${esc(frequencyText(it))}${it.dose ? ' · ' + esc(it.dose) : ''}${mealText(it) ? ' · ' + mealText(it) : ''}
          ${it.duration ? ' · ' + esc(it.duration) : ''}${it.quantity ? ' · Qty: ' + esc(it.quantity) : ''}
        </div>
        ${it.instruction ? `<div class="small muted">${esc(it.instruction)}</div>` : ''}
      </td>
    </tr>`,
    )
    .join('');

  const clinicalBlock = (label: string, body: string) =>
    body.trim()
      ? `<div style="margin-bottom:${thermal ? 5 : 8}px;">
          <div style="font-weight:700; color:#0e7490; font-size:${thermal ? 10 : 11.5}px; letter-spacing:.03em;">${label}</div>
          <div class="bangla" style="white-space:pre-wrap; font-size:${thermal ? 10.5 : 12}px;">${esc(body)}</div>
        </div>`
      : '';

  const clinicalLeft = thermal
    ? clinicalBlock('C/C', data.chiefComplaint) +
      clinicalBlock('O/E', data.onExamination) +
      clinicalBlock('R/E', data.examinationResult) +
      clinicalBlock('Advice', data.advice)
    : `<div style="flex:1; padding-right:10px; border-right:1px solid #e2e8f0;">
        ${clinicalBlock('C/C', data.chiefComplaint)}
        ${clinicalBlock('O/E', data.onExamination)}
        ${clinicalBlock('R/E', data.examinationResult)}
        ${clinicalBlock('Advice', data.advice)}
      </div>`;

  const medRight = thermal
    ? `<div style="margin-top:${thermal ? 4 : 8}px;">
        <div style="font-weight:700; color:#0e7490; font-size:10px; letter-spacing:.03em; border-bottom:1px solid #0e7490; padding-bottom:2px; margin-bottom:3px;">MEDICATIONS</div>
        <table>${medRows}</table>
      </div>`
    : `<div style="flex:1.05; padding-left:10px;">
        <div style="font-weight:700; color:#0e7490; font-size:11.5px; letter-spacing:.03em; border-bottom:1px solid #0e7490; padding-bottom:3px; margin-bottom:4px;">MEDICATIONS</div>
        <table>${medRows}</table>
      </div>`;

  const body = thermal
    ? `<div style="display:block;">${clinicalLeft}${medRight}</div>`
    : `<div style="display:flex; gap:0; align-items:flex-start;">${clinicalLeft}${medRight}</div>`;

  const footer = `
  <footer style="margin-top:${thermal ? 8 : 14}px; border-top:1px solid #e2e8f0; padding-top:${thermal ? 5 : 8}px;">
    ${clinic.prescriptionMessage ? `<div class="small bangla muted">${esc(clinic.prescriptionMessage)}</div>` : ''}
    ${clinic.openingHours && opts.profile.paperSize !== '58mm' ? `<div class="small muted">Availability: ${esc(clinic.openingHours)}</div>` : ''}
    ${clinic.footerMessage ? `<div class="small muted bangla">${esc(clinic.footerMessage)}</div>` : ''}
    <div style="height:${thermal ? 16 : 24}mm;"></div>
    <div style="display:flex; justify-content:space-between; align-items:flex-end;">
      <div class="small muted">${esc(data.code)}</div>
      <div style="text-align:center; min-width:${thermal ? 34 : 52}mm;">
        <div style="border-top:1px dotted #64748b; padding-top:3px; font-size:10px; color:#64748b;">Dentist's Signature</div>
      </div>
    </div>
  </footer>`;

  const inner = `<div class="page">${header}${patientRow}${body}${footer}</div>`;
  return docShell(opts, 'prescription', inner);
}

/* ================================== INVOICE ================================== */

export interface InvoicePrintData {
  invoiceNo: string;
  date: string;
  patientName: string;
  patientCode: string;
  items: { description: string; qty: number; unitPrice: number; discount: number; lineTotal: number }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paidTotal: number;
  balance: number;
  status: string;
  notes: string | null;
  payments: { amount: number; paidAt: string; methodLabel: string }[];
}

export function renderInvoice(data: InvoicePrintData, clinic: PrintClinic, opts: DocOptions): string {
  const thermal = opts.profile.paperSize === '80mm' || opts.profile.paperSize === '58mm';
  const logo = clinic.logoPath ? `<img src="${fileUrl(clinic.logoPath)}" style="height:${thermal ? 9 : 13}mm;">` : '';
  const header = `
  <header style="display:flex; align-items:center; gap:10px; border-bottom:2px solid #0f172a; padding-bottom:6px; margin-bottom:8px;">
    ${logo}
    <div style="flex:1;">
      <div style="font-size:${thermal ? 12.5 : 18}px; font-weight:700;">${esc(clinic.name)}</div>
      ${clinic.address ? `<div class="small muted bangla">${esc(clinic.address)}</div>` : ''}
      ${clinic.phone ? `<div class="small muted">Phone: ${esc(clinic.phone)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div style="font-size:${thermal ? 12 : 15}px; font-weight:700;">INVOICE</div>
      <div class="small">${esc(data.invoiceNo)}</div>
    </div>
  </header>`;

  const meta = `
  <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:${thermal ? 10.5 : 12.5}px; margin-bottom:8px;">
    <div><span class="muted">Patient:</span> <strong>${esc(data.patientName)}</strong> (${esc(data.patientCode)})</div>
    <div style="margin-left:auto;" class="muted">Date: ${esc(data.date)}</div>
  </div>`;

  const rows = data.items
    .map(
      (it, i) => `
    <tr>
      <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0;">${i + 1}. <span class="bangla">${esc(it.description)}</span></td>
      <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:center;">${it.qty}</td>
      <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:right;">${it.unitPrice.toFixed(2)}</td>
      ${thermal ? '' : `<td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:right;">${it.discount ? it.discount.toFixed(2) : '—'}</td>`}
      <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:600;">${it.lineTotal.toFixed(2)}</td>
    </tr>`,
    )
    .join('');

  const totals = `
  <div style="margin-top:${thermal ? 6 : 10}px; display:flex; justify-content:flex-end;">
    <table style="width:${thermal ? 100 : 70}%; font-size:${thermal ? 10.5 : 12.5}px;">
      <tr><td class="muted" style="padding:2px 4px;">Subtotal</td><td style="text-align:right; padding:2px 4px;">৳ ${data.subtotal.toFixed(2)}</td></tr>
      ${data.discountAmount ? `<tr><td class="muted" style="padding:2px 4px;">Discount</td><td style="text-align:right; padding:2px 4px;">- ৳ ${data.discountAmount.toFixed(2)}</td></tr>` : ''}
      ${data.taxAmount ? `<tr><td class="muted" style="padding:2px 4px;">Tax</td><td style="text-align:right; padding:2px 4px;">৳ ${data.taxAmount.toFixed(2)}</td></tr>` : ''}
      <tr style="border-top:2px solid #0f172a;"><td style="padding:4px; font-weight:700;">TOTAL</td><td style="text-align:right; padding:4px; font-weight:700; font-size:1.1em;">৳ ${data.total.toFixed(2)}</td></tr>
      <tr><td class="muted" style="padding:2px 4px;">Paid</td><td style="text-align:right; padding:2px 4px;">৳ ${data.paidTotal.toFixed(2)}</td></tr>
      <tr><td class="muted" style="padding:2px 4px;">Balance Due</td><td style="text-align:right; padding:2px 4px; font-weight:600; color:${data.balance > 0 ? '#b91c1c' : '#15803d'};">৳ ${data.balance.toFixed(2)}</td></tr>
      <tr><td class="muted" style="padding:2px 4px;">Status</td><td style="text-align:right; padding:2px 4px; font-weight:600;">${esc(data.status.toUpperCase())}</td></tr>
    </table>
  </div>`;

  const paymentRows = data.payments.length
    ? `<div style="margin-top:${thermal ? 6 : 10}px;">
        <div style="font-weight:700; font-size:${thermal ? 9.5 : 11}px; letter-spacing:.04em; color:#475569;">PAYMENTS</div>
        <table class="small" style="margin-top:2px;">${data.payments
          .map(
            (p) =>
              `<tr><td style="padding:2px 3px; border-bottom:1px dotted #cbd5e1;">${esc(p.paidAt.slice(0, 10))} · ${esc(p.methodLabel)}</td><td style="padding:2px 3px; border-bottom:1px dotted #cbd5e1; text-align:right;">৳ ${p.amount.toFixed(2)}</td></tr>`,
          )
          .join('')}</table>
      </div>`
    : '';

  const inner = `<div class="page">
    ${header}${meta}
    <table style="font-size:${thermal ? 10.5 : 12.5}px;">
      <thead><tr style="background:#f1f5f9; border-bottom:2px solid #cbd5e1;">
        <th style="text-align:left; padding:5px 3px;">Item</th>
        <th style="text-align:center; padding:5px 3px; width:10%;">Qty</th>
        <th style="text-align:right; padding:5px 3px; width:18%;">Unit</th>
        ${thermal ? '' : '<th style="text-align:right; padding:5px 3px; width:14%;">Disc</th>'}
        <th style="text-align:right; padding:5px 3px; width:20%;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${totals}${paymentRows}
    ${data.notes ? `<div class="small muted bangla" style="margin-top:8px;">${esc(data.notes)}</div>` : ''}
    ${clinic.footerMessage ? `<div class="small muted" style="margin-top:${thermal ? 8 : 14}px; text-align:center;">${esc(clinic.footerMessage)}</div>` : ''}
    <div class="small muted" style="margin-top:4px; text-align:center; font-size:9px;">This is a computer generated invoice.</div>
  </div>`;
  return docShell(opts, 'invoice', inner);
}

/* ============================== SUMMARY REPORTS ============================== */

function simpleTable(head: string[], rows: string[][]): string {
  return `<table style="font-size:11.5px;">
    <thead><tr style="background:#f1f5f9; border-bottom:2px solid #cbd5e1;">
      ${head.map((h, i) => `<th style="text-align:${i === 0 ? 'left' : 'right'}; padding:5px;">${esc(h)}</th>`).join('')}
    </tr></thead>
    <tbody>${rows
      .map(
        (r) =>
          `<tr>${r
            .map(
              (c, i) =>
                `<td style="padding:4px 5px; border-bottom:1px solid #e2e8f0; text-align:${i === 0 ? 'left' : 'right'};" class="bangla">${esc(c)}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('')}</tbody>
  </table>`;
}

export function renderReportHeader(
  title: string,
  subtitle: string,
  clinic: PrintClinic,
  opts: DocOptions,
): string {
  const thermal = opts.profile.paperSize === '80mm' || opts.profile.paperSize === '58mm';
  return `<header style="border-bottom:2px solid #0f172a; padding-bottom:6px; margin-bottom:10px;">
    <div style="display:flex; align-items:center; gap:10px;">
      ${clinic.logoPath ? `<img src="${fileUrl(clinic.logoPath)}" style="height:${thermal ? 8 : 12}mm;">` : ''}
      <div>
        <div style="font-weight:700; font-size:${thermal ? 12 : 16}px;">${esc(clinic.name)}</div>
        <div class="small muted">${esc(title)}${subtitle ? ' · ' + esc(subtitle) : ''}</div>
      </div>
      <div style="margin-left:auto; text-align:right;" class="small muted">
        <div>Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>
        ${clinic.phone ? `<div>${esc(clinic.phone)}</div>` : ''}
      </div>
    </div>
  </header>`;
}

export function renderTableReport(
  title: string,
  subtitle: string,
  head: string[],
  rows: string[][],
  clinic: PrintClinic,
  opts: DocOptions,
): string {
  const inner = `<div class="page">${renderReportHeader(title, subtitle, clinic, opts)}
    <h2 style="font-size:13px; margin-bottom:6px;">${esc(title)}</h2>
    ${simpleTable(head, rows)}
    ${rows.length === 0 ? '<div class="muted" style="padding:14px; text-align:center;">No data for the selected period.</div>' : ''}
  </div>`;
  return docShell(opts, 'report', inner);
}

export function renderPatientSummary(
  data: {
    patientName: string;
    patientCode: string;
    gender: string | null;
    age: number | null;
    phone: string | null;
    address: string | null;
    allergies: string | null;
    visits: { date: string; complaint: string; diagnosis: string; dentist: string }[];
    prescriptions: { date: string; code: string; medicines: string }[];
    invoices: { date: string; no: string; total: number; paid: number; status: string }[];
    totals: { billed: number; paid: number; balance: number; financial: boolean };
  },
  clinic: PrintClinic,
  opts: DocOptions,
): string {
  const inner = `<div class="page">
    ${renderReportHeader('Patient Summary', data.patientCode, clinic, opts)}
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px; font-size:12.5px;">
      <div><strong>${esc(data.patientName)}</strong></div>
      <div>${esc(data.gender ?? '')}${data.age != null ? ' · ' + data.age + ' y' : ''}</div>
      <div>${esc(data.phone ?? '')}</div>
      <div class="muted bangla">${esc(data.address ?? '')}</div>
      ${data.allergies ? `<div style="color:#b91c1c; font-weight:600;">Allergies: ${esc(data.allergies)}</div>` : ''}
    </div>
    <h2 style="font-size:12.5px; color:#0e7490; margin:8px 0 4px;">Visits (${data.visits.length})</h2>
    ${simpleTable(['Date', 'Complaint', 'Diagnosis', 'Dentist'], data.visits.map((v) => [v.date, v.complaint, v.diagnosis, v.dentist]))}
    <h2 style="font-size:12.5px; color:#0e7490; margin:10px 0 4px;">Prescriptions (${data.prescriptions.length})</h2>
    ${simpleTable(['Date', 'Code', 'Medicines'], data.prescriptions.map((p) => [p.date, p.code, p.medicines]))}
    ${data.totals.financial ? `
    <h2 style="font-size:12.5px; color:#0e7490; margin:10px 0 4px;">Invoices (${data.invoices.length})</h2>
    ${simpleTable(['Date', 'No', 'Total', 'Paid', 'Status'], data.invoices.map((i) => [i.date, i.no, i.total.toFixed(2), i.paid.toFixed(2), i.status]))}
    <div style="margin-top:8px; text-align:right; font-weight:600;">
      Billed ৳ ${data.totals.billed.toFixed(2)} · Paid ৳ ${data.totals.paid.toFixed(2)} · Balance ৳ ${data.totals.balance.toFixed(2)}
    </div>` : ''}
  </div>`;
  return docShell(opts, 'summary', inner);
}
