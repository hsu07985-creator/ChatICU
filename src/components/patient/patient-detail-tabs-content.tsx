import type React from 'react';
import type { Patient } from '../../lib/api';
import type { AIReadiness, RAGStatus } from '../../lib/api/ai';
import { useAuth, type UserRole } from '../../lib/auth-context';
import { MedicalRecords } from '../medical-records';
import { PharmacistAdviceWidget } from '../pharmacist-advice-widget';
import { Tabs, TabsContent } from '../ui/tabs';
import { PatientChatTab } from './patient-chat-tab';
import { PatientDetailTabsList } from './patient-detail-tabs-list';
import { PatientLabsTab } from './patient-labs-tab';
import { PatientMedicationsTab } from './patient-medications-tab';
import { PatientMessagesTab } from './patient-messages-tab';
import { PatientSummaryTab } from './patient-summary-tab';

interface PatientDetailTabsContentProps {
  activeTab: string;
  onActiveTabChange: (value: string) => void;
  unreadMessagesCount: number;
  chatTabProps: React.ComponentProps<typeof PatientChatTab>;
  messagesTabProps: React.ComponentProps<typeof PatientMessagesTab>;
  records: {
    patientId: string;
    patientName: string;
    aiReadiness: AIReadiness | null;
  };
  labsTabProps: React.ComponentProps<typeof PatientLabsTab>;
  medicationsTabProps: React.ComponentProps<typeof PatientMedicationsTab>;
  summary: {
    patient: Patient;
    userRole?: UserRole;
    aiReadiness: AIReadiness | null;
  };
}

export function PatientDetailTabsContent({
  activeTab,
  onActiveTabChange,
  unreadMessagesCount,
  chatTabProps,
  messagesTabProps,
  records,
  labsTabProps,
  medicationsTabProps,
  summary,
}: PatientDetailTabsContentProps) {
  const { user } = useAuth();
  const isPharmacist = user?.role === 'pharmacist' || user?.role === 'admin';

  return (
    <Tabs value={activeTab} onValueChange={onActiveTabChange}>
      <PatientDetailTabsList unreadMessagesCount={unreadMessagesCount} />

      <PatientChatTab {...chatTabProps} />

      <PatientMessagesTab {...messagesTabProps} />

      <TabsContent value="records" className="space-y-4">
        <MedicalRecords
          patientId={records.patientId}
          patientName={records.patientName}
          aiReadiness={records.aiReadiness}
        />
        {isPharmacist && (
          <PharmacistAdviceWidget
            patientId={records.patientId}
            patientName={records.patientName}
            aiReadiness={records.aiReadiness}
          />
        )}
        <div aria-hidden="true" style={{ height: '10rem' }} />
      </TabsContent>

      <PatientLabsTab {...labsTabProps} />

      <PatientMedicationsTab {...medicationsTabProps} />

      <TabsContent value="summary" className="space-y-4">
        <PatientSummaryTab
          patient={summary.patient}
          userRole={summary.userRole}
          aiReadiness={summary.aiReadiness}
        />
        <div aria-hidden="true" style={{ height: '10rem' }} />
      </TabsContent>
    </Tabs>
  );
}
