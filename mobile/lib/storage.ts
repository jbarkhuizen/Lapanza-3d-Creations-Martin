import * as SecureStore from 'expo-secure-store';

const API_BASE_URL_KEY = 'lapanza_api_base_url';

// No existing mobile-facing env var to inherit (server has no published
// mobile API_BASE_URL) — default to the documented prod admin host, but the
// Settings screen lets staff repoint this at a LAN dev server.
export const DEFAULT_API_BASE_URL = 'https://admin.procomsolutions.co.za';

export async function getStoredApiBaseUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_BASE_URL_KEY);
  } catch {
    return null;
  }
}

export async function setStoredApiBaseUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(API_BASE_URL_KEY, url);
}
