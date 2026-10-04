/**
 * Reading preferences (text size, theme, contrast, lite mode) are kept in the
 * browser only. This script runs in <head> before first paint so the page never
 * flashes the wrong theme or size; it is static, so it never varies between users.
 */
export const DISPLAY_PREFS_KEY = 'nm_display';

export interface DisplayPrefs {
  scale: number;
  theme: 'system' | 'light' | 'dark';
  contrast: 'normal' | 'high';
  lite: boolean;
}

export const defaultDisplayPrefs: DisplayPrefs = {
  scale: 1,
  theme: 'system',
  contrast: 'normal',
  lite: false,
};

export const displayPrefsScript = `(function(){try{var p=JSON.parse(localStorage.getItem('${DISPLAY_PREFS_KEY}')||'{}');var d=document.documentElement;if(p.scale)d.style.setProperty('--font-scale',String(p.scale));if(p.theme&&p.theme!=='system')d.dataset.theme=p.theme;if(p.contrast==='high')d.dataset.contrast='high';var c=navigator.connection;if(p.lite===true||(p.lite!==false&&c&&(c.saveData||/2g/.test(c.effectiveType||''))))d.dataset.lite='on';}catch(e){}})();`;

export function readDisplayPrefs(): DisplayPrefs {
  try {
    return {
      ...defaultDisplayPrefs,
      ...JSON.parse(localStorage.getItem(DISPLAY_PREFS_KEY) ?? '{}'),
    };
  } catch {
    return defaultDisplayPrefs;
  }
}

export function applyDisplayPrefs(prefs: DisplayPrefs): void {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(prefs.scale));
  if (prefs.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  if (prefs.contrast === 'high') root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  if (prefs.lite) root.dataset.lite = 'on';
  else delete root.dataset.lite;
  try {
    localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / storage disabled: preferences last for this page only
  }
}
