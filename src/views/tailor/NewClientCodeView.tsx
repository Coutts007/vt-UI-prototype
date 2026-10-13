import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '../../i18n';
import { api } from '../../api/client';
import { ClientRecord } from '../../types/api';
import { Button } from '../../components/ui/Button';
import { NumberInput } from '../../components/ui/NumberInput';
import {
  Share2,
  Copy,
  Printer,
  Check,
  ChevronLeft,
  Sparkles,
  QrCode as QrIcon,
} from 'lucide-react';

interface NewClientCodeViewProps {
  onNavigate: (path: string) => void;
}

export const NewClientCodeView: React.FC<NewClientCodeViewProps> = ({ onNavigate }) => {
  const { locale, t } = useI18n();

  const [displayName, setDisplayName] = useState('');
  const [height, setHeight] = useState<number>(0);
  const [issuedClient, setIssuedClient] = useState<ClientRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const client = await api.issueClientCode({
        display_name: displayName.trim() || undefined,
        height_mm: height > 0 ? Math.round(height * 10) : undefined,
      });
      setIssuedClient(client);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const deepLink = issuedClient
    ? `${window.location.origin}/start?code=${issuedClient.client_code}`
    : '';

  useEffect(() => {
    if (issuedClient && qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        deepLink,
        { width: 140, margin: 1, color: { dark: '#1F1C18', light: '#FFFFFF' } },
        () => {}
      );
    }
  }, [issuedClient, deepLink]);

  const shareText = issuedClient
    ? `Hello! Please measure yourself for your order with Virtual Tailor: ${deepLink}\nYour code is ${issuedClient.client_code}.\nYou will need: fitted clothes, a measuring sheet, and a chair. Photos stay on your phone.`
    : '';

  const handleShareWhatsApp = () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(deepLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <button
        onClick={() => onNavigate('/t/clients')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 mb-4 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to clients</span>
      </button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {t('issueNewCode')}
      </h1>
      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-6">
        Generate a unique 6-character client code to send to your tailoring customer on WhatsApp.
      </p>

      {!issuedClient ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
            <div>
              <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-1">
                Client Display Name (Optional)
              </label>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-2">
                Only you see this name in your workshop records. Leave blank for full anonymity.
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Amina Mohamed"
                className="w-full h-12 px-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
              />
            </div>

            <div>
              <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-1">
                Measured Stature / Height in cm (Optional)
              </label>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-2">
                If the client is present in your workshop, measure barefoot against a wall.
              </span>
              <NumberInput
                value={height}
                onChange={(val) => setHeight(val)}
                min={120}
                max={220}
                unit="cm"
                placeholder="e.g. 170"
              />
            </div>
          </div>

          <Button type="submit" size="xl" loading={loading} className="w-full">
            Generate Client Code
          </Button>
        </form>
      ) : (
        /* Issued Share Card */
        <div className="flex flex-col items-center gap-6">
          <div className="w-full p-6 sm:p-8 rounded-2xl border-2 border-[var(--vt-thread,#2E3A87)] bg-white text-center shadow-lg">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-2">
              Client Code Generated
            </span>

            <div className="text-4xl sm:text-5xl font-mono font-black text-[var(--vt-thread,#2E3A87)] tracking-wider mb-2">
              {issuedClient.client_code}
            </div>

            {issuedClient.display_name && (
              <span className="text-base font-semibold text-[var(--vt-ink,#1F1C18)] block mb-4">
                {issuedClient.display_name}
              </span>
            )}

            {/* QR Code Canvas */}
            <div className="p-3 bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] rounded-xl inline-block mb-4">
              <canvas ref={qrCanvasRef} className="rounded-md" />
              <span className="text-[10px] font-mono text-[var(--vt-ink-muted,#5C554C)] mt-1 block">
                Scan to measure
              </span>
            </div>

            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] max-w-sm mx-auto leading-relaxed">
              Send this code and link to your customer on WhatsApp so they can measure themselves from home.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
            <Button
              onClick={handleShareWhatsApp}
              size="lg"
              icon={<Share2 className="w-4 h-4 text-emerald-300" />}
              className="w-full sm:flex-1"
            >
              Send on WhatsApp
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={handleCopyLink}
              icon={copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              className="w-full sm:w-auto"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          </div>

          <Button
            variant="text"
            size="sm"
            onClick={() => onNavigate('/t/clients')}
            className="text-xs"
          >
            Back to Client List
          </Button>
        </div>
      )}
    </div>
  );
};
