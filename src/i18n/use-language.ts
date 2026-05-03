import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from './config';

export function useLanguage() {
  const { i18n } = useTranslation();
  const current = ((i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage) || DEFAULT_LANGUAGE;

  const setLanguage = (lang: SupportedLanguage) => {
    void i18n.changeLanguage(lang);
  };

  const toggle = () => {
    setLanguage(current === 'zh-TW' ? 'en-US' : 'zh-TW');
  };

  return { current, setLanguage, toggle };
}
