import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { usePatientDialogState } from '../hooks/patients/use-patient-dialog-state';
import { usePatientListQuery } from '../hooks/patients/use-patient-list-query';

export function usePatientsPage() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const patientList = usePatientListQuery({ searchTerm, filterStatus });
  const patientDialogs = usePatientDialogState({
    patients: patientList.patients,
    onPatientsMutated: patientList.fetchPatients,
  });

  return {
    isAdmin: user?.role === 'admin',
    searchTerm,
    setSearchTerm,
    filterStatus,
    setFilterStatus,
    loading: patientList.loading,
    error: patientList.error,
    patients: patientList.patients,
    filteredPatients: patientList.filteredPatients,
    fetchPatients: patientList.fetchPatients,
    getICUDays: patientList.getICUDays,
    getDepartmentBgColor: patientList.getDepartmentBgColor,
    getDepartmentBadgeColor: patientList.getDepartmentBadgeColor,
    editingPatientId: patientDialogs.editingPatientId,
    editFormData: patientDialogs.editFormData,
    setEditFormData: patientDialogs.setEditFormData,
    addDialogOpen: patientDialogs.addDialogOpen,
    archiveDialogOpen: patientDialogs.archiveDialogOpen,
    archiveConfirmOpen: patientDialogs.archiveConfirmOpen,
    creatingPatient: patientDialogs.creatingPatient,
    archivingPatient: patientDialogs.archivingPatient,
    archiveTargetId: patientDialogs.archiveTargetId,
    archiveConfirmTargetId: patientDialogs.archiveConfirmTargetId,
    archiveConfirmLabel: patientDialogs.archiveConfirmLabel,
    setArchiveTargetId: patientDialogs.setArchiveTargetId,
    newPatient: patientDialogs.newPatient,
    setNewPatient: patientDialogs.setNewPatient,
    openEditDialog: patientDialogs.openEditDialog,
    closeEditDialog: patientDialogs.closeEditDialog,
    handleSaveEditPatient: patientDialogs.handleSaveEditPatient,
    setAddDialogOpen: patientDialogs.setAddDialogOpen,
    closeAddDialog: patientDialogs.closeAddDialog,
    handleCreatePatient: patientDialogs.handleCreatePatient,
    setArchiveDialogOpen: patientDialogs.setArchiveDialogOpen,
    closeArchiveDialog: patientDialogs.closeArchiveDialog,
    openArchiveConfirm: patientDialogs.openArchiveConfirm,
    closeArchiveConfirm: patientDialogs.closeArchiveConfirm,
    handleConfirmArchivePatient: patientDialogs.handleConfirmArchivePatient,
  };
}
