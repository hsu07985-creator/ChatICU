import type { CreatePatientData, Patient } from '../../lib/api';
import type { NewPatientFormData, PatientWithFrontendFields } from './types';

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

const splitAndNormalizeDrugList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeDrugList = (value: string[] | undefined): string[] =>
  (value ?? []).map((item) => item.trim()).filter(Boolean);

const normalizeOptionalText = (value: string | null | undefined): string =>
  (value ?? '').trim();

const toValidatedNumber = (value: string | number): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidAge = (age: number | null): age is number =>
  age !== null && age > 0;

export function parseCreatePatientForm(
  form: NewPatientFormData,
): ValidationResult<CreatePatientData> {
  if (!form.bedNumber.trim() || !form.medicalRecordNumber.trim() || !form.name.trim()) {
    return { success: false, message: '請填寫床號、病歷號、姓名' };
  }

  const age = toValidatedNumber(form.age);
  if (!isValidAge(age)) {
    return { success: false, message: '請填寫正確年齡' };
  }

  if (!form.diagnosis.trim()) {
    return { success: false, message: '請填寫入院診斷' };
  }

  const ventilatorDaysValue = form.ventilatorDays.trim();
  const ventilatorDays = ventilatorDaysValue ? toValidatedNumber(ventilatorDaysValue) : 0;
  if (ventilatorDays === null) {
    return { success: false, message: '請填寫正確呼吸器天數' };
  }

  return {
    success: true,
    data: {
      bedNumber: form.bedNumber.trim(),
      medicalRecordNumber: form.medicalRecordNumber.trim(),
      name: form.name.trim(),
      gender: form.gender,
      age,
      diagnosis: form.diagnosis.trim(),
      intubated: form.intubated || form.tracheostomy || Boolean(form.tracheostomyDate),
      intubationDate: form.intubationDate || undefined,
      tracheostomy: form.tracheostomy || Boolean(form.tracheostomyDate),
      tracheostomyDate: form.tracheostomyDate || undefined,
      admissionDate: form.admissionDate || undefined,
      icuAdmissionDate: form.icuAdmissionDate || undefined,
      ventilatorDays,
      attendingPhysician: form.attendingPhysician.trim() || undefined,
      department: form.department.trim() || undefined,
      sedation: form.sedation ? splitAndNormalizeDrugList(form.sedation) : [],
      analgesia: form.analgesia ? splitAndNormalizeDrugList(form.analgesia) : [],
      nmb: form.nmb ? splitAndNormalizeDrugList(form.nmb) : [],
      hasDNR: form.hasDNR,
      isIsolated: form.isIsolated,
      criticalStatus: undefined,
    },
  };
}

export function parseEditPatientForm(
  patient: PatientWithFrontendFields,
): ValidationResult<Partial<Patient>> {
  if (!normalizeOptionalText(patient.bedNumber).trim()) {
    return { success: false, message: '床號不可空白' };
  }

  if (!normalizeOptionalText(patient.name).trim()) {
    return { success: false, message: '姓名不可空白' };
  }

  const age = toValidatedNumber(patient.age);
  if (!isValidAge(age)) {
    return { success: false, message: '請填寫正確年齡' };
  }

  if (!normalizeOptionalText(patient.diagnosis).trim()) {
    return { success: false, message: '入院診斷不可空白' };
  }

  const ventilatorDays = toValidatedNumber(patient.ventilatorDays);
  if (ventilatorDays === null) {
    return { success: false, message: '請填寫正確呼吸器天數' };
  }

  return {
    success: true,
    data: {
      bedNumber: normalizeOptionalText(patient.bedNumber),
      name: normalizeOptionalText(patient.name),
      gender: patient.gender,
      age,
      height: patient.height ?? null,
      weight: patient.weight ?? null,
      attendingPhysician: normalizeOptionalText(patient.attendingPhysician),
      department: normalizeOptionalText(patient.department),
      diagnosis: normalizeOptionalText(patient.diagnosis),
      admissionDate: patient.admissionDate,
      icuAdmissionDate: patient.icuAdmissionDate,
      intubationDate: patient.intubationDate ?? null,
      tracheostomy: patient.tracheostomy ?? false,
      tracheostomyDate: patient.tracheostomyDate ?? null,
      ventilatorDays,
      intubated: patient.intubated,
      sedation: normalizeDrugList(patient.sedation),
      analgesia: normalizeDrugList(patient.analgesia),
      nmb: normalizeDrugList(patient.nmb),
      consentStatus: patient.consentStatus,
      hasDNR: patient.hasDNR,
      isIsolated: patient.isIsolated,
    },
  };
}
