// Base URL of the sample API. Empty in dev/preview (Vite proxies /api). Public value only; never put secrets here.
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const apiUrl = (path: string) => `${API_BASE}${path}`;
