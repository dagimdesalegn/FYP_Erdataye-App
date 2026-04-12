import { useCallback, useEffect, useState } from "react";

import {
  type Lang,
  getLang,
  setLang,
  subscribeLangChange,
  t,
} from "@/utils/i18n";

export function useI18n() {
  const [lang, setLangState] = useState<Lang>(getLang());

  useEffect(() => {
    return subscribeLangChange(() => {
      setLangState(getLang());
    });
  }, []);

  const setLanguage = useCallback(async (next: Lang) => {
    await setLang(next);
    setLangState(getLang());
  }, []);

  return { lang, setLanguage, t };
}
