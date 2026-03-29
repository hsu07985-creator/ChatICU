import { FileText, MessageSquare, MessagesSquare, Pill, TestTube } from 'lucide-react';
import { Badge } from '../ui/badge';
import { TabsList, TabsTrigger } from '../ui/tabs';

interface PatientDetailTabsListProps {
  unreadMessagesCount: number;
}

export function PatientDetailTabsList({ unreadMessagesCount }: PatientDetailTabsListProps) {
  return (
    <TabsList className="grid w-full grid-cols-6 h-[44px] bg-[#f8f9fa] border border-[#e5e7eb] gap-0.5 p-0.5">
      <TabsTrigger value="chat" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
        <MessageSquare className="mr-1.5 h-4 w-4" />
        對話助手
      </TabsTrigger>
      <TabsTrigger value="messages" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white relative rounded-md">
        <MessagesSquare className="mr-1.5 h-4 w-4" />
        留言板
        {unreadMessagesCount > 0 && (
          <Badge className="ml-2 bg-[#ff3975] text-white px-2 py-0.5 text-xs">
            {unreadMessagesCount}
          </Badge>
        )}
      </TabsTrigger>
      <TabsTrigger value="records" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
        <FileText className="mr-1.5 h-4 w-4" />
        病歷記錄
      </TabsTrigger>
      <TabsTrigger value="labs" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
        <TestTube className="mr-1.5 h-4 w-4" />
        檢驗數據
      </TabsTrigger>
      <TabsTrigger value="meds" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
        <Pill className="mr-1.5 h-4 w-4" />
        用藥
      </TabsTrigger>
      <TabsTrigger value="summary" className="text-[13px] font-medium data-[state=active]:bg-[#7f265b] data-[state=active]:text-white rounded-md">
        <FileText className="mr-1.5 h-4 w-4" />
        病歷摘要
      </TabsTrigger>
    </TabsList>
  );
}
