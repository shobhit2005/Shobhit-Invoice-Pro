import React, { useState } from 'react';
import { LogIn, UserPlus, Zap, Lock, KeyRound, Smartphone, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { INDIAN_STATES } from '../utils/formatters';

export const AuthScreen: React.FC = () => {
  const { login, register, requestAuthOtp, verifyAuthOtp, loginDemo, authError } = useStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginMethod, setLoginMethod] = useState<'otp' | 'password'>('otp');

  // Common + Register state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Admin@123');
  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [withDemoData, setWithDemoData] = useState(true);

  // Login identifier & OTP state
  const [identifier, setIdentifier] = useState('shobhit@shobhitinvoicepro.in');
  const [otpSent, setOtpSent] = useState(false);
  const [otpChannel, setOtpChannel] = useState<'phone' | 'email'>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [otpInfo, setOtpInfo] = useState<{
    userName: string;
    deliveredVia: string[];
    otpPreview?: string;
    warnings?: string[];
  } | null>(null);
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRequestOtp = async () => {
    setLocalError('');
    if (!identifier.trim()) {
      setLocalError('Enter your registered Mobile Number or Email address.');
      return;
    }
    setSubmitting(true);
    try {
      const inferredChannel: 'phone' | 'email' = identifier.includes('@') ? 'email' : 'phone';
      const res = await requestAuthOtp(identifier.trim(), inferredChannel);
      setOtpChannel(res.channel);
      setOtpSent(true);
      setOtpInfo({
        userName: res.userName,
        deliveredVia: res.deliveredVia,
        otpPreview: res.otpPreview,
        warnings: res.warnings,
      });
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        if (loginMethod === 'otp') {
          if (!otpSent) {
            await handleRequestOtp();
            return;
          }
          await verifyAuthOtp(identifier.trim(), otpChannel, otpCode.trim());
        } else {
          await login(identifier.trim(), password);
        }
      } else {
        await register({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          password,
          companyName: companyName.trim(),
          gstin: gstin.trim(),
          state,
          withDemoData,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className="min-h-screen bg-[#F3F5F7] dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 space-y-5">
        <div className="space-y-1 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#116B68] text-white text-xs font-extrabold flex items-center justify-center">
                SI
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#116B68] dark:text-teal-400">
                Shobhit Invoice Pro
              </h1>
            </div>
            <Lock className="w-4 h-4 text-[#84909D]" />
          </div>
          <p className="text-xs text-[#84909D] dark:text-slate-400">
            Double-Entry GST Billing, Inventory &amp; Business Accounting Suite
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F3F5F7] dark:bg-slate-800 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setLocalError('');
            }}
            className={`flex-1 py-1.5 font-semibold rounded-md transition-colors ${
              mode === 'login'
                ? 'bg-[#168C88] text-white shadow-xs'
                : 'text-[#243746] dark:text-slate-300'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setLocalError('');
            }}
            className={`flex-1 py-1.5 font-semibold rounded-md transition-colors ${
              mode === 'register'
                ? 'bg-[#168C88] text-white shadow-xs'
                : 'text-[#243746] dark:text-slate-300'
            }`}
          >
            Create Business Account
          </button>
        </div>

        {displayError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-[#EF4444] dark:text-red-300">
            {displayError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {mode === 'login' ? (
            <>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod('otp');
                    setOtpSent(false);
                    setOtpCode('');
                    setLocalError('');
                  }}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1.5 ${
                    loginMethod === 'otp'
                      ? 'border-[#168C88] bg-[#E5EFF3] text-[#116B68]'
                      : 'border-slate-200 text-[#84909D]'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Phone / Email OTP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod('password');
                    setLocalError('');
                  }}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1.5 ${
                    loginMethod === 'password'
                      ? 'border-[#168C88] bg-[#E5EFF3] text-[#116B68]'
                      : 'border-slate-200 text-[#84909D]'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Password Login
                </button>
              </div>

              <div>
                <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                  Mobile Number or Email *
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (otpSent) {
                      setOtpSent(false);
                      setOtpInfo(null);
                    }
                  }}
                  placeholder="9876543210 or email@company.in"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#243746] dark:text-white"
                />
                <p className="text-[10px] text-[#84909D] mt-1">
                  Works for Business Owners as well as Stock Keeper, Biller, Salesman &amp; Accountant staff logins.
                </p>
              </div>

              {loginMethod === 'otp' ? (
                <>
                  {otpSent && otpInfo && (
                    <div className="p-3 rounded-lg bg-[#E5EFF3] dark:bg-slate-800 border border-[#168C88]/30 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-[#116B68] dark:text-teal-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        OTP Sent to {otpInfo.userName} ({otpInfo.deliveredVia.join(', ')})
                      </div>
                      {otpInfo.otpPreview && (
                        <div className="font-mono font-bold text-[#243746] dark:text-white">
                          Instant Verification Code: {otpInfo.otpPreview}
                        </div>
                      )}
                    </div>
                  )}

                  {otpSent && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-medium text-[#243746] dark:text-slate-300">
                          Enter 6-Digit OTP *
                        </label>
                        <button
                          type="button"
                          onClick={handleRequestOtp}
                          className="text-[11px] font-semibold text-[#2676A8] hover:underline"
                        >
                          Resend OTP
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit OTP"
                        className="w-full px-3 py-2 font-mono tracking-widest text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}

                  {!otpSent ? (
                    <button
                      type="button"
                      onClick={handleRequestOtp}
                      disabled={submitting}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors"
                    >
                      <Smartphone className="w-4 h-4" />
                      {submitting ? 'Sending OTP...' : 'Send Login OTP'}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={submitting || otpCode.length < 4}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors disabled:opacity-50"
                    >
                      <LogIn className="w-4 h-4" />
                      {submitting ? 'Verifying...' : 'Verify OTP & Sign In'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                      Password *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    {submitting ? 'Please wait...' : 'Sign In to Workspace'}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Shobhit Mishra"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                  Business / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Shobhit Traders Pvt Ltd"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@company.in"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="27AABCS1234K1Z5"
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                    State
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-[#243746] dark:text-slate-300 mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <label className="flex items-center gap-2 text-[#243746] dark:text-slate-300 pt-1">
                <input
                  type="checkbox"
                  checked={withDemoData}
                  onChange={(e) => setWithDemoData(e.target.checked)}
                  className="accent-[#168C88]"
                />
                Load initial demo data for testing (can be cleared anytime)
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 font-semibold rounded-lg bg-[#168C88] hover:bg-[#116B68] text-white transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                {submitting ? 'Please wait...' : 'Create Account & Workspace'}
              </button>
            </>
          )}
        </form>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => loginDemo()}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[#243746] dark:text-slate-200"
          >
            <Zap className="w-3.5 h-3.5 text-[#168C88]" />
            Instant Access with Demo Business
          </button>
        </div>
      </div>
    </div>
  );
};
