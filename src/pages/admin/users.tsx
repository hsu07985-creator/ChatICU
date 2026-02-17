import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { getUsers, createUser, updateUser as updateUserApi, UsersResponse, User as ApiUser } from '../../lib/api/admin';
import { Button } from '../../components/ui/button';
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
  role: 'admin' | 'doctor' | 'nurse' | 'pharmacist';
  unit: string;
  email: string;
  active: boolean;
  lastLogin: string;
  createdAt: string;
}

export function UsersPage() {
  const [searchTerm, setSearchTerm] = useState('');
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
      console.error('載入用戶列表失敗:', err);
      setError(getApiErrorMessage(err, '載入用戶列表失敗，請稍後重試'));
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
      nurse: users.filter(u => u.role === 'nurse').length,
      pharmacist: users.filter(u => u.role === 'pharmacist').length,
    },
  };

  const filteredUsers = users.filter(user =>
    user.name.includes(searchTerm) ||
    user.username.includes(searchTerm) ||
    user.email.includes(searchTerm) ||
    user.unit.includes(searchTerm)
  );

  const getRoleBadge = (role: User['role']) => {
    const config = {
      admin: { label: '系統管理員', color: 'bg-[#7f265b] text-white', icon: ShieldCheck },
      doctor: { label: '醫師', color: 'bg-blue-100 text-blue-800', icon: Shield },
      nurse: { label: '護理師', color: 'bg-green-100 text-green-800', icon: Shield },
      pharmacist: { label: '藥師', color: 'bg-purple-100 text-purple-800', icon: Shield }
    };

    const { label, color, icon: Icon } = config[role];
    return (
      <Badge className={color}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  };

  const getStatusBadge = (active: boolean) => {
    if (active) {
      return (
        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
          <Unlock className="h-3 w-3 mr-1" />
          啟用中
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
        <Lock className="h-3 w-3 mr-1" />
        停用
      </Badge>
    );
  };

  const [submitting, setSubmitting] = useState(false);

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.name || !newUser.password) {
      toast.error('請填寫所有必填欄位');
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

      toast.success(`帳號 ${result.username} 已建立`);
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
      toast.error(getApiErrorMessage(error, '建立帳號失敗'));
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

      toast.success('帳號資料已更新');
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      // 重新載入數據
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, '更新帳號失敗'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const newActive = !user.active;

    try {
      await updateUserApi(userId, { active: newActive });
      toast.success(`已${newActive ? '啟用' : '停用'}帳號 ${user.username}`);
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, '更新狀態失敗'));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('確定要停用此帳號嗎？')) return;

    const user = users.find(u => u.id === userId);
    if (!user) return;

    try {
      // 使用 active=false 來「刪除」帳號（軟刪除）
      await updateUserApi(userId, { active: false });
      toast.success(`已停用帳號 ${user.username}`);
      await loadData();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, '停用帳號失敗'));
    }
  };

  return (
    <div className="p-6 space-y-6 pl-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#3c7acb]">帳號與權限管理</h1>
          <p className="text-muted-foreground mt-1">管理系統使用者帳號、角色與權限設定</p>
        </div>
        <Button
          onClick={() => setIsAddDialogOpen(true)}
          className="bg-[#7f265b] hover:bg-[#631e4d]"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增帳號
        </Button>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">總帳號數</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">{userStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">啟用中</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{userStats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">醫師帳號</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{userStats.byRole.doctor}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">藥師帳號</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{userStats.byRole.pharmacist}</div>
          </CardContent>
        </Card>
      </div>

      {/* 用戶列表 */}
      <Card className="border-2">
        <CardHeader className="bg-[#f8f9fa] border-b-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserCog className="h-6 w-6 text-[#7f265b]" />
                帳號清單
              </CardTitle>
              <CardDescription className="text-[15px] mt-2">
                系統中所有使用者帳號的詳細資訊
              </CardDescription>
            </div>
            <div className="w-[300px] relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋帳號、姓名、單位..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-2"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>帳號</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>單位</TableHead>
                <TableHead>電子郵件</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>最後登入</TableHead>
                <TableHead className="text-right">操作</TableHead>
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
                  <TableCell className="text-sm text-muted-foreground">{user.lastLogin}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedUser(user);
                          setIsEditDialogOpen(true);
                        }}
                        className="text-[#7f265b] hover:text-[#7f265b] hover:bg-[#f8f9fa]"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(user.id)}
                        disabled={user.role === 'admin'}
                      >
                        {user.active ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={user.role === 'admin'}
                        className="text-red-500 hover:text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <p>載入中...</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <ShieldAlert className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                重新載入
              </Button>
            </div>
          )}

          {!loading && !error && filteredUsers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>沒有符合條件的帳號</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增帳號對話框 */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-[#7f265b]" />
              新增帳號
            </DialogTitle>
            <DialogDescription>
              建立新的系統使用者帳號，請填寫以下資訊
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-username">帳號 *</Label>
              <Input
                id="new-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="例如：nurse.wang"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-name">姓名 *</Label>
              <Input
                id="new-name"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="例如：王美玲"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">密碼 *</Label>
              <Input
                id="new-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="請輸入密碼"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-role">角色 *</Label>
              <Select value={newUser.role} onValueChange={(value: any) => setNewUser({ ...newUser, role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="doctor">醫師</SelectItem>
                  <SelectItem value="nurse">護理師</SelectItem>
                  <SelectItem value="pharmacist">藥師</SelectItem>
                  <SelectItem value="admin">系統管理員</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-unit">單位</Label>
              <Input
                id="new-unit"
                value={newUser.unit}
                onChange={(e) => setNewUser({ ...newUser, unit: e.target.value })}
                placeholder="例如：內科加護病房"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-email">電子郵件</Label>
              <Input
                id="new-email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="例如：wang@hospital.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleAddUser} className="bg-[#7f265b] hover:bg-[#631e4d]" disabled={submitting}>
              {submitting ? '建立中...' : '建立帳號'}
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
                <Edit2 className="h-5 w-5 text-[#7f265b]" />
                編輯帳號
              </DialogTitle>
              <DialogDescription>
                修改帳號 {selectedUser.username} 的資訊
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">姓名</Label>
                <Input
                  id="edit-name"
                  value={selectedUser.name}
                  onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-role">角色</Label>
                <Select
                  value={selectedUser.role}
                  onValueChange={(value: any) => setSelectedUser({ ...selectedUser, role: value })}
                  disabled={selectedUser.role === 'admin'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doctor">醫師</SelectItem>
                    <SelectItem value="nurse">護理師</SelectItem>
                    <SelectItem value="pharmacist">藥師</SelectItem>
                    <SelectItem value="admin">系統管理員</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-unit">單位</Label>
                <Input
                  id="edit-unit"
                  value={selectedUser.unit}
                  onChange={(e) => setSelectedUser({ ...selectedUser, unit: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-email">電子郵件</Label>
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
                取消
              </Button>
              <Button onClick={handleEditUser} className="bg-[#7f265b] hover:bg-[#631e4d]" disabled={submitting}>
                {submitting ? '儲存中...' : '儲存變更'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
