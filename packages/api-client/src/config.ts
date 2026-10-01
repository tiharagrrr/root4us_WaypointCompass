/** Runtime settings for compassFetch. The web app sets baseUrl from VITE_API_BASE at startup. */
export interface ApiConfig {
  /** Origin prefixed to every request; empty for same-origin (/api/v1 through the proxy). */
  baseUrl: string;
}

export const apiConfig: ApiConfig = { baseUrl: '' };

export const configureApi = (config: Partial<ApiConfig>): void => {
  Object.assign(apiConfig, config);
};
