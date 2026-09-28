import React, { useEffect, useState } from 'react';
import { api, useApi } from '../lib/api';
import { Button, Field, Icon, Modal, Select, useToast } from './ui';
import type { PrintPreviewPayload, PrintTemplateId, PrinterProfileDto } from '@shared/contract';

/**
 * Reusable print preview + print/PDF runner. The preview shows the exact HTML
 * the print engine sends to the hidden window (identical output by design).
 */
export function PrintPreviewModal({
  open,
  template,
  entityId,
  title,
  range,
  onClose,
}: {
  open: boolean;
  template: PrintTemplateId;
  entityId: number;
  title: string;
  range?: { from: string; to: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const profiles = useApi('printers.profiles', undefined, { enabled: open });
  const [profileId, setProfileId] = useState<number | null>(null);
  const [payload, setPayload] = useState<PrintPreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [systemPrinters, setSystemPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [printer, setPrinter] = useState('');

  useEffect(() => {
    if (open && profiles.data && profileId == null) {
      const def = profiles.data.find((p) => p.isDefault) ?? profiles.data[0];
      if (def) setProfileId(def.id);
    }
  }, [open, profiles.data, profileId]);

  useEffect(() => {
    if (!open || !entityId || profileId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api('print.preview', { template, entityId, profileId, range })
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entityId, template, profileId, range]);

  useEffect(() => {
    if (open) void api('printers.systemPrinters').then(setSystemPrinters).catch(() => setSystemPrinters([]));
  }, [open]);

  const frameHtml = payload?.html ?? '';

  const savePdf = async () => {
    if (!payload || profileId == null) return;
    setPrinting(true);
    try {
      const res = await api('print.run', { template, entityId, profileId, mode: 'pdf', range });
      if (res.ok && res.pdfBase64) {
        const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast.push({ kind: 'success', title: 'PDF saved', msg: a.download });
      } else {
        toast.push({ kind: 'error', title: 'PDF generation failed', msg: res.reason });
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'PDF generation failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setPrinting(false);
    }
  };

  const printNow = async () => {
    if (!payload || profileId == null) return;
    setPrinting(true);
    try {
      const res = await api('print.run', {
        template,
        entityId,
        profileId,
        mode: 'printer',
        printerName: printer || null,
        range,
      });
      if (res.ok) {
        toast.push({ kind: 'success', title: 'Sent to printer' });
      } else {
        toast.push({
          kind: 'error',
          title: 'Printing failed',
          msg: res.reason ?? 'Check that a printer is installed and available, then try again.',
        });
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'Printing failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal open={open} title={<><Icon name="print" size={16} /> {title}</>} onClose={onClose} size="xl">
      <div className="col" style={{ gap: 'var(--sp-4)' }}>
        <div className="toolbar">
          <Field label="Paper profile" style={{ minWidth: 220 }}>
            <Select
              value={profileId ?? ''}
              onChange={(e) => setProfileId(Number(e.target.value))}
              placeholder="Select profile…"
              options={(profiles.data ?? []).map((p: PrinterProfileDto) => ({
                value: p.id,
                label: `${p.name} (${p.paperSize})`,
              }))}
            />
          </Field>
          <Field label="Printer" style={{ minWidth: 220 }}>
            <Select
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              placeholder={systemPrinters.length ? 'System dialog (choose in print dialog)…' : 'No printers detected'}
              options={systemPrinters.map((p) => ({ value: p.name, label: p.name + (p.isDefault ? ' (default)' : '') }))}
            />
          </Field>
          <span style={{ flex: 1 }} />
          <Button icon="refresh" onClick={() => void profiles.refetch()}>
            Refresh profiles
          </Button>
          <Button variant="primary" icon="download" loading={printing} disabled={!payload} onClick={() => void savePdf()}>
            Save as PDF
          </Button>
          <Button variant="primary" icon="print" loading={printing} disabled={!payload} onClick={() => void printNow()}>
            Print
          </Button>
        </div>

        {error ? (
          <div className="alert alert-danger">
            <Icon name="alert" size={16} />
            <div>{error}</div>
          </div>
        ) : null}
        {loading ? (
          <div className="loading-row">
            <span className="spinner" /> Rendering preview…
          </div>
        ) : null}
        {payload ? (
          <div className="preview-stage">
            <div
              className="preview-sheet"
              style={{
                width: `${payload.widthMm}mm`,
                minHeight: `${Math.min(payload.heightMm, 400)}mm`,
                maxWidth: '100%',
              }}
            >
              <iframe
                className="print-preview-frame"
                style={{ height: `${Math.max(360, Math.min(payload.heightMm, 420))}mm`, border: 'none' }}
                srcDoc={frameHtml}
                title="Print preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        ) : !loading && !error ? (
          <div className="loading-row">Select a paper profile to preview.</div>
        ) : null}
        <p className="tiny muted">
          Preview matches the printed output — layouts are rendered at true paper size (A4 / A5 / thermal) instead of
          scaling an A4 page down.
        </p>
      </div>
    </Modal>
  );
}
