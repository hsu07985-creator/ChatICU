import { useState } from 'react';
import { toast } from 'sonner';
import { patientsApi } from '../../lib/api';
import {
  createDefaultNewPatient,
  type NewPatientFormData,
  type PatientWithFrontendFields,
} from '../../features/patients/types';
import { extractApiErrorMessage } from '../../features/patients/patient-error-utils';
import {
  parseCreatePatientForm,
  parseEditPatientForm,
} from '../../features/patients/patient-form-schema';

interface UsePatientDialogStateOptions {
  patients: PatientWithFrontendFields[];
  onPatientsMutated: (options?: { background?: boolean }) => Promise<boolean>;
}

export function usePatientDialogState({
  patients,
  onPatientsMutated,
}: UsePatientDialogStateOptions) {
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<PatientWithFrontendFields | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [archivingPatient, setArchivingPatient] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string>('');
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveConfirmTargetId, setArchiveConfirmTargetId] = useState<string>('');
  const [newPatient, setNewPatient] = useState<NewPatientFormData>(createDefaultNewPatient);

  const refreshPatientsAfterMutation = async () => {
    const refreshSuccess = await onPatientsMutated({ background: true });
    if (!refreshSuccess) {
      toast.error('操作已完成，但病人清單重新載入失敗，請手動重新整理');
    }
  };

  const openEditDialog = (patient: PatientWithFrontendFields) => {
    setEditingPatientId(patient.id);
    setEditFormData({ ...patient });
  };

  const closeEditDialog = () => {
    setEditingPatientId(null);
    setEditFormData(null);
  };

  const handleSaveEditPatient = async () => {
    if (!editFormData || !editingPatientId) {
      return;
    }
    const parsed = parseEditPatientForm(editFormData);
    if (!parsed.success) {
      toast.error(parsed.message);
      return;
    }
    try {
      await patientsApi.updatePatient(editingPatientId, parsed.data);
      closeEditDialog();
      toast.success('病人資料已更新');
      await refreshPatientsAfterMutation();
    } catch (err: unknown) {
      console.error('更新病人資料失敗:', err);
      const errMsg = extractApiErrorMessage(err);
      toast.error(errMsg || '更新失敗，請稍後再試');
    }
  };

  const resetNewPatientForm = () => {
    setNewPatient(createDefaultNewPatient());
  };

  const closeAddDialog = () => {
    if (creatingPatient) {
      return;
    }
    setAddDialogOpen(false);
    resetNewPatientForm();
  };

  const handleCreatePatient = async () => {
    const parsed = parseCreatePatientForm(newPatient);
    if (!parsed.success) {
      toast.error(parsed.message);
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await patientsApi.createPatient(parsed.data);

      toast.success(`已新增病患：${created.bedNumber} ${created.name}`);
      setAddDialogOpen(false);
      resetNewPatientForm();
      await refreshPatientsAfterMutation();
    } catch (err: unknown) {
      console.error('新增病患失敗:', err);
      const errMsg = extractApiErrorMessage(err);
      toast.error(errMsg || '新增病患失敗，請稍後再試');
    } finally {
      setCreatingPatient(false);
    }
  };

  const closeArchiveDialog = () => {
    if (archivingPatient) {
      return;
    }
    setArchiveDialogOpen(false);
    setArchiveTargetId('');
  };

  const closeArchiveConfirm = () => {
    if (archivingPatient) {
      return;
    }
    setArchiveConfirmOpen(false);
    setArchiveConfirmTargetId('');
  };

  const openArchiveConfirm = (patientId: string) => {
    if (!patientId) {
      return;
    }
    setArchiveDialogOpen(false);
    setArchiveTargetId(patientId);
    setArchiveConfirmTargetId(patientId);
    setArchiveConfirmOpen(true);
  };

  const archiveConfirmLabel = (() => {
    if (!archiveConfirmTargetId) return '';
    const target = patients.find((patient) => patient.id === archiveConfirmTargetId);
    return target ? `${target.bedNumber} ${target.name}` : archiveConfirmTargetId;
  })();

  const handleConfirmArchivePatient = async () => {
    if (!archiveConfirmTargetId) {
      return;
    }

    const target = patients.find((patient) => patient.id === archiveConfirmTargetId);
    const label = target ? `${target.bedNumber} ${target.name}` : archiveConfirmTargetId;

    setArchivingPatient(true);
    try {
      await patientsApi.archivePatient(archiveConfirmTargetId, { archived: true });
      toast.success(`已封存病患：${label}`);
      setArchiveDialogOpen(false);
      setArchiveTargetId('');
      setArchiveConfirmOpen(false);
      setArchiveConfirmTargetId('');
      await refreshPatientsAfterMutation();
    } catch (err: unknown) {
      console.error('封存病患失敗:', err);
      const errMsg = extractApiErrorMessage(err);
      toast.error(errMsg || '封存失敗，請稍後再試');
    } finally {
      setArchivingPatient(false);
    }
  };

  return {
    editingPatientId,
    editFormData,
    setEditFormData,
    addDialogOpen,
    archiveDialogOpen,
    archiveConfirmOpen,
    creatingPatient,
    archivingPatient,
    archiveTargetId,
    archiveConfirmTargetId,
    archiveConfirmLabel,
    setArchiveTargetId,
    newPatient,
    setNewPatient,
    openEditDialog,
    closeEditDialog,
    handleSaveEditPatient,
    setAddDialogOpen,
    closeAddDialog,
    handleCreatePatient,
    setArchiveDialogOpen,
    closeArchiveDialog,
    openArchiveConfirm,
    closeArchiveConfirm,
    handleConfirmArchivePatient,
  };
}
