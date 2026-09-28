// The one way the web app talks to the API.
export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}
export function createApi(baseUrl: string): Api {
  const request = (path: string, init: RequestInit) => fetch(`${baseUrl}${path}`, init).then((r) => r.json());
  return { get: (path) => request(path, {}), post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }) };
}
