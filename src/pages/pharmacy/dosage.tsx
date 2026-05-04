import { useTranslation } from 'react-i18next';

import { PadDosageCalculator } from '../../components/pharmacy/pad-dosage-calculator';

export function DosagePage() {
  const { t } = useTranslation('pharmacy');

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('dosage.header.title')}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t('dosage.header.subtitle')}</p>
      </div>

      <PadDosageCalculator
        mode="standalone"
        allowPatientSelect
        allowManualAnthropometrics
      />
    </div>
  );
}
