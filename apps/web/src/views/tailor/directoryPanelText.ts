// The words of the tailor's directory panel, in its own lazy chunk: a client's phone never downloads them.
import { useI18n } from '../../i18n';

export const panelEn = {
  listingTitle: 'Tailor directory',
  listingIntro: 'If you list your business, anyone can see its name, area, specialties and description, and get a code for you at once.',
  listingOptIn: 'List my business in the directory',
  listingShowPhone: 'Show my phone number',
  listingSpecialties: 'Specialties',
  listingDescription: 'Short description',
  listingDescriptionHint: 'Up to 240 characters. Anyone can read this.',
  listingSave: 'Save listing',
  listingSaved: 'Saved',
  listingSignIn: 'Sign out and sign in again to change this.',
  listingError: 'Something went wrong. Try again.',
  directoryClientsTitle: 'Clients from the directory',
  directoryClientsHint: 'These codes were taken from the directory, not issued by you. Remove any you do not want.',
  directoryClientsEmpty: 'None yet.',
  directoryClientUsed: 'Has measurements',
  directoryClientUnused: 'Not used yet',
  directoryClientRemove: 'Remove',
  directoryClientConfirm: 'Yes, remove {code}',
  directoryClientHasOrders: 'This client has active orders, so they cannot be removed.',
  directoryClientRetained: 'This client has records that must be kept, so they cannot be removed here.',
  directoryClientMeasuredWarning: 'This client has measurements. Removing {code} deletes their measurements for good. This cannot be undone.',
  directoryClientMeasuredConfirm: 'Yes, delete {code} and the measurements',
  directoryClientsPage: 'Page {page} of {pages}',
  directoryClientsPrevious: 'Previous page',
  directoryClientsNext: 'Next page',
  directoryClientsRemoveUnused: 'Remove unused codes: {count}',
  directoryClientsRemoveUnusedWarning: 'This removes every code with no measurements, no orders and no study record. Anyone still using one will need a new code.',
  directoryClientsRemoveUnusedConfirm: 'Yes, remove them: {count}',
  directoryClientsRemovedUnused: 'Codes removed: {count}',
};

export type PanelKey = keyof typeof panelEn;

export const panelSw: Record<PanelKey, string> = {
  listingTitle: 'Orodha ya mafundi',
  listingIntro: 'Ukiorodhesha biashara yako, yeyote anaweza kuona jina, eneo, utaalamu na maelezo yake, na kupata nambari yako mara moja.',
  listingOptIn: 'Orodhesha biashara yangu',
  listingShowPhone: 'Onyesha nambari yangu ya simu',
  listingSpecialties: 'Utaalamu',
  listingDescription: 'Maelezo mafupi',
  listingDescriptionHint: 'Hadi herufi 240. Yeyote anaweza kusoma haya.',
  listingSave: 'Hifadhi',
  listingSaved: 'Imehifadhiwa',
  listingSignIn: 'Toka kisha uingie tena ili kubadilisha hili.',
  listingError: 'Hitilafu imetokea. Jaribu tena.',
  directoryClientsTitle: 'Wateja kutoka orodha',
  directoryClientsHint: 'Nambari hizi zilichukuliwa kutoka orodha, si wewe uliyezitoa. Ondoa usizozitaka.',
  directoryClientsEmpty: 'Bado hakuna.',
  directoryClientUsed: 'Ana vipimo',
  directoryClientUnused: 'Bado haijatumika',
  directoryClientRemove: 'Ondoa',
  directoryClientConfirm: 'Ndiyo, ondoa {code}',
  directoryClientHasOrders: 'Mteja huyu ana oda zinazoendelea, kwa hiyo hawezi kuondolewa.',
  directoryClientRetained: 'Mteja huyu ana rekodi zinazopaswa kuhifadhiwa, kwa hiyo hawezi kuondolewa hapa.',
  directoryClientMeasuredWarning: 'Mteja huyu ana vipimo. Ukiondoa {code}, vipimo vyake vitafutwa kabisa. Hili haliwezi kutenduliwa.',
  directoryClientMeasuredConfirm: 'Ndiyo, futa {code} na vipimo vyake',
  directoryClientsPage: 'Ukurasa {page} wa {pages}',
  directoryClientsPrevious: 'Ukurasa uliopita',
  directoryClientsNext: 'Ukurasa unaofuata',
  directoryClientsRemoveUnused: 'Ondoa nambari zisizotumika: {count}',
  directoryClientsRemoveUnusedWarning: 'Hii inaondoa kila nambari isiyo na vipimo, oda wala rekodi ya utafiti. Mtu anayeitumia bado atahitaji nambari mpya.',
  directoryClientsRemoveUnusedConfirm: 'Ndiyo, ziondoe: {count}',
  directoryClientsRemovedUnused: 'Nambari zilizoondolewa: {count}',
};

export const usePanelText = () => {
  const { locale } = useI18n();
  return (key: PanelKey, params: Record<string, string | number> = {}) =>
    Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      (locale === 'sw' ? panelSw : panelEn)[key] as string,
    );
};
