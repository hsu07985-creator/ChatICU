import { ArrowLeft, Clock } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface PatientDetailHeaderProps {
  patientName: string;
  bedNumber: string | number;
  isIntubated: boolean;
  daysAdmitted: number;
  showEditButton: boolean;
  onBackToPatients: () => void;
}

export function PatientDetailHeader({
  patientName,
  bedNumber,
  isIntubated,
  daysAdmitted,
  showEditButton,
  onBackToPatients,
}: PatientDetailHeaderProps) {
  return (
    <Card className="border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBackToPatients} className="hover:bg-slate-50 dark:hover:bg-slate-800" title="返回病人清單">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-brand text-white flex items-center justify-center font-bold text-2xl shadow-lg">
                {bedNumber}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-[#3c7acb] dark:text-[#6fa3e8]">{patientName}</h1>
                  {isIntubated && (
                    <Badge className="bg-[#d1cbf7] text-brand hover:bg-[#d1cbf7]/90">
                      插管中
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1 bg-white dark:bg-slate-900 px-3 py-1 rounded-full">
                    <Clock className="h-4 w-4" />
                    住院 {daysAdmitted} 天
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {showEditButton && (
              <Button className="bg-brand hover:bg-brand-hover">編輯基本資料</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
