import { useEffect, useState } from 'react';

const STORAGE_KEY = 'drug-library-edit-mode';
const EVENT = 'drug-library-edit-mode-change';

function read(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setEditMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(STORAGE_KEY, '1');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useEditMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => read());
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [on, setEditMode];
}
