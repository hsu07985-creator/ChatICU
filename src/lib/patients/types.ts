import type { Patient } from '../../lib/api';

export const ICU_DEPARTMENTS = ['內科-李穎灝', '內科-黃英哲', '外科'] as const;

export interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}

export interface NewPatientFormData {
  bedNumber: string;
  medicalRecordNumber: string;
  name: string;
  gender: '男' | '女';
  age: string;
  attendingPhysician: string;
  department: string;
  diagnosis: string;
  admissionDate: string;
  icuAdmissionDate: string;
  ventilatorDays: string;
  intubated: boolean;
  intubationDate: string;
  tracheostomy: boolean;
  tracheostomyDate: string;
  hasDNR: boolean;
  isIsolated: boolean;
  sedation: string;
  analgesia: string;
  nmb: string;
}

export function createDefaultNewPatient(): NewPatientFormData {
  return {
    bedNumber: '',
    medicalRecordNumber: '',
    name: '',
    gender: '男',
    age: '',
    attendingPhysician: '',
    department: '',
    diagnosis: '',
    admissionDate: '',
    icuAdmissionDate: '',
    ventilatorDays: '',
    intubated: false,
    intubationDate: '',
    tracheostomy: false,
    tracheostomyDate: '',
    hasDNR: false,
    isIsolated: false,
    sedation: '',
    analgesia: '',
    nmb: '',
  };
}
