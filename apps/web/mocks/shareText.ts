// The WhatsApp share text, built exactly as the API's services/share_text.py builds it (backend-spec 13).
// Both read their labels from packages/contracts/share-text.json and are tested against its cases.
import fixture from '../../../packages/contracts/share-text.json';

type Locale = 'en' | 'sw';
type Labels = (typeof fixture.labels)['en'];

export interface ShareItem {
  site_code: string;
  body_mm: number | null;
  flag: 'pass' | 'check' | 'fail';
  pending_fitting: boolean;
}

export interface ShareInput {
  locale: Locale;
  unit: 'cm' | 'in';
  client_code: string;
  name: string | null;
  profile_version: number;
  /** YYYY-MM-DD, the capture date in Nairobi. */
  captured_on: string;
  garment_type: string;
  /** YYYY-MM-DD */
  due_date: string;
  items: ShareItem[];
}

const SEP = ' · ';

/** One line of plain text, as the API's clean_name: controls become spaces, runs of space one. */
export function cleanName(name: string | null): string | null {
  if (name === null) return null;
  const words = name.replace(/\p{C}/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length ? words.join(' ') : null;
}

export function formatLength(mm: number, unit: 'cm' | 'in'): string {
  if (unit === 'cm') return `${Math.floor(mm / 10)}.${mm % 10} cm`;
  // round(mm * 8 / 25.4) in whole numbers; whole millimetres never fall exactly half way.
  const eighths = Math.floor((mm * 160 + 254) / 508);
  const whole = Math.floor(eighths / 8);
  let numerator = eighths % 8;
  if (numerator === 0) return `${whole} in`;
  let denominator = 8;
  while (numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = `${numerator}/${denominator}`;
  return whole === 0 ? `${fraction} in` : `${whole} ${fraction} in`;
}

export function formatDate(isoDay: string, locale: Locale): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  return `${day} ${fixture.labels[locale].months[month - 1]} ${year}`;
}

export function buildShareText(data: ShareInput): string {
  const labels: Labels = fixture.labels[data.locale];
  const garments = labels.garments as Record<string, string>;
  const names = labels.site_names as Record<string, string>;
  const head = [
    labels.brand,
    `${labels.client} ${data.client_code}`,
    ...(cleanName(data.name) ? [cleanName(data.name)] : []),
    `${labels.profile} v${data.profile_version} (${formatDate(data.captured_on, data.locale)})`,
    garments[data.garment_type],
    `${labels.due} ${formatDate(data.due_date, data.locale)}`,
  ];
  const lines = [head.join(SEP)];
  const order = fixture.sites;
  const items = [...data.items].sort(
    (a, b) => order.indexOf(a.site_code) - order.indexOf(b.site_code),
  );
  for (const item of items) {
    const name = names[item.site_code];
    if (item.pending_fitting) lines.push(`${name}: ${labels.pending_fitting}`);
    else if (item.body_mm === null) lines.push(`${name}: ${labels.not_measured}`);
    else {
      const mark = item.flag === 'pass' ? labels.pass : labels.check;
      lines.push(`${name} ${formatLength(item.body_mm, data.unit)} ${mark}`);
    }
  }
  lines.push(labels.no_photo);
  return lines.join('\n');
}
