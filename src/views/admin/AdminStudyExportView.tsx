import React, { useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Download, FileSpreadsheet, Check, ShieldCheck } from 'lucide-react';

interface AdminStudyExportViewProps {
  onNavigate: (path: string) => void;
}

export const AdminStudyExportView: React.FC<AdminStudyExportViewProps> = ({ onNavigate }) => {
  const [downloadingCaptures, setDownloadingCaptures] = useState(false);
  const [downloadingReference, setDownloadingReference] = useState(false);

  const downloadFile = (content: string, filename: string) => {
    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadCaptures = async () => {
    setDownloadingCaptures(true);
    try {
      const csv = await api.getStudyCapturesCsv();
      downloadFile(csv, `vt_study_captures_${new Date().toISOString().split('T')[0]}.csv`);
    } finally {
      setDownloadingCaptures(false);
    }
  };

  const handleDownloadReference = async () => {
    setDownloadingReference(true);
    try {
      const csv = await api.getStudyReferenceCsv();
      downloadFile(csv, `vt_study_reference_readings_${new Date().toISOString().split('T')[0]}.csv`);
    } finally {
      setDownloadingReference(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          Validation Study Exports
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Download formatted research dataset files compliant with Appendix E schema
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Export 1: Capture Records */}
        <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center mb-3">
              <FileSpreadsheet className="w-5 h-5 stroke-[2.2]" />
            </div>
            <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
              Capture Records CSV
            </h2>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] leading-relaxed mb-6">
              Includes participant codes, check states, scale markers, 8 body measurements with confidence flags, processing latencies, and environmental covariates.
            </p>
          </div>

          <Button
            onClick={handleDownloadCaptures}
            loading={downloadingCaptures}
            size="md"
            icon={<Download className="w-4 h-4" />}
            className="w-full"
          >
            Download Captures CSV
          </Button>
        </div>

        {/* Export 2: Reference Readings */}
        <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center mb-3">
              <FileSpreadsheet className="w-5 h-5 stroke-[2.2]" />
            </div>
            <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
              Reference Readings CSV
            </h2>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] leading-relaxed mb-6">
              Ground-truth manual tape measurements entered by trained measurers A and B (double-blind, 4 readings per site).
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleDownloadReference}
            loading={downloadingReference}
            size="md"
            icon={<Download className="w-4 h-4" />}
            className="w-full"
          >
            Download Reference CSV
          </Button>
        </div>
      </div>
    </div>
  );
};
