// Per-device identity. Everything is wrapped because storage can throw (private mode, blocked cookies).
const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((f) => f());
export const noopSubscribe = () => () => {};
export const currentOrigin = () => (typeof window === "undefined" ? "" : window.location.origin);

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } emit(); };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } emit(); };

const norm = (c: string) => c.toUpperCase();
export const playerToken = (code: string) => get(`rei:player:${norm(code)}`);
export const savePlayerToken = (code: string, t: string) => set(`rei:player:${norm(code)}`, t);
export const clearPlayerToken = (code: string) => del(`rei:player:${norm(code)}`);
export const adminPass = (code: string) => get(`rei:admin:${norm(code)}`);
export const saveAdminPass = (code: string, p: string) => set(`rei:admin:${norm(code)}`, p.trim().toUpperCase());
export const clearAdminPass = (code: string) => del(`rei:admin:${norm(code)}`);

export const recentRaw = () => get("rei:recent") ?? "[]";
export function recentGames(): { code: string; name: string; at: number }[] {
  try { return JSON.parse(recentRaw()); } catch { return []; }
}
export function rememberGame(code: string, name: string) {
  const list = recentGames().filter((g) => g.code !== norm(code));
  list.unshift({ code: norm(code), name, at: Date.now() });
  set("rei:recent", JSON.stringify(list.slice(0, 6)));
}
