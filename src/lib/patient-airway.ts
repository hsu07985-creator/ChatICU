interface PatientAirwayLike {
  intubated?: boolean | null;
  tracheostomy?: boolean | null;
}

export function getAirwayStatusLabel(patient: PatientAirwayLike): string {
  if (patient.tracheostomy) {
    return '氣切';
  }
  if (patient.intubated) {
    return '插管中';
  }
  return '未插管';
}

export function hasInvasiveAirway(patient: PatientAirwayLike): boolean {
  return Boolean(patient.intubated || patient.tracheostomy);
}
