import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("silat_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function requestCarriedToken(config) {
  const headers = config?.headers;
  if (!headers) return false;
  if (typeof headers.get === "function") {
    const fromGet = headers.get("Authorization");
    if (typeof fromGet === "string" && fromGet.trim()) return true;
  }
  const direct = headers.Authorization || headers.authorization;
  return typeof direct === "string" && direct.trim().length > 0;
}

api.interceptors.response.use(
  (r) => r,
  (e) => {
    const url = String(e?.config?.url || "");
    const loginCall = url.includes("/auth/login");
    if (e?.response?.status === 401 && requestCarriedToken(e.config) && !loginCall) {
      localStorage.removeItem("silat_token");
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
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
