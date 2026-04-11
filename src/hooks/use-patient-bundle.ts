import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  patientsApi,
  labDataApi,
  medicationsApi,
  messagesApi,
  vitalSignsApi,
  ventilatorApi,
  scoresApi,
  type Patient,
  type LabData,
  type Medication,
  type MedicationsResponse,
  type PatientMessage,
  type VitalSigns,
  type VentilatorSettings,
  type WeaningAssessment,
  type LatestScores,
} from '../lib/api';

type PatientBundleLoadMode = 'initial' | 'refresh' | 'auto';

interface MedicationGroups {
  sedation: Medication[];
  analgesia: Medication[];
  nmb: Medication[];
  other: Medication[];
  outpatient: Medication[];
}

const EMPTY_MEDICATION_GROUPS: MedicationGroups = {
  sedation: [],
  analgesia: [],
  nmb: [],
  other: [],
  outpatient: [],
};

const EMPTY_MEDICATION_RESPONSE: MedicationsResponse = {
  medications: [],
  grouped: EMPTY_MEDICATION_GROUPS,
  interactions: [],
};

const EMPTY_MESSAGES_RESPONSE = {
  messages: [],
  total: 0,
  unreadCount: 0,
};

const defaultLabData: LabData = {
  id: '',
  patientId: '',
  timestamp: '',
  biochemistry: {},
  hematology: {},
  coagulation: {},
  bloodGas: {},
  inflammatory: {},
};

function normalizeSanCategory(raw: unknown): 'S' | 'A' | 'N' | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'S' || normalized === 'A' || normalized === 'N') {
    return normalized;
  }
  return null;
}

function deriveMedicationGroups(items: Medication[]): MedicationGroups {
  const grouped: MedicationGroups = {
    sedation: [],
    analgesia: [],
    nmb: [],
    other: [],
    outpatient: [],
  };

  for (const med of items) {
    if (med.sourceType === 'outpatient' || med.sourceType === 'self-supplied') {
      grouped.outpatient.push(med);
    } else {
      const san = normalizeSanCategory(med.sanCategory);
      if (san === 'S') {
        grouped.sedation.push(med);
      } else if (san === 'A') {
        grouped.analgesia.push(med);
      } else if (san === 'N') {
        grouped.nmb.push(med);
      } else {
        grouped.other.push(med);
      }
    }
  }

  return grouped;
}

export function usePatientBundle(id?: string) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError, setPatientError] = useState<string | null>(null);

  const [labData, setLabData] = useState<LabData>(defaultLabData);
  const [labDataLoading, setLabDataLoading] = useState(false);

  const [medicationGroups, setMedicationGroups] = useState<MedicationGroups>(EMPTY_MEDICATION_GROUPS);
  const [medicationsLoading, setMedicationsLoading] = useState(false);

  const [messages, setMessages] = useState<PatientMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [vitalSigns, setVitalSigns] = useState<VitalSigns | null>(null);
  const [vitalSignsLoading, setVitalSignsLoading] = useState(false);

  const [ventilator, setVentilator] = useState<VentilatorSettings | null>(null);
  const [ventilatorLoading, setVentilatorLoading] = useState(false);
  const [weaningAssessment, setWeaningAssessment] = useState<WeaningAssessment | null>(null);
  const [isRefreshingPatientData, setIsRefreshingPatientData] = useState(false);

  const [latestScores, setLatestScores] = useState<LatestScores>({ pain: null, rass: null });

  const loadPatientBundle = useCallback(
    async (mode: PatientBundleLoadMode) => {
      if (!id) return;
      try {
        if (mode === 'initial') {
          setPatientLoading(true);
          setPatientError(null);
        } else if (mode === 'refresh') {
          setIsRefreshingPatientData(true);
        }

        if (mode !== 'auto') {
          setMedicationsLoading(true);
          setMessagesLoading(true);
          setVitalSignsLoading(true);
          setVentilatorLoading(true);
          setLabDataLoading(true);
        }

        const [
          patientData,
          labDataResult,
          medicationsResult,
          messagesResult,
          vitalSignsResult,
          ventilatorResult,
          weaningResult,
          scoresResult,
        ] = await Promise.all([
          patientsApi.getPatient(id),
          labDataApi.getLatestLabData(id).catch(() => defaultLabData),
          medicationsApi.getMedications(id, { status: 'all' }).catch(() => EMPTY_MEDICATION_RESPONSE),
          messagesApi.getMessages(id).catch(() => EMPTY_MESSAGES_RESPONSE),
          vitalSignsApi.getLatestVitalSigns(id).catch(() => null),
          ventilatorApi.getLatestVentilatorSettings(id).catch(() => null),
          ventilatorApi.getWeaningAssessment(id).catch(() => null),
          scoresApi.getLatestScores(id).catch(() => ({ pain: null, rass: null } as LatestScores)),
        ]);

        setPatient(patientData);
        setLabData(labDataResult);
        setMedicationGroups(
          medicationsResult.grouped || deriveMedicationGroups(medicationsResult.medications),
        );
        setMessages(messagesResult.messages);
        setUnreadCount(messagesResult.unreadCount);
        setVitalSigns(vitalSignsResult);
        setVentilator(ventilatorResult);
        setWeaningAssessment(weaningResult);
        setLatestScores(scoresResult);

        if (mode === 'refresh') {
          toast.success('已更新患者數值');
        }
      } catch (err) {
        console.error('載入病人資料失敗:', err);
        if (mode === 'initial') {
          setPatientError('無法載入病人資料');
        } else if (mode === 'refresh') {
          toast.error('更新患者數值失敗，請確認網路與後端服務狀態');
        }
      } finally {
        if (mode === 'initial') {
          setPatientLoading(false);
        } else if (mode === 'refresh') {
          setIsRefreshingPatientData(false);
        }
        if (mode !== 'auto') {
          setMedicationsLoading(false);
          setMessagesLoading(false);
          setVitalSignsLoading(false);
          setVentilatorLoading(false);
          setLabDataLoading(false);
        }
      }
    },
    [id],
  );

  const refreshMessagesOnly = useCallback(async () => {
    if (!id) return;
    try {
      setMessagesLoading(true);
      const res = await messagesApi.getMessages(id);
      setMessages(res.messages);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      console.error('重新載入留言失敗:', err);
      toast.error('重新載入留言失敗');
    } finally {
      setMessagesLoading(false);
    }
  }, [id]);

  const refreshScores = useCallback(async () => {
    if (!id) return;
    try {
      const result = await scoresApi.getLatestScores(id);
      setLatestScores(result);
    } catch {
      // silent — score refresh is non-critical
    }
  }, [id]);

  const prependMessage = useCallback((message: PatientMessage) => {
    setMessages((prev) => [message, ...prev]);
  }, []);

  useEffect(() => {
    void loadPatientBundle('initial');
  }, [loadPatientBundle]);

  return {
    patient,
    patientLoading,
    patientError,
    labData,
    labDataLoading,
    medicationGroups,
    medicationsLoading,
    messages,
    messagesLoading,
    unreadCount,
    vitalSigns,
    vitalSignsLoading,
    ventilator,
    ventilatorLoading,
    weaningAssessment,
    isRefreshingPatientData,
    latestScores,
    loadPatientBundle,
    refreshScores,
    refreshMessagesOnly,
    prependMessage,
  };
}
