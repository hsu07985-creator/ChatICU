import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { getCachedPatients } from '../lib/patients-cache';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';

import svgPaths from '../imports/svg-n38m0xb9r6';
import imgImage9 from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';

// ChatICU Robot Logo Component
function ChatICURobot() {
  return (
    <div className="relative w-[280px] h-[280px]">
      <img src={imgImage9} alt="ChatICU Robot" className="w-full h-full object-contain" />
    </div>
  );
}

// Speech Bubble Component
function SpeechBubble() {
  return (
    <svg className="w-[140px] h-[85px]" fill="none" viewBox="0 0 140 85">
      <path d={svgPaths.p1faf2071} fill="var(--color-brand-hover)" />
      <path d={svgPaths.p5a77e80} fill="white" />
      <path d={svgPaths.p11500b00} fill="white" />
      <path d={svgPaths.p2be42e00} fill="white" />
      <path d={svgPaths.p288dfb00} fill="white" />
      <path d={svgPaths.pc617980} fill="white" />
      <path d={svgPaths.p3f26900} fill="white" />
      <path d={svgPaths.p3ea84500} fill="white" />
    </svg>
  );
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username, password);

    if (result.success) {
      // Prefetch patients so dashboard renders instantly
      getCachedPatients().catch(() => {});
      navigate(result.passwordExpired ? '/change-password' : '/dashboard');
    } else {
      setError(result.message || '帳號或密碼錯誤');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-slate-950">
      {/* 左側裝飾區 */}
      <div className="hidden lg:flex flex-1 bg-slate-50 dark:bg-slate-900 items-center justify-center p-12 relative">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-[15%] left-[20%] w-32 h-32 rounded-full bg-brand" />
          <div className="absolute top-[35%] right-[15%] w-24 h-24 rounded-full bg-[#f59e0b]" />
          <div className="absolute bottom-[25%] left-[15%] w-20 h-20 rounded-full bg-brand" />
        </div>

        <div className="relative z-10 max-w-md text-center space-y-8">
          {/* Robot Icon */}
          <div className="flex justify-center mb-4">
            <ChatICURobot />
          </div>

          {/* Tagline */}
          <p className="text-brand text-2xl font-semibold">
            <span className="font-black">I</span>ntelligent{' '}
            <span className="font-black">C</span>are for yo
            <span className="font-black">U</span>
          </p>

          {/* Speech Bubble */}
          <div className="flex justify-center">
            <SpeechBubble />
          </div>
        </div>
      </div>

      {/* 右側登入表單 */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white dark:bg-slate-950">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="flex justify-center mb-4">
              <img src={imgImage9} alt="ChatICU Robot" className="w-40 h-40 object-contain" />
            </div>
          </div>

          <div className="space-y-8">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Login to your Account
              </h1>
              <p className="text-sm text-muted-foreground">
                智慧型加護病房照護系統
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Username Field */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-semibold text-muted-foreground">
                  帳號
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="請輸入帳號"
                  className="h-12 border-border bg-white dark:bg-slate-900"
                  required
                  minLength={1}
                  autoComplete="username"
                />
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold text-muted-foreground">
                  密碼
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="請輸入密碼"
                    className="h-12 border-border bg-white dark:bg-slate-900 pr-12"
                    required
                    minLength={1}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-12 text-muted-foreground hover:text-foreground focus:outline-none focus:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {/* Spacer */}
                <div className="pt-2" />
              </div>

              {/* Error Message */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Login Button */}
              <Button
                type="submit"
                className="w-full h-12 bg-brand hover:bg-brand-hover text-white text-lg font-extrabold"
                disabled={loading}
              >
                {loading ? '登入中...' : '登入'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
