// Every spoken message key (A3). A clip per key lives at /audio/{en,sw}/<key>.mp3.
import type { TranslationKey } from '../i18n/en';
import MESSAGES from './messages.json';

export type MessageKey = keyof typeof MESSAGES;
export const MESSAGE_KEYS = Object.keys(MESSAGES) as MessageKey[];

export function messageText(key: MessageKey, locale: 'en' | 'sw'): string {
  return MESSAGES[key][locale];
}

/** Each on-screen correction and the clip that speaks it. Every correction must have one (A3). */
export const CORRECTION_CLIPS: Partial<Record<TranslationKey, MessageKey>> = {
  corrTilt: 'corr_tilt',
  corrStepIn: 'corr_step_in',
  corrHeadCut: 'corr_head_cut',
  corrTooFar: 'corr_too_far',
  corrTooClose: 'corr_too_close',
  corrTurnFace: 'corr_turn_face',
  corrTurnRight: 'corr_turn_right',
  corrArmsAway: 'corr_arms_away',
  corrArmsForward: 'corr_arms_forward',
  corrHoldSheetFlat: 'corr_sheet_flat',
  corrMoveFingers: 'corr_fingers',
  corrStepCloserSheet: 'corr_step_closer',
  corrTooDark: 'corr_too_dark',
  corrTooBright: 'corr_too_bright',
  corrHoldStill: 'hold_still',
};

export const HELP_CLIPS: MessageKey[] = ['help_1', 'help_2', 'help_3', 'help_4', 'help_5'];
