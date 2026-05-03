import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { changePassword } from '../lib/api/auth';
import { useAuth } from '../lib/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { t } = useTranslation('auth');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 12) {
      setError(t('changePassword.errors.tooShort'));
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError(t('changePassword.errors.weakComposition'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.errors.confirmMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('changePassword.errors.sameAsCurrent'));
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success(t('changePassword.successToast'));
      await logout();
      navigate('/login');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || t('changePassword.errors.fallback');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('changePassword.title')}</CardTitle>
          <CardDescription>{t('changePassword.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('changePassword.currentPasswordLabel')}
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('changePassword.newPasswordLabel')}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <p className="text-xs text-muted-foreground mt-1">{t('changePassword.newPasswordHint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('changePassword.confirmPasswordLabel')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? t('changePassword.submitting') : t('changePassword.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
