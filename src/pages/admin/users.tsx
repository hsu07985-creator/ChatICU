import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { getUsers, createUser, updateUser as updateUserApi, deleteUser as deleteUserApi, UsersResponse, User as ApiUser } from '../../lib/api/admin';
import { useAuth } from '../../lib/auth-context';
import { Button } from '../../components/ui/button';
import { ButtonLoadingIndicator } from '../../components/ui/button-loading-indicator';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { 
  UserCog, 
  Plus, 
  Edit2, 
  Trash2, 
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Search
} from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../lib/api-client';

interface User {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'doctor' | 'np' | 'nurse' | 'pharmacist';
  unit: string;
  email: string;
  active: boolean;
  lastLogin: string;
  createdAt: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const { t } = useTranslation('admin');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiData, setApiData] = useState<UsersResponse | null>(null);
  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    password: '',
    role: 'nurse' as const,
    unit: '',
    email: ''
  });

  const [error, setError] = useState<string | null>(null);

  // 從 API 載入數據
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers();
      setApiData(data);
    } catch (err: unknown) {
      console.error('users load failed:', err);
      setError(getApiErrorMessage(err, t('users.toast.loadFail')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 使用 API 數據
  const users = (apiData?.users as User[]) || [];
  const userStats = apiData?.stats || {
    total: users.length,
    active: users.filter(u => u.active).length,
    byRole: {
      admin: users.filter(u => u.role === 'admin').length,
      doctor: users.filter(u => u.role === 'doctor').length,
      np: users.filter(u => u.role === 'np').length,
      nurse: users.filter(u => u.role === 'nurse').length,
      pharmacist: users.filter(u => u.role === 'pharmacist').length,
    },
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.name.includes(searchTerm) ||
      user.username.includes(searchTerm) ||
      user.email.includes(searchTerm) ||
      user.unit.includes(searchTerm);
    if (!matchesSearch) return false;
    if (statusFilter === 'active') return user.active;
    if (statusFilter === 'inactive') return !user.active;
    return true;
  });

  const getRoleBadge = (role: User['role']) => {
    const config = {
      admin: { color: 'bg-brand text-white', icon: ShieldCheck },
      doctor: { color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200', icon: Shield },
      np: { color: 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200', icon: Shield },
      nurse: { color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200', icon: Shield },
      pharmacist: { color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200', icon: Shield }
    };

    const { color, icon: Icon } = config[role];
    const label = t(`users.roleLabel.${role}`);
    return (
      <Badge className={color}>
        <Icon className="h-3.5 w-3.5 mr-1" />
        {label}
      </Badge>
    );
  };

  const getStatusBadge = (active: boolean) => {
    if (active) {
      return (
        <Badge variant="outline" className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800">
          <Unlock className="h-3.5 w-3.5 mr-1" />
          {t('users.active')}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-slate-700">
        <Lock className="h-3.5 w-3.5 mr-1" />
        {t('users.inactive')}
      </Badge>
    );
  };

  const [submitting, setSubmitting] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.name || !newUser.password) {
      toast.error(t('users.toast.requireFields'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await createUser({
        username: newUser.username,
        name: newUser.name,
        password: newUser.password,
        role: newUser.role,
        unit: newUser.unit,
        email: newUser.email
      });

      toast.success(t('users.toast.createdWith', { username: result.username }));
      setIsAddDialogOpen(false);
      setNewUser({
        username: '',
        name: '',
        password: '',
        role: 'nurse',
        unit: '',
        email: ''
      });
      // 重新載入數據
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, t('users.toast.createFail')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;

    setSubmitting(true);
    try {
      await updateUserApi(selectedUser.id, {
        name: selectedUser.name,
        role: selectedUser.role,
        unit: selectedUser.unit,
        email: selectedUser.email
      });

      toast.success(t('users.toast.updated'));
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      // 重新載入數據
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, t('users.toast.updateFail')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const newActive = !user.active;

    setTogglingUserId(userId);
    try {
      await updateUserApi(userId, { active: newActive });
      toast.success(newActive ? t('users.toast.toggledEnabled', { username: user.username }) : t('users.toast.toggledDisabled', { username: user.username }));
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, t('users.toast.toggleFail')));
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const adminWarning = user.role === 'admin' ? t('users.deleteConfirm.adminWarning') : '';
    if (!confirm(t('users.deleteConfirm.prompt', { name: user.name, username: user.username }) + adminWarning)) return;

    setDeletingUserId(userId);
    try {
      const result = await deleteUserApi(userId);
      if (result.hardDeleted) {
        toast.success(t('users.toast.deletedWith', { username: user.username }));
      } else {
        toast.success(result.message || t('users.toast.deletedSoftWith', { username: user.username }));
      }
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, t('users.toast.deleteFail')));
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('users.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('users.subtitle')}</p>
        </div>
        <Button
          onClick={() => setIsAddDialogOpen(true)}
          className="bg-brand hover:bg-brand-hover"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('users.addUser')}
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('users.stats.total')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{userStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('users.stats.active')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{userStats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('users.stats.doctorCount')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{userStats.byRole.doctor}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">{t('users.stats.pharmacistCount')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{userStats.byRole.pharmacist}</div>
          </CardContent>
        </Card>
      </div>

      {/* 用戶列表 */}
      <Card>
        <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserCog className="h-6 w-6 text-brand" />
                {t('users.list.title')}
              </CardTitle>
              <CardDescription className="text-sm mt-2">
                {t('users.list.description')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
                {([
                  { key: 'all', label: t('users.list.filterAll', { count: users.length }) },
                  { key: 'active', label: t('users.list.filterActive', { count: users.filter(u => u.active).length }) },
                  { key: 'inactive', label: t('users.list.filterInactive', { count: users.filter(u => !u.active).length }) },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    aria-pressed={statusFilter === key}
                    className={`px-3 h-8 transition-colors ${
                      statusFilter === key
                        ? 'bg-brand text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    } ${key !== 'all' ? 'border-l border-slate-200 dark:border-slate-700' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="w-[300px] relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('users.list.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.list.colUsername')}</TableHead>
                <TableHead>{t('users.list.colName')}</TableHead>
                <TableHead>{t('users.list.colRole')}</TableHead>
                <TableHead>{t('users.list.colUnit')}</TableHead>
                <TableHead>{t('users.list.colEmail')}</TableHead>
                <TableHead>{t('users.list.colStatus')}</TableHead>
                <TableHead>{t('users.list.colLastLogin')}</TableHead>
                <TableHead className="text-right">{t('users.list.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.unit}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                  <TableCell>{getStatusBadge(user.active)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.lastLogin ? new Date(user.lastLogin).toLocaleString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedUser(user);
                          setIsEditDialogOpen(true);
                        }}
                        className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleToggleStatus(user.id)}
                          disabled={user.id === currentUserId || togglingUserId === user.id}
                          title={user.id === currentUserId ? t('users.actions.cannotDisableSelf') : (user.active ? t('users.actions.disableThis') : t('users.actions.enableThis'))}
                        >
                          {user.active ? (
                            <Lock className="h-4 w-4" />
                          ) : (
                            <Unlock className="h-4 w-4" />
                          )}
                        </Button>
                        {togglingUserId === user.id ? <ButtonLoadingIndicator compact /> : null}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDeleteUser(user.id)}
                          disabled={user.id === currentUserId || deletingUserId === user.id}
                          title={user.id === currentUserId ? t('users.actions.cannotDeleteSelf') : t('users.actions.deleteThis')}
                          className="text-red-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {deletingUserId === user.id ? <ButtonLoadingIndicator compact /> : null}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <p>{t('users.list.loading')}</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <ShieldAlert className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                {t('users.list.reload')}
              </Button>
            </div>
          )}

          {!loading && !error && filteredUsers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>{t('users.list.empty')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增帳號對話框 */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-brand" />
              {t('users.addDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('users.addDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-username">{t('users.addDialog.usernameLabel')}</Label>
              <Input
                id="new-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder={t('users.addDialog.usernamePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-name">{t('users.addDialog.nameLabel')}</Label>
              <Input
                id="new-name"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder={t('users.addDialog.namePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">{t('users.addDialog.passwordLabel')}</Label>
              <Input
                id="new-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder={t('users.addDialog.passwordPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('users.addDialog.passwordHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-role">{t('users.addDialog.roleLabel')}</Label>
              <Select value={newUser.role} onValueChange={(value: any) => setNewUser({ ...newUser, role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="doctor">{t('users.roleLabel.doctor')}</SelectItem>
                  <SelectItem value="np">{t('users.roleLabel.np')}</SelectItem>
                  <SelectItem value="nurse">{t('users.roleLabel.nurse')}</SelectItem>
                  <SelectItem value="pharmacist">{t('users.roleLabel.pharmacist')}</SelectItem>
                  <SelectItem value="admin">{t('users.roleLabel.admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-unit">{t('users.addDialog.unitLabel')}</Label>
              <Input
                id="new-unit"
                value={newUser.unit}
                onChange={(e) => setNewUser({ ...newUser, unit: e.target.value })}
                placeholder={t('users.addDialog.unitPlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-email">{t('users.addDialog.emailLabel')}</Label>
              <Input
                id="new-email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder={t('users.addDialog.emailPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={submitting}>
              {t('users.addDialog.cancel')}
            </Button>
            <Button onClick={handleAddUser} className="bg-brand hover:bg-brand-hover" disabled={submitting}>
              {submitting ? t('users.addDialog.creating') : t('users.addDialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 編輯帳號對話框 */}
      {selectedUser && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-brand" />
                {t('users.editDialog.title')}
              </DialogTitle>
              <DialogDescription>
                {t('users.editDialog.description', { username: selectedUser.username })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">{t('users.editDialog.nameLabel')}</Label>
                <Input
                  id="edit-name"
                  value={selectedUser.name}
                  onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-role">{t('users.editDialog.roleLabel')}</Label>
                <Select
                  value={selectedUser.role}
                  onValueChange={(value: any) => setSelectedUser({ ...selectedUser, role: value })}
                  disabled={selectedUser.role === 'admin'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doctor">{t('users.roleLabel.doctor')}</SelectItem>
                    <SelectItem value="np">{t('users.roleLabel.np')}</SelectItem>
                    <SelectItem value="nurse">{t('users.roleLabel.nurse')}</SelectItem>
                    <SelectItem value="pharmacist">{t('users.roleLabel.pharmacist')}</SelectItem>
                    <SelectItem value="admin">{t('users.roleLabel.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-unit">{t('users.editDialog.unitLabel')}</Label>
                <Input
                  id="edit-unit"
                  value={selectedUser.unit}
                  onChange={(e) => setSelectedUser({ ...selectedUser, unit: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-email">{t('users.editDialog.emailLabel')}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={selectedUser.email}
                  onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={submitting}>
                {t('users.editDialog.cancel')}
              </Button>
              <Button onClick={handleEditUser} className="bg-brand hover:bg-brand-hover" disabled={submitting}>
                {submitting ? t('users.editDialog.saving') : t('users.editDialog.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
