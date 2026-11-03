import { createApi, type Api } from "./api/client";
export function useServices(): { api: Api } {
  return { api: createApi("/v1") };
}
