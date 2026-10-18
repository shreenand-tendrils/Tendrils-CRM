
import axios from "axios";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:4000"
).replace(/\/+$/, "");

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event("tendrils:unauthorized"));
    }

    return Promise.reject(error);
  }
);

export const authUrl = `${API_URL}/auth/signin/google`;
