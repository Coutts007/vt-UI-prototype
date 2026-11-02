import React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { hintClass, Title } from '../tailor/common';
import { useTailorText } from '../tailor/tailorText';

export const PendingApprovalView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const tx = useTailorText();
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center flex flex-col items-center gap-4">
      <Clock aria-hidden="true" className="w-8 h-8" />
      <Title>{tx('pendingTitle')}</Title>
      <p className={hintClass}>{tx('pendingBody')}</p>
      <Button onClick={() => onNavigate('/login')} size="lg" className="w-full">{tx('backToLogin')}</Button>
    </main>
  );
};
