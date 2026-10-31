// Reads who is signed in without loading the prototype client, so the client flow stays small.
import type { UserAccount } from '../types/api';

export function readSessionUser(): UserAccount | null {
  try {
    const stored = sessionStorage.getItem('vt_session_user');
    return stored ? (JSON.parse(stored) as UserAccount) : null;
  } catch {
    return null;
  }
}
