// The specialties a tailor can publish (D27). Mirrors the Specialty enum in the contract.
import type { components } from '@vt/contracts';
import type { TranslationKey } from '../i18n/en';

export type Specialty = components['schemas']['Specialty'];

export const SPECIALTIES: Specialty[] = [
  'kitenge',
  'suits',
  'dresses',
  'modest',
  'uniforms',
  'alterations',
  'traditional',
  'casual',
];

export const specialtyKey = (value: Specialty) => `specialty_${value}` as TranslationKey;
