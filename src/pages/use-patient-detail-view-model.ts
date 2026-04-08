import { useMemo } from 'react';
import type { Medication, Patient, PatientMessage, VentilatorSettings, VitalSigns, LatestScores } from '../lib/api';
import { isAntibiotic } from '../lib/antibiotic-codes';

interface MedicationGroups {
  analgesia: Medication[];
  sedation: Medication[];
  nmb: Medication[];
  other: Medication[];
}

interface UsePatientDetailViewModelParams {
  patient: Patient | null;
  medicationGroups: MedicationGroups;
  messages: PatientMessage[];
  vitalSigns: VitalSigns | null;
  ventilator: VentilatorSettings | null;
  latestScores: LatestScores;
}

export function usePatientDetailViewModel({
  patient,
  medicationGroups,
  messages,
  vitalSigns,
  ventilator,
  latestScores,
}: UsePatientDetailViewModelParams) {
  return useMemo(() => {
    const daysAdmitted = patient
      ? Math.floor((new Date().getTime() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const painMedications = medicationGroups.analgesia;
    const sedationMedications = medicationGroups.sedation;
    const nmbMedications = medicationGroups.nmb;
    const otherMedications = [...medicationGroups.other].sort((a, b) => {
      const aIsAbx = isAntibiotic(a) ? 0 : 1;
      const bIsAbx = isAntibiotic(b) ? 0 : 1;
      if (aIsAbx !== bIsAbx) return aIsAbx - bIsAbx;
      const aDate = a.startDate ? new Date(a.startDate).getTime() : Infinity;
      const bDate = b.startDate ? new Date(b.startDate).getTime() : Infinity;
      return aDate - bDate;
    });
    const outpatientMedications = medicationGroups.outpatient || [];

    const painScoreValue = latestScores.pain?.value ?? null;
    const rassScoreValue = latestScores.rass?.value ?? null;
    const painIndication = painScoreValue !== null
      ? `Pain Score: ${painScoreValue}/10`
      : painMedications[0]?.indication;
    const sedationIndication = rassScoreValue !== null
      ? `RASS Score: ${rassScoreValue >= 0 ? `+${rassScoreValue}` : rassScoreValue}/+4`
      : sedationMedications[0]?.indication;
    const nmbIndication = nmbMedications[0]?.indication;
    const unreadMessagesCount = messages.filter((message) => !message.isRead).length;

    return {
      daysAdmitted,
      unreadMessagesCount,
      painMedications,
      sedationMedications,
      nmbMedications,
      otherMedications,
      outpatientMedications,
      painScoreValue,
      rassScoreValue,
      painIndication,
      sedationIndication,
      nmbIndication,
      respiratoryRate: vitalSigns?.respiratoryRate,
      temperature: vitalSigns?.temperature,
      systolicBP: vitalSigns?.bloodPressure?.systolic,
      diastolicBP: vitalSigns?.bloodPressure?.diastolic,
      heartRate: vitalSigns?.heartRate,
      spo2: vitalSigns?.spo2,
      cvp: vitalSigns?.cvp,
      icp: vitalSigns?.icp,
      ventTimestamp: ventilator?.timestamp,
      ventMode: ventilator?.mode,
      ventFiO2: ventilator?.fio2,
      ventPeep: ventilator?.peep,
      ventTidalVolume: ventilator?.tidalVolume,
      ventRespRate: ventilator?.respiratoryRate,
      ventPip: ventilator?.pip,
      ventPlateau: ventilator?.plateau,
      ventCompliance: ventilator?.compliance,
    };
  }, [latestScores, medicationGroups, messages, patient, ventilator, vitalSigns]);
}
