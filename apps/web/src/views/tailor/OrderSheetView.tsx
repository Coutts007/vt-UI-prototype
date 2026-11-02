// Asks the server for the sheet. The server renders it in M10; until then this answers honestly.
import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { BackLink, Card, hintClass, Title } from './common';
import { useTailorText } from './tailorText';

export const OrderSheetView: React.FC<{ orderId: string; onNavigate: (path: string) => void }> = ({ orderId, onNavigate }) => {
  const tx = useTailorText();
  const [includeName, setIncludeName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<{ png_url: string; pdf_url: string; share_text: string } | null>(null);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setSheet(
        await apiClient.post('/orders/{order_id}/sheets', {
          path: { order_id: orderId },
          body: { include_name: includeName },
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto">
      <BackLink onClick={() => onNavigate(`/t/orders/${orderId}`)} label={tx('back')} />
      <Title>{tx('sheetTitle')}</Title>
      <Card>
        <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5" checked={includeName} onChange={(e) => setIncludeName(e.target.checked)} />
          {tx('sheetIncludeName')}
        </label>
        <p className={hintClass}>{tx('sheetNameNote')}</p>
        <Button loading={busy} onClick={generate}>{tx('sheetGenerate')}</Button>
        {failed && <p role="alert" className="text-sm text-rose-800">{tx('sheetFailed')}</p>}
        {sheet && (
          <div className="flex flex-col gap-2">
            <pre className="text-xs whitespace-pre-wrap">{sheet.share_text}</pre>
            <a className="underline min-h-[48px] inline-flex items-center" href={sheet.png_url}>{tx('sheetDownloadPng')}</a>
            <a className="underline min-h-[48px] inline-flex items-center" href={sheet.pdf_url}>{tx('sheetDownloadPdf')}</a>
          </div>
        )}
      </Card>
    </div>
  );
};
