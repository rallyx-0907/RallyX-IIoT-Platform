import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageSelector, getLanguage, getLocale, setLanguage, t } from './i18n';

afterEach(() => { cleanup(); setLanguage('en'); });

it('switches language, persists the selection and updates document language', () => {
  setLanguage('en'); render(<LanguageSelector />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Ngôn ngữ / Language' }), { target: { value: 'vi' } });
  expect(getLanguage()).toBe('vi');
  expect(getLocale()).toBe('vi-VN');
  expect(localStorage.getItem('rallyx.language')).toBe('vi');
  expect(document.documentElement.lang).toBe('vi');
  expect(t('Live Data')).toBe('Dữ liệu trực tiếp');
});

it('interpolates translated labels without translating user data', () => {
  setLanguage('vi');
  expect(t('Edit {name}', { name: 'Currentcurrent Pump' })).toBe('Sửa Currentcurrent Pump');
  expect(t('Custom equipment label')).toBe('Custom equipment label');
  setLanguage('en');
  expect(t('Edit {name}', { name: 'Bơm 1' })).toBe('Edit Bơm 1');
});

it('defaults to Vietnamese for a browser without a saved preference', async () => {
  localStorage.removeItem('rallyx.language');
  vi.resetModules();
  const fresh = await import('./i18n');
  expect(fresh.getLanguage()).toBe('vi');
  expect(fresh.getLocale()).toBe('vi-VN');
});
