import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Printer, Share2 } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { BackLink, Card, hintClass, inputClass, labelClass, Title } from './common';
import { useTailorText } from './tailorText';

interface Issued {
  client_code: string;
  deep_link: string;
  display_name: string;
}

export const NewClientCodeView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const tx = useTailorText();
  const [name, setName] = useState('');
  const [height, setHeight] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  const centimetres = height.trim() ? Number(height) : null;
  const badHeight = centimetres !== null && !(centimetres >= 120 && centimetres <= 220);
  const link = issued ? `${window.location.origin}${issued.deep_link}` : '';
  const message = issued ? tx('codeMessage', { link, code: issued.client_code }) : '';

  useEffect(() => {
    if (issued && canvas.current) void QRCode.toCanvas(canvas.current, link, { width: 160, margin: 1 });
  }, [issued, link]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (badHeight) return;
    setBusy(true);
    setFailed(false);
    try {
      const reply = await apiClient.post('/clients', {
        body: {
          display_name: name.trim() || null,
          height_mm: centimetres === null ? null : Math.round(centimetres * 10),
        },
      });
      setIssued({ client_code: reply.client_code, deep_link: reply.deep_link, display_name: name.trim() });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const share = () => {
    if (navigator.share) void navigator.share({ text: message }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const copy = () =>
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4">
      <BackLink onClick={() => onNavigate('/t/clients')} label={tx('codeBackToList')} />
      <Title>{tx('codeTitle')}</Title>
      {!issued ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Card>
            <div>
              <label htmlFor="code-name" className={labelClass}>
                {tx('codeNameLabel')}
              </label>
              <input
                id="code-name"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>{tx('codeNameHint')}</p>
            </div>
            <div>
              <label htmlFor="code-height" className={labelClass}>
                {tx('codeHeightLabel')}
              </label>
              <input
                id="code-height"
                inputMode="decimal"
                value={height}
                aria-invalid={badHeight}
                onChange={(event) => setHeight(event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>{tx('codeHeightHint')}</p>
            </div>
          </Card>
          {failed && <p role="alert" className="text-sm text-rose-800">{tx('saveFailed')}</p>}
          <Button type="submit" size="xl" loading={busy} disabled={badHeight} className="w-full">
            {tx('codeSubmit')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4 items-stretch">
          <Card>
            <div className="text-center">
              <p className={hintClass}>{tx('codeReady')}</p>
              <p data-testid="issued-code" className="text-5xl font-mono font-black tracking-wider text-[var(--vt-thread)]">
                {issued.client_code}
              </p>
              {issued.display_name && <p className="font-semibold">{issued.display_name}</p>}
              <canvas ref={canvas} role="img" aria-label={tx('codeQr')} className="mx-auto mt-3" />
            </div>
          </Card>
          <Button size="lg" onClick={share} icon={<Share2 aria-hidden="true" className="w-4 h-4" />}>
            {tx('codeSend')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={copy}
            icon={copied ? <Check aria-hidden="true" className="w-4 h-4" /> : <Copy aria-hidden="true" className="w-4 h-4" />}
          >
            {copied ? tx('codeCopied') : tx('codeCopy')}
          </Button>
          <Button size="lg" variant="outline" onClick={() => window.print()} icon={<Printer aria-hidden="true" className="w-4 h-4" />}>
            {tx('codePrint')}
          </Button>
        </div>
      )}
    </div>
  );
};
