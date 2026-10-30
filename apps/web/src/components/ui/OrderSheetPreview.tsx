import React, { useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { Order, MeasurementProfile } from '../../types/api';
import { Button } from './Button';
import { FlagBadge } from './FlagBadge';
import { Share2, Download, Printer, Check } from 'lucide-react';

interface OrderSheetPreviewProps {
  order: Order;
  profile?: MeasurementProfile | null;
  includeName: boolean;
  onToggleIncludeName: (val: boolean) => void;
  onShareWhatsApp: () => void;
  onDownload: () => void;
  onPrint: () => void;
}

export const OrderSheetPreview: React.FC<OrderSheetPreviewProps> = ({
  order,
  profile,
  includeName,
  onToggleIncludeName,
  onShareWhatsApp,
  onDownload,
  onPrint,
}) => {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        `VT:${order.client_code}:${order.profile_id}`,
        { width: 90, margin: 1, color: { dark: '#1F1C18', light: '#FFFFFF' } },
        () => {}
      );
    }
  }, [order]);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-3xl mx-auto">
      {/* Controls Bar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <label className="flex items-center gap-2.5 text-sm font-medium text-[var(--vt-ink,#1F1C18)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeName}
            onChange={(e) => onToggleIncludeName(e.target.checked)}
            className="w-4 h-4 rounded text-[var(--vt-thread,#2E3A87)] focus:ring-[var(--vt-thread,#2E3A87)]"
          />
          <span>Include client name on sheet &amp; WhatsApp</span>
        </label>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrint} icon={<Printer className="w-4 h-4" />}>
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={onDownload} icon={<Download className="w-4 h-4" />}>
            Download PNG
          </Button>
          <Button variant="primary" size="sm" onClick={onShareWhatsApp} icon={<Share2 className="w-4 h-4" />}>
            Share on WhatsApp
          </Button>
        </div>
      </div>

      {/* A4 Sheet Paper Card (Figure 5.6 compliant) */}
      <div className="w-full bg-white rounded-xl border-2 border-[var(--vt-line,#DDD5C8)] p-6 sm:p-10 shadow-md text-[var(--vt-ink,#1F1C18)] print:border-none print:shadow-none print:p-0">
        {/* Sheet Header */}
        <div className="flex items-start justify-between border-b-2 border-[var(--vt-line,#DDD5C8)] pb-6 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--vt-thread,#2E3A87)]">
                VIRTUAL TAILOR
              </span>
              <span className="text-xs uppercase px-2 py-0.5 rounded bg-slate-100 font-semibold tracking-wider text-slate-700">
                Specification Sheet
              </span>
            </div>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mt-1">
              Garment Cutting &amp; Tailoring Specification Record
            </p>
          </div>

          <div className="text-right">
            <canvas ref={qrCanvasRef} className="rounded-md border border-[var(--vt-line,#DDD5C8)] ml-auto" />
            <span className="text-[10px] font-mono text-[var(--vt-ink-muted,#5C554C)] mt-0.5 block">
              {order.order_no}
            </span>
          </div>
        </div>

        {/* Order & Client Metadata Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)]/70 mb-8 text-sm">
          <div>
            <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">Client Code</span>
            <span className="font-mono font-bold text-base text-[var(--vt-ink,#1F1C18)]">
              {order.client_code}
            </span>
          </div>

          <div>
            <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">Client Name</span>
            <span className="font-semibold text-[var(--vt-ink,#1F1C18)]">
              {includeName && order.display_name ? order.display_name : '— (Anonymous)'}
            </span>
          </div>

          <div>
            <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">Garment Type</span>
            <span className="font-semibold capitalize text-[var(--vt-ink,#1F1C18)]">
              {order.garment_type.replace('_', ' ')}
            </span>
          </div>

          <div>
            <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">Target Due Date</span>
            <span className="font-semibold text-[var(--vt-ink,#1F1C18)]">
              {order.due_date}
            </span>
          </div>
        </div>

        {/* Tailoring Measurements Table */}
        <div className="mb-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] mb-3">
            Garment Dimensions (ISO 8559-1 Compliant)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--vt-line,#DDD5C8)] text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  <th className="py-2.5 font-semibold">Body Measurement Site</th>
                  <th className="py-2.5 font-semibold text-right">Body Size</th>
                  <th className="py-2.5 font-semibold text-right">Ease Allowance</th>
                  <th className="py-2.5 font-semibold text-right">Finished Garment Size</th>
                  <th className="py-2.5 font-semibold text-center">Confidence Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--vt-line,#DDD5C8)]/50">
                {order.items.map((item) => {
                  const bodyCm = item.body_mm ? (item.body_mm / 10).toFixed(1) + ' cm' : '—';
                  const easeCm = (item.ease_mm / 10).toFixed(1) + ' cm';
                  const finishedCm = item.finished_mm
                    ? (item.finished_mm / 10).toFixed(1) + ' cm'
                    : 'Pending fitting';

                  return (
                    <tr key={item.site_code} className="hover:bg-[#FCFAF7]">
                      <td className="py-3 font-medium capitalize">
                        {item.site_code}
                        {item.overridden && (
                          <span className="ml-2 text-[10px] text-amber-700 font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            manual override
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums font-mono text-[var(--vt-ink-muted,#5C554C)]">
                        {bodyCm}
                      </td>
                      <td className="py-3 text-right tabular-nums font-mono text-[var(--vt-ink-muted,#5C554C)]">
                        +{easeCm}
                      </td>
                      <td className="py-3 text-right tabular-nums font-mono font-bold text-base text-[var(--vt-thread,#2E3A87)]">
                        {finishedCm}
                      </td>
                      <td className="py-3 text-center">
                        <FlagBadge flag={item.confidence_flag} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Workshop Notes */}
        {order.notes && (
          <div className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)]/80 bg-[#FCFBF8] mb-8 text-sm">
            <span className="text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] uppercase tracking-wider block mb-1">
              Workshop Notes &amp; Extra Specifications
            </span>
            <p className="text-[var(--vt-ink,#1F1C18)] whitespace-pre-wrap">{order.notes}</p>
          </div>
        )}

        {/* Legal Invariant & Privacy Footer */}
        <div className="border-t-2 border-[var(--vt-line,#DDD5C8)] pt-4 flex flex-col sm:flex-row items-center justify-between text-xs text-[var(--vt-ink-muted,#5C554C)] gap-2">
          <span>
            <strong>Virtual Tailor Guarantee:</strong> No photograph is stored or transmitted.
          </span>
          <span>Compliant with Kenya Data Protection Act, 2019</span>
        </div>
      </div>
    </div>
  );
};
