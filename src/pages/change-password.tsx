import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../lib/api/auth';
import { useAuth } from '../lib/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 12) {
      setError('新密碼至少需要 12 個字元');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError('新密碼需包含大小寫字母、數字及特殊字元');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('確認密碼不一致');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密碼不可與目前密碼相同');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('密碼已變更，請重新登入');
      await logout();
      navigate('/login');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '密碼變更失敗';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>變更密碼</CardTitle>
          <CardDescription>您的密碼已過期或需要更新，請設定新密碼。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">目前密碼</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">新密碼</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <p className="text-xs text-muted-foreground mt-1">至少 12 字元，含大小寫字母、數字及特殊字元</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">確認新密碼</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? '處理中...' : '變更密碼'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
