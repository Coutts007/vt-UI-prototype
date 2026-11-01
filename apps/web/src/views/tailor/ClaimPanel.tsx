// Who holds a client code, and what the tailor may do about it (D45). Nothing here is automatic.
import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/feedback';
import { Card, ClientClaim, hintClass, Loading, useDates, useLoad } from './common';
import { TailorKey, useTailorText } from './tailorText';

const REQUEST_STATUS: Record<string, TailorKey> = {
  received: 'requestReceived',
  partially_done: 'requestPartial',
  done: 'requestDone',
  rejected: 'requestRejected',
};

const toggled = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

const Tick: React.FC<{ checked: boolean; onChange: () => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="w-5 h-5" />
    <span>{label}</span>
  </label>
);

export const ClaimPanel: React.FC<{ clientId: string; onChanged: () => void }> = ({ clientId, onChanged }) => {
  const tx = useTailorText();
  const { date } = useDates();
  const url = '/clients/{client_id}/claim' as const;
  const path = { client_id: clientId };
  const { data, setData, failed, reload } = useLoad(() => apiClient.get(url, { path }), [clientId]);
  const [confirming, setConfirming] = useState(false);
  const [supersede, setSupersede] = useState<Set<string>>(new Set());
  const [clear, setClear] = useState<Set<string>>(new Set());
  const [close, setClose] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!data) return <Card title={tx('claimTitle')}><Loading failed={failed} onRetry={reload} /></Card>;

  const act = async (work: () => Promise<ClientClaim>) => {
    setBusy(true);
    setError(false);
    try {
      setData(await work());
      setSupersede(new Set());
      setClear(new Set());
      setClose(new Set());
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const free = () => {
    setConfirming(false);
    void act(() => apiClient.post('/clients/{client_id}/claim/free', { path }));
  };

  const apply = () =>
    void act(() =>
      apiClient.post('/clients/{client_id}/claim/review', {
        path,
        body: {
          supersede_profile_ids: [...supersede],
          clear_consent_ids: [...clear],
          close_request_ids: [...close],
        },
      }),
    );

  const open = !data.claimed;
  const chosen = supersede.size + clear.size + close.size;

  return (
    <Card title={tx('claimTitle')}>
      <p className="text-sm" data-testid="claim-state">
        {data.claimed ? tx('claimHeld') : tx('claimFree')}
      </p>
      <p className={hintClass}>{tx('claimHelp')}</p>
      {data.claimed && (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          {tx('claimFreeButton')}
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-rose-800">{tx('saveFailed')}</p>}

      {data.profiles.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{tx('claimProfiles')}</h3>
          <ul>
            {data.profiles.map((row) => (
              <li key={row.profile_id} className="py-1 border-t border-[var(--vt-line)]">
                <p className="text-sm">
                  v{row.version} · {date(row.received_at)} · {tx('claimRound', { round: row.claim_round + 1 })}
                  {row.claim_round === data.claim_round ? ` (${tx('claimCurrent')})` : ''}
                  {row.status === 'superseded' ? ` · ${tx('statusSuperseded')}` : ''}
                </p>
                {row.on_order ? (
                  <p className={hintClass}>{tx('claimOnOrder')}</p>
                ) : (
                  open &&
                  row.status !== 'superseded' && (
                    <Tick
                      checked={supersede.has(row.profile_id)}
                      onChange={() => setSupersede((set) => toggled(set, row.profile_id))}
                      label={tx('claimSupersede')}
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.withdrawals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{tx('claimWithdrawals')}</h3>
          <p className={hintClass}>{tx('claimWithdrawalWarning')}</p>
          <ul>
            {data.withdrawals.map((row) => (
              <li key={row.consent_id} className="py-1 border-t border-[var(--vt-line)]">
                <p className="text-sm">{tx('claimWithdrawal', { date: date(row.withdrawn_at) })}</p>
                {open && (
                  <Tick
                    checked={clear.has(row.consent_id)}
                    onChange={() => setClear((set) => toggled(set, row.consent_id))}
                    label={tx('claimClearWithdrawal')}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.deletion_requests.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{tx('claimRequests')}</h3>
          <ul>
            {data.deletion_requests.map((row) => (
              <li key={row.request_id} className="py-1 border-t border-[var(--vt-line)]">
                <p className="text-sm">
                  {tx('claimRequest', {
                    reason: tx(row.reason === 'delete' ? 'reasonDelete' : 'reasonWithdraw'),
                    date: date(row.received_at),
                    status: tx(REQUEST_STATUS[row.status]),
                  })}
                </p>
                {row.details_cleared && <p className="text-sm font-semibold text-amber-800">{tx('claimWiped')}</p>}
                {open && row.status === 'received' && (
                  <Tick
                    checked={close.has(row.request_id)}
                    onChange={() => setClose((set) => toggled(set, row.request_id))}
                    label={tx('claimClose')}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.claimed && (data.withdrawals.length > 0 || data.profiles.length > 0) && (
        <p className={hintClass}>{tx('claimFreeFirst')}</p>
      )}
      {open && chosen > 0 && (
        <Button loading={busy} onClick={apply}>
          {tx('claimApply')}
        </Button>
      )}

      <Dialog
        open={confirming}
        title={tx('claimFreeButton')}
        onClose={() => setConfirming(false)}
      >
        <p className="text-sm mb-4">{tx('claimFreeWarning')}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setConfirming(false)}>
            {tx('cancel')}
          </Button>
          <Button variant="danger" onClick={free}>
            {tx('claimFreeConfirm')}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
};
