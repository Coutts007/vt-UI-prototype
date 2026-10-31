import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { UserAccount } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import {
  Search,
  MapPin,
  Star,
  Clock,
  Tag,
  ShieldCheck,
  Scissors,
  Copy,
  Check,
  ArrowRight,
  MessageCircle,
  PlusCircle,
  Info,
  X,
  ExternalLink,
} from 'lucide-react';

interface BusinessDirectoryViewProps {
  onNavigate: (path: string) => void;
}

export const BusinessDirectoryView: React.FC<BusinessDirectoryViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [businesses, setBusinesses] = useState<UserAccount[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('all');
  const [selectedArea, setSelectedArea] = useState('all');
  const [loading, setLoading] = useState(true);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [detailModalTailor, setDetailModalTailor] = useState<UserAccount | null>(null);

  const loadBusinesses = async () => {
    setLoading(true);
    try {
      const data = await api.getPublicBusinesses(search, selectedSpecialty, selectedArea);
      setBusinesses(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBusinesses();
  }, [search, selectedSpecialty, selectedArea]);

  const handleCopyCode = (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const handleSelectAndMeasure = (code: string) => {
    onNavigate(`/start?code=${code}`);
  };

  const handleWhatsAppInquiry = (e: React.MouseEvent, tailor: UserAccount) => {
    e.stopPropagation();
    const phone = tailor.phone?.replace(/[^0-9]/g, '') || '254712345678';
    const text = encodeURIComponent(
      `Hello ${tailor.business_name}, I found your workshop on Virtual Tailor. I would like to get my body measurements taken with my phone using code ${tailor.public_client_code || ''} for my order.`
    );
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const specialtiesList = [
    { id: 'all', label: 'All Specialties' },
    { id: 'Kitenge', label: 'Kitenge & African Wear' },
    { id: 'Suits', label: 'Bespoke Suits & Shirts' },
    { id: 'Dresses', label: 'Dresses & Bridal' },
    { id: 'Modest', label: 'Modest & Coastal Wear' },
    { id: 'Uniforms', label: 'Uniforms' },
  ];

  const locationsList = [
    { id: 'all', label: 'All Locations' },
    { id: 'Gikomba', label: 'Gikomba' },
    { id: 'CBD', label: 'Nairobi CBD' },
    { id: 'Westlands', label: 'Westlands' },
    { id: 'Eastleigh', label: 'Eastleigh' },
    { id: 'Mombasa', label: 'Mombasa' },
    { id: 'Kisumu', label: 'Kisumu' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs uppercase font-bold tracking-wider text-[var(--vt-thread,#2E3A87)] bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
              Verified Fundi Network
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('directoryTitle')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-1 max-w-2xl leading-relaxed">
            {t('directorySubtitle')}
          </p>
        </div>

        {/* Business Registration Callout Button */}
        <div className="shrink-0 flex items-center">
          <Button
            variant="outline"
            size="md"
            onClick={() => onNavigate('/register')}
            icon={<PlusCircle className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />}
            className="shadow-2xs text-xs sm:text-sm"
          >
            {t('registerBusiness')}
          </Button>
        </div>
      </div>

      {/* Search and Filters Strip */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs mb-8 space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tailors by name, area (e.g. Gikomba, Westlands, Mombasa), or specialties…"
            className="w-full h-12 pl-10 pr-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-[#FDFBF7] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)] focus:bg-white transition-colors"
          />
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
          {/* Specialty Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {specialtiesList.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSpecialty(s.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  selectedSpecialty === s.id
                    ? 'bg-[var(--vt-thread,#2E3A87)] text-white shadow-2xs'
                    : 'bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Location Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <MapPin className="w-4 h-4 text-slate-600" />
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="h-9 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-xs font-medium text-[var(--vt-ink,#1F1C18)] outline-none"
            >
              {locationsList.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Directory Grid */}
      {loading ? (
        <div className="p-16 text-center text-sm text-slate-600">Loading tailoring workshops…</div>
      ) : businesses.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <Scissors className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
            No tailoring workshops match your search
          </h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6">
            Try adjusting your specialty or location filters, or browse all workshops.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setSearch('');
              setSelectedSpecialty('all');
              setSelectedArea('all');
            }}
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {businesses.map((tailor) => {
            const code = tailor.public_client_code || 'MW1000';
            const isCopied = copiedCode === code;

            return (
              <div
                key={tailor.user_id}
                onClick={() => setDetailModalTailor(tailor)}
                className="p-5 sm:p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex flex-col justify-between shadow-2xs hover:shadow-md group"
              >
                <div>
                  {/* Workshop Title & Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h2 className="font-bold text-base text-[var(--vt-ink,#1F1C18)] group-hover:text-[var(--vt-thread,#2E3A87)] transition-colors leading-snug">
                        {tailor.business_name}
                      </h2>
                      <div className="flex items-center gap-1.5 text-xs text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        <span className="truncate">{tailor.area}</span>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      Verified
                    </span>
                  </div>

                  {/* Rating, Reviews & Turnaround */}
                  <div className="flex items-center gap-3 text-xs text-[var(--vt-ink-muted,#5C554C)] mb-3">
                    <span className="flex items-center gap-1 font-bold text-amber-700">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {tailor.rating ? tailor.rating.toFixed(1) : '4.9'}
                      <span className="font-normal text-[var(--vt-ink-muted,#5C554C)]">
                        ({tailor.reviews_count || 45})
                      </span>
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-600" />
                      {tailor.turnaround_days || '5-7 days'}
                    </span>
                    {tailor.pricing_tier && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-slate-700">{tailor.pricing_tier}</span>
                      </>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-[var(--vt-ink,#1F1C18)]/80 line-clamp-2 leading-relaxed mb-4">
                    {tailor.description || 'Professional bespoke tailoring and alterations.'}
                  </p>

                  {/* Specialties Pills */}
                  {tailor.specialties && tailor.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {tailor.specialties.slice(0, 3).map((spec, i) => (
                        <span
                          key={i}
                          className="text-[11px] font-medium bg-[#FAF8F5] text-[var(--vt-ink,#1F1C18)] px-2 py-0.5 rounded-md border border-[var(--vt-line,#DDD5C8)]/70"
                        >
                          {spec}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Specific Client Code & Action Box */}
                <div className="pt-4 border-t border-[var(--vt-line,#DDD5C8)]/70 space-y-3">
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--vt-ink-muted,#5C554C)] block">
                        Specific Client Code
                      </span>
                      <span className="font-mono font-black text-lg text-[var(--vt-thread,#2E3A87)]">
                        {code}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleCopyCode(e, code)}
                      className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white text-xs font-semibold text-[var(--vt-thread,#2E3A87)] hover:bg-indigo-50 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Copy specific client code"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectAndMeasure(code);
                      }}
                      icon={<ArrowRight className="w-4 h-4" />}
                      className="flex-1 text-xs font-semibold"
                    >
                      {t('measureWithTailor')}
                    </Button>

                    <button
                      type="button"
                      onClick={(e) => handleWhatsAppInquiry(e, tailor)}
                      className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                      title="WhatsApp Inquiry"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Workshop Detail Modal */}
      {detailModalTailor && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-[var(--vt-line,#DDD5C8)] space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Verified Workshop
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-[var(--vt-ink,#1F1C18)]">
                  {detailModalTailor.business_name}
                </h3>
                <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {detailModalTailor.address || detailModalTailor.area}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setDetailModalTailor(null)}
                className="p-2 rounded-lg text-slate-600 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--vt-ink-muted,#5C554C)]">Location Area:</span>
                <span className="font-semibold">{detailModalTailor.area}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--vt-ink-muted,#5C554C)]">Average Turnaround:</span>
                <span className="font-semibold">{detailModalTailor.turnaround_days || '5-7 days'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--vt-ink-muted,#5C554C)]">Pricing Tier:</span>
                <span className="font-semibold">{detailModalTailor.pricing_tier || 'Mid-Range'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--vt-ink-muted,#5C554C)]">Client Satisfaction:</span>
                <span className="font-semibold text-amber-700">
                  {detailModalTailor.rating?.toFixed(1) || '4.9'} / 5.0 ({detailModalTailor.reviews_count || 45} reviews)
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] mb-1.5">
                About the Workshop
              </h4>
              <p className="text-xs sm:text-sm text-[var(--vt-ink,#1F1C18)] leading-relaxed">
                {detailModalTailor.description}
              </p>
            </div>

            {detailModalTailor.specialties && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] mb-1.5">
                  Tailoring Specialties
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {detailModalTailor.specialties.map((s, i) => (
                    <span
                      key={i}
                      className="text-xs font-medium bg-indigo-50 text-[var(--vt-thread,#2E3A87)] px-2.5 py-1 rounded-lg border border-indigo-100"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Specific Code Callout */}
            <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-200 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block">
                  Tailor Specific Code
                </span>
                <span className="font-mono font-black text-2xl text-[var(--vt-thread,#2E3A87)]">
                  {detailModalTailor.public_client_code || 'MW1000'}
                </span>
              </div>

              <Button
                size="md"
                onClick={() => {
                  const c = detailModalTailor.public_client_code || 'MW1000';
                  setDetailModalTailor(null);
                  handleSelectAndMeasure(c);
                }}
                icon={<ArrowRight className="w-4 h-4" />}
              >
                Measure with this Code
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
