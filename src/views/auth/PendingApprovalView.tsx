import React from 'react';
import { Button } from '../../components/ui/Button';
import { Clock, CheckCircle2 } from 'lucide-react';

interface PendingApprovalViewProps {
  onNavigate: (path: string) => void;
}

export const PendingApprovalView: React.FC<PendingApprovalViewProps> = ({ onNavigate }) => {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center min-h-[70vh] flex flex-col items-center justify-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mb-6">
        <Clock className="w-8 h-8 stroke-[2.2]" />
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        Waiting for Administrator Approval
      </h1>

      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-8 leading-relaxed">
        Your tailor workshop registration has been received and is queued for verification under FR-21. You will be able to sign in once approved.
      </p>

      <Button onClick={() => onNavigate('/login')} size="lg" className="w-full">
        Return to Login
      </Button>
    </div>
  );
};
