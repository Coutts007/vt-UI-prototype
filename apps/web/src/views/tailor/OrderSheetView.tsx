// The specification sheet (frontend-spec 13.9, F6). The server renders it; this screen previews,
// shares and prints it, and records each share. The sheet holds numbers only, never a photo.
import React, { useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { BackLink, Card, hintClass, Title } from './common';
import { useTailorText } from './tailorText';

const NAME_DEFAULT_KEY = 'vt_sheet_include_name';
type Via = 'whatsapp_share' | 'wa_link' | 'download' | 'print';
interface SheetLinks {
  sheet_id: string;
  png_url: string;
  pdf_url: string;
  share_text: string;
}

class LinkGone extends Error {}

export function waLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function nameDefault(): boolean {
  try {
    return localStorage.getItem(NAME_DEFAULT_KEY) === '1';
  } catch {
    return false;
  }
}

async function fetchFile(url: string): Promise<Blob> {
  try {
    return await apiClient.sheetFile(url);
  } catch (error) {
    // 403: the 10-minute link expired. 404: the 30-day cleanup removed the file.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) throw new LinkGone();
    throw error;
  }
}

function canShareFiles(): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'sheet.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** A blank tab opened during the tap; null where the browser refuses. */
function blankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

function openIn(tab: Window | null, url: string): void {
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const OrderSheetView: React.FC<{ orderId: string; onNavigate: (path: string) => void }> = ({ orderId, onNavigate }) => {
  const tx = useTailorText();
  const [includeName, setIncludeName] = useState(nameDefault);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'generate' | 'file' | null>(null);
  const [hint, setHint] = useState<'attach' | 'print' | null>(null);
  const [sheet, setSheet] = useState<SheetLinks | null>(null);
  const current = useRef<{ sheet: SheetLinks; includeName: boolean } | null>(null);

  /** A sheet made under the other choice must not be shared, so it goes; the tailor makes a new one. */
  const changeName = (value: boolean) => {
    setIncludeName(value);
    current.current = null;
    setSheet(null);
    setHint(null);
    setFailed(null);
  };

  const generate = async (withName = includeName): Promise<SheetLinks> => {
    const made = await apiClient.post('/orders/{order_id}/sheets', {
      path: { order_id: orderId },
      body: { include_name: withName },
    });
    current.current = { sheet: made, includeName: withName };
    setSheet(made);
    return made;
  };

  const onGenerate = async () => {
    setBusy(true);
    setFailed(null);
    setHint(null);
    try {
      await generate();
    } catch {
      setFailed('generate');
    } finally {
      setBusy(false);
    }
  };

  /** F6: an expired link means the sheet is made again, with the same name choice. */
  const withFile = async (kind: 'png' | 'pdf'): Promise<{ blob: Blob; links: SheetLinks }> => {
    const held = current.current;
    if (!held) throw new LinkGone();
    try {
      return { blob: await fetchFile(kind === 'png' ? held.sheet.png_url : held.sheet.pdf_url), links: held.sheet };
    } catch (error) {
      if (!(error instanceof LinkGone)) throw error;
      const fresh = await generate(held.includeName);
      return { blob: await fetchFile(kind === 'png' ? fresh.png_url : fresh.pdf_url), links: fresh };
    }
  };

  const record = async (links: SheetLinks, via: Via) => {
    try {
      await apiClient.post('/sheets/{sheet_id}/shares', { path: { sheet_id: links.sheet_id }, body: { via } });
    } catch {
      // The share happened; a failed log must not undo it. The generate step is already audited.
    }
  };

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    setHint(null);
    try {
      await work();
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') setFailed('file');
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsApp = () => {
    // Known in the tap itself, so a window for WhatsApp can open before anything is awaited:
    // browsers (Safari above all) block windows opened after an await. Device check pending.
    const sharesFiles = canShareFiles();
    const tab = sharesFiles ? null : blankTab();
    return act(async () => {
      try {
        const { blob, links } = await withFile('png');
        const file = new File([blob], `sheet-${links.sheet_id.slice(0, 8)}.png`, { type: 'image/png' });
        if (sharesFiles && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: links.share_text });
          await record(links, 'whatsapp_share');
          return;
        }
        // No file sharing (most desktop browsers and older iPhones): save the picture, open WhatsApp.
        saveBlob(blob, file.name);
        openIn(tab, waLink(links.share_text));
        setHint('attach');
        await record(links, 'wa_link');
      } catch (error) {
        tab?.close();
        throw error;
      }
    });
  };

  const download = (kind: 'png' | 'pdf') =>
    act(async () => {
      const { blob, links } = await withFile(kind);
      saveBlob(blob, `sheet-${links.sheet_id.slice(0, 8)}.${kind}`);
      await record(links, 'download');
    });

  const print = () => {
    const tab = blankTab();
    return act(async () => {
      try {
        const { blob, links } = await withFile('pdf');
        const url = URL.createObjectURL(blob);
        openIn(tab, url);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setHint('print');
        await record(links, 'print');
      } catch (error) {
        tab?.close();
        throw error;
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto">
      <BackLink onClick={() => onNavigate(`/t/orders/${orderId}`)} label={tx('back')} />
      <Title>{tx('sheetTitle')}</Title>
      <Card>
        <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5" checked={includeName} onChange={(e) => changeName(e.target.checked)} />
          {tx('sheetIncludeName')}
        </label>
        <p className={hintClass}>{tx('sheetNameNote')}</p>
        <Button loading={busy && !sheet} onClick={onGenerate}>
          {sheet ? tx('sheetRegenerate') : tx('sheetGenerate')}
        </Button>
        {failed === 'generate' && <p role="alert" className="text-sm text-rose-800">{tx('sheetFailed')}</p>}
      </Card>
      {sheet && (
        <Card>
          <img
            src={apiClient.sheetFileUrl(sheet.png_url)}
            alt={tx('sheetPreviewAlt')}
            className="w-full h-auto border border-slate-300 bg-white"
            width={1240}
            height={1754}
          />
          <div className="flex flex-col gap-2">
            <Button onClick={shareWhatsApp} disabled={busy}>{tx('sheetShareWhatsApp')}</Button>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => download('png')} disabled={busy}>{tx('sheetDownloadPng')}</Button>
              <Button variant="outline" onClick={() => download('pdf')} disabled={busy}>{tx('sheetDownloadPdf')}</Button>
              <Button variant="outline" onClick={print} disabled={busy}>{tx('sheetPrint')}</Button>
            </div>
          </div>
          {hint && <p role="status" className="text-sm">{tx(hint === 'attach' ? 'sheetAttachHint' : 'sheetPrintHint')}</p>}
          {failed === 'file' && <p role="alert" className="text-sm text-rose-800">{tx('sheetFileFailed')}</p>}
          <details className="text-sm">
            <summary className="cursor-pointer min-h-[48px] flex items-center">{tx('sheetShareText')}</summary>
            <pre className="text-xs whitespace-pre-wrap" data-testid="share-text">{sheet.share_text}</pre>
          </details>
        </Card>
      )}
    </div>
  );
};
