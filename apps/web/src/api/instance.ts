// The one contract client the client screens share (A2, frontend-spec 20).
import { ApiClient, createApiClient } from './http';

export const apiClient: ApiClient = createApiClient();
