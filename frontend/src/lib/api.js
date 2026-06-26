import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("silat_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e?.response?.status === 401) {
      // optional: clear bad token
      // localStorage.removeItem('silat_token');
    }
    return Promise.reject(e);
  }
);

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || "Terjadi kesalahan";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(", ");
  return String(d);
}

export default api;
