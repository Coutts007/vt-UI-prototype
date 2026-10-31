// The versioned consent text (frontend-spec 9.3). Change the version with any change to the words.
// [CONFIRM] Contact details are placeholders until the owner supplies them (D24).
export const CONSENT_VERSION = '1.0';

export interface ConsentText {
  opening: string[];
  full: { heading: string; body: string }[];
}

export const CONSENT: Record<'en' | 'sw', ConsentText> = {
  en: {
    opening: [
      'Virtual Tailor works out your tailoring measurements from photos taken by this phone.',
      'The photos are looked at on this phone only. They are never sent anywhere, and they are removed from the phone as soon as your measurements are worked out.',
      'Only the numbers go to your tailor: your measurements, your code, and details about the capture such as the phone type.',
    ],
    full: [
      {
        heading: 'What we do',
        body: 'The phone finds the outline of your body and the measuring sheet in its photos, then calculates eight tailoring measurements and your height.',
      },
      {
        heading: 'Who keeps what',
        body: 'Your tailor keeps your measurements so they can make your clothes. Photos and body outlines as pictures are not kept by anyone. Width numbers along your outline are sent with your measurements.',
      },
      {
        heading: 'How long',
        body: 'Your tailor keeps your measurements until you ask for them to be deleted, and for no more than 24 months after your last order.',
      },
      {
        heading: 'Your choice',
        body: 'You do not have to agree. Your tailor can measure you in person with a tape instead.',
      },
    ],
  },
  sw: {
    opening: [
      'Virtual Tailor hupata vipimo vyako vya ushonaji kutoka kwa picha zinazopigwa na simu hii.',
      'Picha hutazamwa kwenye simu hii pekee. Hazitumwi popote, na huondolewa kwenye simu mara tu vipimo vyako vinapopatikana.',
      'Nambari pekee ndizo zinazoenda kwa fundi wako: vipimo vyako, nambari yako, na maelezo ya upigaji picha kama aina ya simu.',
    ],
    full: [
      {
        heading: 'Tunachofanya',
        body: 'Simu hutafuta umbo la mwili wako na karatasi ya kupimia kwenye picha, kisha hukokotoa vipimo vinane vya ushonaji na urefu wako.',
      },
      {
        heading: 'Nani anahifadhi nini',
        body: 'Fundi wako huhifadhi vipimo vyako ili akushonee nguo. Hakuna anayehifadhi picha wala umbo la mwili kama picha. Nambari za upana kando ya umbo lako hutumwa pamoja na vipimo vyako.',
      },
      {
        heading: 'Kwa muda gani',
        body: 'Fundi wako huhifadhi vipimo vyako hadi utakapoomba vifutwe, na si zaidi ya miezi 24 baada ya oda yako ya mwisho.',
      },
      {
        heading: 'Uamuzi ni wako',
        body: 'Si lazima ukubali. Fundi wako anaweza kukupima ana kwa ana kwa utepe.',
      },
    ],
  },
};
