// Helpers for the client tests against the real API. The listing is the seed's first tailor.
import type { APIRequestContext } from '@playwright/test';

const LISTING = 'f999a691-e61b-5a4e-b94a-f0144f1d17e0';

export async function freshCode(request: APIRequestContext): Promise<string> {
  const reply = await request.post(`/api/v1/tailors/${LISTING}/codes`);
  if (reply.status() !== 201) throw new Error(`Could not issue a code: ${reply.status()}`);
  return (await reply.json()).client_code;
}
