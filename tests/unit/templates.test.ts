import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  docShell,
  esc,
  renderInvoice,
  renderPrescription,
  renderTableReport,
  type DocOptions,
  type PrintClinic,
  type PrintProfile,
} from '../../src/main/print/templates';

const profile: PrintProfile = {
  id: 1,
  name: 'A4',
  paperSize: 'A4',
  widthMm: 210,
  heightMm: 297,
  marginTop: 8,
  marginRight: 8,
  marginBottom: 8,
  marginLeft: 8,
  orientation: 'portrait',
  scale: 100,
};

const opts: DocOptions = {
  profile,
  fontsDir: path.resolve(__dirname, '../../assets/fonts'),
  title: 'Test print',
};

const clinic: PrintClinic = {
  name: 'Smile Dental — ঢাকা',
  logoPath: null,
  address: 'House 12, Road 5, Dhaka 1207',
  phone: '+880 1700-000000',
  openingHours: '9:00 AM – 9:00 PM',
  footerMessage: 'Thank you!',
  prescriptionMessage: 'সুস্থ থাকুন।',
};

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<b>&"x"</b>')).toBe('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
  });

  it('passes Bengali through unchanged', () => {
    expect(esc('আমার সোনার বাংলা')).toBe('আমার সোনার বাংলা');
  });
});

describe('docShell', () => {
  it('emits @page size in mm for the profile', () => {
    const html = docShell(opts, 'x', '<div>hi</div>');
    expect(html).toContain('@page');
    expect(html).toContain('210mm');
    expect(html).toContain('297mm');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('landscape swaps page dimensions', () => {
    const html = docShell({ ...opts, profile: { ...profile, orientation: 'landscape' } }, 'x', '');
    expect(html).toMatch(/size:\s*297mm 210mm/);
    expect(html).toMatch(/width:\s*297mm/);
  });

  it('embeds local font faces from assets', () => {
    const html = docShell(opts, 'x', '');
    expect(html).toMatch(/@font-face/);
    expect(html).toMatch(/font-family/i);
  });
});

describe('renderPrescription', () => {
  const data = {
    code: 'RX-000123',
    date: '28 September 2026',
    patientName: 'Rahim <script>alert(1)</script> Uddin',
    gender: 'Male',
    age: 34,
    patientCode: 'P00042',
    dentistName: 'Dr. Fatema Akter',
    designations: ['BDS'],
    qualifications: 'FCPS (Oral Surgery)',
    availability: 'Sat–Thu',
    chiefComplaint: 'Tooth pain lower right',
    onExamination: 'Deep caries 46',
    examinationResult: 'Irreversible pulpitis',
    advice: 'Avoid hard food',
    signaturePath: null,
    items: [
      {
        medicineName: 'Amoxicillin',
        strength: '500mg',
        form: 'Capsule',
        dose: '1 cap',
        frequency: '1-0-1',
        morning: true,
        noon: false,
        night: true,
        meal: 'after',
        duration: '5 days',
        instruction: 'Complete the course',
        quantity: '10',
        genericName: 'Amoxicillin',
      },
    ],
  } as Parameters<typeof renderPrescription>[0];

  it('renders patient, dentist and medicine details', () => {
    const html = renderPrescription(data, clinic, opts);
    expect(html).toContain('RX-000123');
    expect(html).toContain('P00042');
    expect(html).toContain('Dr. Fatema Akter');
    expect(html).toContain('Amoxicillin');
    expect(html).toContain('1-0-1');
    expect(html).toContain('5 days');
  });

  it('neutralizes HTML in patient name (no XSS on print)', () => {
    const html = renderPrescription(data, clinic, opts);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes clinic letterhead and Bengali footer message', () => {
    const html = renderPrescription(data, clinic, opts);
    expect(html).toContain('Smile Dental');
    expect(html).toContain('ঢাকা');
    expect(html).toContain('সুস্থ থাকুন।');
    expect(html).toContain('+880 1700-000000');
  });

  it('renders thermal-friendly layout on 80mm profile', () => {
    const thermal: DocOptions = {
      ...opts,
      profile: { ...profile, paperSize: '80mm', widthMm: 80, heightMm: 200, name: 'Receipt' },
    };
    const html = renderPrescription(data, clinic, thermal);
    expect(html).toContain('80mm');
    expect(html).toContain('RX-000123');
  });
});

describe('renderInvoice', () => {
  const inv = {
    invoiceNo: 'INV-000007',
    date: '28/09/2026',
    patientName: 'Karim & Sons',
    patientCode: 'P00001',
    items: [{ description: 'Scaling', qty: 1, unitPrice: 1500, discount: 100, lineTotal: 1400 }],
    subtotal: 1400,
    discountAmount: 0,
    taxAmount: 0,
    total: 1400,
    paidTotal: 700,
    balance: 700,
    status: 'partial',
    notes: 'Follow up in 7 days',
    payments: [{ amount: 700, paidAt: '28/09/2026', methodLabel: 'bKash' }],
  } as Parameters<typeof renderInvoice>[0];

  it('renders totals and payment status', () => {
    const html = renderInvoice(inv, clinic, opts);
    expect(html).toContain('INV-000007');
    expect(html).toContain('৳');
    expect(html).toContain('bKash');
    expect(html).toContain('1400.00');
    expect(html).toContain('PARTIAL');
  });

  it('escapes patient name', () => {
    const html = renderInvoice({ ...inv, patientName: '<img src=x>' }, clinic, opts);
    expect(html).not.toContain('<img src=x>');
  });

  /**
   * FD-007 regression: `clinic.moneyDecimals` must drive EVERY money cell in
   * the invoice (not just the total). v1.0.0 always printed 2 decimals.
   */
  it('honors moneyDecimals=0 for all money cells', () => {
    const html = renderInvoice(inv, { ...clinic, moneyDecimals: 0 }, opts);
    expect(html).toContain('>1400<'); // line total cell (no currency symbol)
    expect(html).toContain('৳ 1400<'); // subtotal / total / paid / balance cells
    expect(html).toContain('৳ 700<');
    expect(html).not.toContain('1400.00');
    expect(html).not.toContain('700.00');
  });

  it('honors moneyDecimals=4', () => {
    const html = renderInvoice(inv, { ...clinic, moneyDecimals: 4 }, opts);
    expect(html).toContain('>1400.0000<');
    expect(html).toContain('৳ 1400.0000<');
    expect(html).toContain('৳ 700.0000<');
  });

  it('defaults to 2 decimals when the setting is absent', () => {
    const html = renderInvoice(inv, clinic, opts);
    expect(html).toContain('>1400.00<');
  });
});

describe('renderTableReport', () => {
  it('renders header, rows and handles empty data', () => {
    const html = renderTableReport('Financial Report', '2026-09', ['Item', 'Amount'], [['Income', '৳ 5,000.00']], clinic, opts);
    expect(html).toContain('Financial Report');
    expect(html).toContain('৳ 5,000.00');
    const empty = renderTableReport('T', '', ['A'], [], clinic, opts);
    expect(empty).toContain('No data for the selected period.');
  });
});
