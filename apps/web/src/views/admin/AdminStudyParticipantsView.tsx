import React, { useState, useEffect } from 'react';
import { StudyParticipant } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Plus, User, CheckCircle2, ChevronRight, Beaker } from 'lucide-react';

interface AdminStudyParticipantsViewProps {
  onNavigate: (path: string) => void;
}

export const AdminStudyParticipantsView: React.FC<AdminStudyParticipantsViewProps> = ({
  onNavigate,
}) => {
  const [participants, setParticipants] = useState<StudyParticipant[]>([]);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [sex, setSex] = useState<'female' | 'male' | 'unspecified'>('female');
  const [ageBand, setAgeBand] = useState<'18-24' | '25-34' | '35-44' | '45-54' | '55+'>('25-34');
  const [venue, setVenue] = useState('MKU Thika Campus Lab');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadList();
  }, []);

  const loadList = async () => {
    setLoading(true);
    const data = await api.getStudyParticipants();
    setParticipants(data);
    setLoading(false);
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.enrollParticipant({ sex, age_band: ageBand, venue });
    setShowEnrollModal(false);
    loadList();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            Study Participants (N=90 Cohort)
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Validation study enrollment under Mount Kenya University IERC Protocol
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => onNavigate('/admin/study/export')}
            variant="outline"
            size="sm"
          >
            Exports
          </Button>

          <Button
            onClick={() => setShowEnrollModal(true)}
            icon={<Plus className="w-4 h-4" />}
            size="sm"
          >
            Enroll Participant
          </Button>
        </div>
      </div>

      {/* Participants List */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white divide-y divide-[var(--vt-line,#DDD5C8)]/50 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Loading participant records…</div>
        ) : participants.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-600">No participants enrolled yet.</div>
        ) : (
          participants.map((p) => (
            <div
              key={p.participant_id}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#FAF8F5]"
            >
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono font-black text-xl text-[var(--vt-thread,#2E3A87)]">
                    {p.participant_code}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 capitalize">
                    {p.sex} · Age {p.age_band}
                  </span>
                </div>
                <div className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  Linked Code: <strong className="font-mono">{p.client_code}</strong> · Venue: {p.venue}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-medium text-[var(--vt-ink-muted,#5C554C)]">
                <span>Sets: <strong>{p.sets_captured}/3</strong></span>
                <span>Readings: <strong>{p.readings_count}/4</strong></span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate(`/study/capture?participant=${p.participant_code}`)}
                >
                  Run Capture
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Enrollment Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleEnroll}
            className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)] space-y-4"
          >
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
              Enroll Study Participant
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
              Assigns next available P### code. No names or phone numbers are ever stored.
            </p>

            <div>
              <label htmlFor="adminstudyparticipantsview-1" className="text-xs font-bold block mb-1">Sex</label>
              <select id="adminstudyparticipantsview-1"
                value={sex}
                onChange={(e) => setSex(e.target.value as any)}
                className="w-full h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs font-semibold"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="unspecified">Unspecified</option>
              </select>
            </div>

            <div>
              <label htmlFor="adminstudyparticipantsview-2" className="text-xs font-bold block mb-1">Age Band</label>
              <select id="adminstudyparticipantsview-2"
                value={ageBand}
                onChange={(e) => setAgeBand(e.target.value as any)}
                className="w-full h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs font-semibold"
              >
                <option value="18-24">18–24</option>
                <option value="25-34">25–34</option>
                <option value="35-44">35–44</option>
                <option value="45-54">45–54</option>
                <option value="55+">55+</option>
              </select>
            </div>

            <div>
              <label htmlFor="adminstudyparticipantsview-3" className="text-xs font-bold block mb-1">Study Venue</label>
              <input id="adminstudyparticipantsview-3"
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEnrollModal(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="flex-1">
                Confirm Enrollment
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
