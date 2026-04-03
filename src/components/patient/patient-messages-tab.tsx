import { useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ChevronRight, Clock, Filter, MessagesSquare, Pill, Plus, Reply, Shield, Stethoscope, Tag, ThumbsDown, ThumbsUp, User, Send, X, XCircle } from 'lucide-react';
import type { UserRole } from '../../lib/auth-context';
import type { PatientMessage } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { EmptyState } from '../ui/state-display';
import { MessageListSkeleton } from '../ui/skeletons';
import { Separator } from '../ui/separator';
import { TabsContent } from '../ui/tabs';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Textarea } from '../ui/textarea';
import { groupMessagesByWeek } from '../../pages/patient-detail-utils';

interface PatientMessagesTabProps {
  patientId?: string;
  userRole?: UserRole;
  messages: PatientMessage[];
  messagesLoading: boolean;
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSendGeneralMessage: (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => void | Promise<void>;
  onSendMedicationAdvice: (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  onMarkMessageRead: (messageId: string) => void | Promise<void>;
  formatTimestamp: (timestamp: string) => string;
  presetTags: string[];
  onUpdateTags: (messageId: string, data: { add?: string[]; remove?: string[] }) => void | Promise<void>;
  onRespondToAdvice: (adviceRecordId: string, accepted: boolean) => void | Promise<void>;
}

const ROLE_CONFIG: Record<string, { icon: typeof Pill; color: string; label: string }> = {
  pharmacist: { icon: Pill, color: 'text-green-600', label: '藥師' },
  doctor: { icon: Stethoscope, color: 'text-blue-600', label: '醫師' },
  nurse: { icon: Activity, color: 'text-purple-600', label: '護理師' },
  admin: { icon: Shield, color: 'text-orange-600', label: '管理者' },
};

const MSG_TYPE_STYLE: Record<string, string> = {
  'medication-advice': 'border-l-green-500 bg-green-50/50',
  alert: 'border-l-red-500 bg-red-50/50',
};

function TagSelector({
  presetTags,
  existingTags,
  onAdd,
}: {
  presetTags: string[];
  existingTags: string[];
  onAdd: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const existingSet = new Set(existingTags);
  const suggestions = presetTags.filter((t) => !existingSet.has(t));

  const handleSelect = (tag: string) => {
    onAdd(tag);
    setInputValue('');
    setOpen(false);
  };

  const handleCustom = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !existingSet.has(trimmed) && trimmed.length <= 30) {
      onAdd(trimmed);
      setInputValue('');
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 h-7 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Tag className="h-3.5 w-3.5" />
          標籤
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-2">
          <div className="flex gap-1">
            <Input
              placeholder="新增標籤..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustom(); } }}
              className="h-7 text-xs"
            />
            <Button size="sm" className="h-7 px-2" onClick={handleCustom} disabled={!inputValue.trim()}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-xs cursor-pointer hover:bg-indigo-50"
                  onClick={() => handleSelect(tag)}
                >
                  <Plus className="h-2.5 w-2.5 mr-0.5" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PatientMessagesTab({
  patientId,
  userRole,
  messages,
  messagesLoading,
  messageInput,
  onMessageInputChange,
  onSendGeneralMessage,
  onSendMedicationAdvice,
  onMarkAllRead,
  onMarkMessageRead,
  formatTimestamp,
  presetTags,
  onUpdateTags,
  onRespondToAdvice,
}: PatientMessagesTabProps) {
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [composeTags, setComposeTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [composeMentionedRoles, setComposeMentionedRoles] = useState<string[]>([]);

  const filteredMessages = filterTag
    ? messages.filter((m) => m.tags?.includes(filterTag))
    : messages;

  const unreadCount = messages.filter((m) => !m.isRead).length;
  const medicationAdviceCount = filteredMessages.filter((m) => m.messageType === 'medication-advice').length;
  const alertCount = filteredMessages.filter((m) => m.messageType === 'alert').length;

  // Collect all unique tags across messages for the filter selector
  const allTags = Array.from(new Set(messages.flatMap((m) => m.tags || [])));

  const replyToMessage = replyToId ? messages.find((m) => m.id === replyToId) : null;

  const toggleThread = (messageId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const toggleMentionRole = (role: string) => {
    setComposeMentionedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleSend = (sendFn: (replyToId?: string, tags?: string[], mentionedRoles?: string[]) => void | Promise<void>) => {
    sendFn(
      replyToId ?? undefined,
      composeTags.length > 0 ? composeTags : undefined,
      composeMentionedRoles.length > 0 ? composeMentionedRoles : undefined,
    );
    setReplyToId(null);
    setComposeTags([]);
    setComposeMentionedRoles([]);
  };

  return (
    <TabsContent value="messages" className="space-y-2">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <MessagesSquare className="h-4 w-4 text-slate-600" />
                病患留言板
              </CardTitle>
              <CardDescription className="text-sm">
                團隊成員的照護溝通與用藥建議，避免重要訊息遺漏
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs">{unreadCount} 則未讀</Badge>
              )}
              <Button variant="outline" size="sm" onClick={onMarkAllRead} disabled={!patientId || unreadCount === 0}>
                全部標為已讀
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {/* ── 新增留言 ── */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-sm font-medium text-slate-600">新增留言</span>
            </div>

            {/* 回覆指示條 */}
            {replyToMessage && (
              <div className="flex items-center justify-between rounded-md bg-blue-50 border border-blue-200 px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs text-blue-700">
                  <Reply className="h-3.5 w-3.5" />
                  回覆 <span className="font-medium">{replyToMessage.authorName}</span> 的留言
                </span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-blue-500 hover:text-blue-700" onClick={() => setReplyToId(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            <Textarea
              placeholder={replyToMessage ? '輸入回覆內容...' : '輸入照護相關訊息或用藥建議...'}
              value={messageInput}
              onChange={(e) => onMessageInputChange(e.target.value)}
              className="min-h-[60px] text-sm border-slate-200"
            />

            {/* 標籤選擇 */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-medium text-slate-500">標籤:</span>
              {composeTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200 cursor-pointer hover:bg-indigo-100"
                  onClick={() => setComposeTags((prev) => prev.filter((t) => t !== tag))}
                >
                  {tag}
                  <X className="h-2.5 w-2.5 ml-0.5" />
                </Badge>
              ))}
              <TagSelector
                presetTags={presetTags}
                existingTags={composeTags}
                onAdd={(tag) => setComposeTags((prev) => prev.length < 10 ? [...prev, tag] : prev)}
              />
            </div>

            {/* 角色提及 */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-medium text-slate-500">提及:</span>
              {(['doctor', 'nurse', 'pharmacist', 'admin'] as const).map((role) => {
                const selected = composeMentionedRoles.includes(role);
                const cfg = ROLE_CONFIG[role];
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleMentionRole(role)}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border transition-colors ${
                      selected
                        ? 'bg-orange-100 text-orange-800 border-orange-300'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    @{cfg.label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => handleSend(onSendGeneralMessage)}
                size="sm"
                disabled={!messageInput.trim() || !patientId}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {replyToId ? '發送回覆' : '發送留言'}
              </Button>
            </div>
          </div>

          <Separator />

          {/* ── 標籤篩選 ── */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-500">篩選:</span>
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={`text-xs cursor-pointer transition-colors ${
                    filterTag === tag
                      ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                  }`}
                  onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                >
                  {tag}
                </Badge>
              ))}
              {filterTag && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setFilterTag(null)}
                >
                  <X className="h-3 w-3 mr-0.5" />
                  清除篩選
                </Button>
              )}
            </div>
          )}

          {/* ── 留言列表 ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">
                團隊留言 ({filteredMessages.length})
                {filterTag && (
                  <span className="ml-1 font-normal text-xs text-indigo-600">
                    — 篩選「{filterTag}」
                  </span>
                )}
              </h3>
              <div className="flex gap-1.5">
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                  <Pill className="h-2.5 w-2.5 mr-0.5" />
                  {medicationAdviceCount} 用藥建議
                </Badge>
                <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                  <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                  {alertCount} 警示
                </Badge>
              </div>
            </div>

            {messagesLoading ? (
              <MessageListSkeleton count={3} />
            ) : filteredMessages.length === 0 ? (
              <EmptyState
                icon={filterTag ? Filter : MessagesSquare}
                title={filterTag ? `沒有「${filterTag}」標籤的留言` : '尚無留言'}
                description={filterTag ? '嘗試清除篩選條件查看所有留言' : '開始新增第一則留言，與團隊分享照護資訊'}
              />
            ) : (
              <div className="space-y-3">
                {groupMessagesByWeek(filteredMessages).map((group) => {
                  const messageCards = group.messages.map((message) => {
                    const roleCfg = ROLE_CONFIG[message.authorRole ?? ''] ?? { icon: User, color: 'text-slate-500', label: '使用者' };
                    const RoleIcon = roleCfg.icon;
                    const typeStyle = MSG_TYPE_STYLE[message.messageType ?? ''] ?? 'border-l-slate-300';
                    const replies = message.replies ?? [];
                    const isThreadExpanded = expandedThreads.has(message.id);

                    return (
                      <div key={message.id}>
                        <div className={`rounded-md border border-slate-200 border-l-[3px] ${
                          userRole && message.mentionedRoles?.includes(userRole)
                            ? 'border-l-orange-400 bg-orange-50/30'
                            : typeStyle
                        } ${!message.isRead ? 'ring-1 ring-blue-200' : ''}`}>
                          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <RoleIcon className={`h-4 w-4 shrink-0 ${roleCfg.color}`} />
                              <span className="text-sm font-medium text-slate-900 truncate">{message.authorName}</span>
                              <Badge variant="outline" className="text-xs shrink-0">{roleCfg.label}</Badge>
                              {message.messageType === 'medication-advice' && (
                                <Badge className="bg-green-600 text-white text-xs shrink-0 hover:bg-green-600">用藥建議</Badge>
                              )}
                              {message.messageType === 'medication-advice' && message.adviceRecordId && message.adviceAccepted === true && (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs shrink-0 hover:bg-emerald-100">
                                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                                  已接受{message.adviceRespondedBy ? ` (${message.adviceRespondedBy})` : ''}
                                </Badge>
                              )}
                              {message.messageType === 'medication-advice' && message.adviceRecordId && message.adviceAccepted === false && (
                                <Badge className="bg-red-100 text-red-800 border-red-300 text-xs shrink-0 hover:bg-red-100">
                                  <XCircle className="h-2.5 w-2.5 mr-0.5" />
                                  未接受{message.adviceRespondedBy ? ` (${message.adviceRespondedBy})` : ''}
                                </Badge>
                              )}
                              {message.messageType === 'alert' && (
                                <Badge variant="destructive" className="text-xs shrink-0">警示</Badge>
                              )}
                              {!message.isRead && (
                                <Badge variant="destructive" className="text-xs shrink-0">未讀</Badge>
                              )}
                              {(message.mentionedRoles?.length ?? 0) > 0 && message.mentionedRoles!.map((role) => (
                                <Badge key={role} className="bg-orange-100 text-orange-800 border-orange-300 text-xs shrink-0 hover:bg-orange-100">
                                  @{ROLE_CONFIG[role]?.label ?? role}
                                </Badge>
                              ))}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setReplyToId(message.id)}>
                                <Reply className="h-3 w-3 mr-1" />
                                回覆
                              </Button>
                              <TagSelector
                                presetTags={presetTags}
                                existingTags={message.tags || []}
                                onAdd={(tag) => onUpdateTags(message.id, { add: [tag] })}
                              />
                              {!message.isRead && (
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onMarkMessageRead(message.id)}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  已讀
                                </Button>
                              )}
                              {message.messageType === 'medication-advice' && message.adviceRecordId && message.adviceAccepted == null && (userRole === 'doctor' || userRole === 'admin') && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                    onClick={() => onRespondToAdvice(message.adviceRecordId!, true)}
                                  >
                                    <ThumbsUp className="h-3 w-3 mr-1" />
                                    接受建議
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => onRespondToAdvice(message.adviceRecordId!, false)}
                                  >
                                    <ThumbsDown className="h-3 w-3 mr-1" />
                                    不接受
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="px-3 pb-2.5">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{message.content}</p>
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{formatTimestamp(message.timestamp)}</span>
                              {message.linkedMedication && (
                                <>
                                  <span className="text-slate-300">|</span>
                                  <Pill className="h-3.5 w-3.5 text-green-600" />
                                  <span className="text-green-700">{message.linkedMedication}</span>
                                </>
                              )}
                            </div>
                            {(message.tags?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {message.tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className={`text-xs cursor-pointer group/tag ${
                                      filterTag === tag
                                        ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                                        : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                    }`}
                                    onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                                  >
                                    {tag}
                                    <X
                                      className={`h-2.5 w-2.5 ml-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity ${
                                        filterTag === tag ? 'text-indigo-200 hover:text-white' : ''
                                      }`}
                                      onClick={(e) => { e.stopPropagation(); onUpdateTags(message.id, { remove: [tag] }); }}
                                    />
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {message.replyCount > 0 && (
                              <button
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline mt-2"
                                onClick={() => toggleThread(message.id)}
                              >
                                <MessagesSquare className="h-3.5 w-3.5" />
                                {isThreadExpanded ? '收起回覆' : `${message.replyCount} 則回覆`}
                              </button>
                            )}
                          </div>
                        </div>
                        {isThreadExpanded && replies.length > 0 && (
                          <div className="ml-6 mt-1.5 space-y-1.5 border-l-2 border-blue-200 pl-3">
                            {replies.map((reply) => {
                              const replyRoleCfg = ROLE_CONFIG[reply.authorRole ?? ''] ?? { icon: User, color: 'text-slate-500', label: '使用者' };
                              const ReplyRoleIcon = replyRoleCfg.icon;
                              return (
                                <div key={reply.id} className="rounded-md border border-slate-100 bg-slate-50/50 px-2.5 py-2">
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <ReplyRoleIcon className={`h-3.5 w-3.5 ${replyRoleCfg.color}`} />
                                    <span className="font-medium text-slate-800">{reply.authorName}</span>
                                    <Badge variant="outline" className="text-xs">{replyRoleCfg.label}</Badge>
                                    <span className="text-muted-foreground ml-auto">{formatTimestamp(reply.timestamp)}</span>
                                  </div>
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 mt-1">{reply.content}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });

                  if (group.isRecent) {
                    return (
                      <div key={group.key} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="font-medium">{group.label}</span>
                        </div>
                        {messageCards}
                      </div>
                    );
                  }

                  return (
                    <Collapsible key={group.key}>
                      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 transition-colors group">
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-90" />
                        <span className="text-sm font-medium text-slate-700">{group.label}</span>
                        <span className="text-xs text-slate-500">{group.messages.length} 則留言</span>
                        <div className="flex items-center gap-1.5 ml-auto">
                          {group.unreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs">{group.unreadCount} 未讀</Badge>
                          )}
                          {group.medicationAdviceCount > 0 && (
                            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                              {group.medicationAdviceCount} 用藥建議
                            </Badge>
                          )}
                          {group.alertCount > 0 && (
                            <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                              {group.alertCount} 警示
                            </Badge>
                          )}
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        {messageCards}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <div aria-hidden="true" style={{ height: '26rem' }} />
    </TabsContent>
  ); // v2: reply-threading + mentions
}
