'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import {
  applyDisplayPrefs,
  defaultDisplayPrefs,
  readDisplayPrefs,
  type DisplayPrefs,
} from '@/lib/display-prefs';

const scales = [0.9, 1, 1.15, 1.3];

/** "Aa" menu: text size, theme and contrast, remembered in this browser. */
export function DisplaySettings({ locale }: { locale: Locale }) {
  const t = getMessages(locale).display;
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<DisplayPrefs>(defaultDisplayPrefs);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setPrefs(readDisplayPrefs()), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.parentElement?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const update = (patch: Partial<DisplayPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyDisplayPrefs(next);
  };

  return (
    <div className="popover-anchor">
      <button
        className="icon-button"
        type="button"
        aria-expanded={open}
        aria-controls="display-settings"
        aria-label={t.title}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" style={{ fontFamily: 'var(--serif)', fontWeight: 800 }}>
          Aa
        </span>
      </button>
      {open ? (
        <div
          className="popover"
          id="display-settings"
          ref={panel}
          role="dialog"
          aria-label={t.title}
        >
          <p className="popover__title">{t.title}</p>
          <div className="field">
            {t.textSize}
            <div className="segmented" role="group" aria-label={t.textSize}>
              {scales.map((scale, index) => (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={prefs.scale === scale}
                  onClick={() => update({ scale })}
                  style={{ fontSize: `${0.8 + index * 0.15}rem` }}
                >
                  A
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            {t.theme}
            <div className="segmented" role="group" aria-label={t.theme}>
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  aria-pressed={prefs.theme === theme}
                  onClick={() => update({ theme })}
                >
                  {t.themes[theme]}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={prefs.contrast === 'high'}
              onChange={(e) => update({ contrast: e.target.checked ? 'high' : 'normal' })}
            />
            {t.contrast}
          </label>
          <button className="text-button" type="button" onClick={() => setOpen(false)}>
            {t.close}
          </button>
        </div>
      ) : null}
    </div>
  );
}
