import React, { useState } from 'react';
import { Lock, Unlock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export const PasscodeLockOverlay: React.FC = () => {
  const { db, unlockApp } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  if (!db) return null;

  const hasPasscode = Boolean(db.profile.appSettings?.general.enablePasscode && db.profile.appSettings?.general.passcode);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!hasPasscode) {
      unlockApp('');
      return;
    }
    const ok = unlockApp(pin);
    if (!ok) {
      setError('Incorrect passcode. Please try again.');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-indigo-700 px-6 py-5 text-white text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-white/15 border border-white/25 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <div className="text-base font-extrabold tracking-tight">{db.profile.companyName}</div>
          <div className="text-[11px] text-indigo-100">Shobhit Invoice Pro — Application Locked</div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {hasPasscode ? (
            <>
              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                Enter your saved security passcode to unlock billing, accounts &amp; GST ledgers.
              </div>
              <div>
                <input
                  autoFocus
                  type="password"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter Passcode / PIN"
                  className="w-full px-4 py-3 text-center text-lg tracking-[0.35em] font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
              {error && (
                <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-xs text-indigo-800 dark:text-indigo-200">
              <ShieldCheck className="w-4 h-4 shrink-0 text-indigo-600" />
              <span>
                No passcode is set yet. Set one in Settings → General → Enable Passcode for PIN protection.
              </span>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Unlock className="w-4 h-4" />
            {hasPasscode ? 'Unlock Application' : 'Resume Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
};
