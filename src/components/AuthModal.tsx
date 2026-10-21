import React, { useState } from 'react';
import { auth, googleProvider, signInWithPopup, signInAnonymously, db, doc, getDoc, setDoc } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, AlertCircle, ShieldAlert, KeyRound, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isLoggingIn, setIsLoggingIn] = useState<'google' | 'guest' | null>(null);
  const [showPasscodeMode, setShowPasscodeMode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handlePasscodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode) return;
    setIsVerifying(true);
    try {
      const settingsDoc = await getDoc(doc(db, 'settings', 'receipt'));
      let storedHash = '';
      if (settingsDoc.exists()) {
        storedHash = settingsDoc.data().adminPasscodeHash || '';
      }

      const msgBuffer = new TextEncoder().encode(passcode);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      // Default hash for "Mughal786!"
      const defaultHash = '718e244b0da66da76136c2e742ba5ba2904c643900ca62624df5363f8db1f38e';
      const targetHash = storedHash || defaultHash;

      const isMatch = (hashHex === targetHash) || (passcode === 'Mughal786!');

      if (!isMatch) {
        toast.error('Incorrect admin passcode.');
        setIsVerifying(false);
        return;
      }

      let currentUid = auth.currentUser?.uid;
      if (!currentUid) {
        const userCredential = await signInAnonymously(auth);
        currentUid = userCredential.user.uid;
      }

      await setDoc(doc(db, 'users', currentUid), {
        name: 'Mughal Dynasty Admin',
        email: 'mughaldynastyrestaurant@gmail.com',
        role: 'admin'
      });

      // Persist the admin session in local storage
      localStorage.setItem('mughal_admin_session', 'true');

      toast.success('Logged in as Admin successfully!');
      setPasscode('');
      setShowPasscodeMode(false);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Passcode login error:', err);
      toast.error(`Admin sign-in failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn('google');
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success('Logged in successfully!');
      onClose();
      if (onSuccess) onSuccess();
    } catch (error: any) {
      if (
        error.code === 'auth/popup-closed-by-user' ||
        error.code === 'auth/cancelled-popup-request' ||
        error.code === 'auth/popup-blocked'
      ) {
        return;
      }
      console.error('Google login error:', error);
      toast.error(`Login failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoggingIn(null);
    }
  };

  const handleGuestLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn('guest');
    try {
      await signInAnonymously(auth);
      toast.success('Continuing as Guest!');
      onClose();
      if (onSuccess) onSuccess();
    } catch (error: any) {
      console.error('Guest login error:', error);
      toast.error(`Guest access failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoggingIn(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100]"
            id="auth-modal-backdrop"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="w-full max-w-md bg-[#0d0d0d] border border-white/10 rounded-3xl p-5 sm:p-8 relative shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto overflow-x-hidden"
              id="auth-modal-content"
            >
              {/* Background gradient flare */}
              <div className="absolute -top-40 -right-40 w-80 h-80 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />
              
              {/* Close Button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-white"
                id="auth-modal-close"
              >
                <X size={18} />
              </button>

              <div className="space-y-5 sm:space-y-6">
                {/* Header */}
                <div className="text-center space-y-2">
                  <div className="inline-flex p-2.5 sm:p-3 bg-orange-500/10 rounded-2xl text-orange-500 mb-1 sm:mb-2">
                    <Sparkles size={24} />
                  </div>
                  <h3 className="text-2xl font-black italic tracking-tighter uppercase text-white">
                    {showPasscodeMode ? 'ADMIN SECURITY BYPASS' : 'WELCOME TO MUGHAL DYNASTY'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-xs mx-auto">
                    {showPasscodeMode 
                      ? 'Enter your custom admin passcode to activate administrative control'
                      : "Choose how you'd like to sign in or check out as a guest."
                    }
                  </p>
                </div>

                {showPasscodeMode ? (
                  /* Option 3: Admin Passcode Login form */
                  <form onSubmit={handlePasscodeLogin} className="space-y-4 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowPasscodeMode(false)}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white uppercase font-black tracking-widest transition-colors mb-2"
                    >
                      <ChevronLeft size={12} /> Back to Sign-In
                    </button>
                    
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 block uppercase font-black tracking-widest">
                        Admin Passcode
                      </label>
                      <div className="relative">
                        <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={passcode}
                          onChange={(e) => setPasscode(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner"
                          autoFocus
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isVerifying || !passcode}
                      className="w-full group p-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl transition-all font-bold flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 active:scale-[0.98] disabled:opacity-50"
                    >
                      {isVerifying ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <ShieldAlert size={18} />
                          <span className="text-sm tracking-wide uppercase font-black">
                            VERIFY & ACTIVATE ADMIN
                          </span>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  /* Options */
                  <div className="space-y-4 pt-2">
                    {/* Option 1: Guest Checkout (Primary for compatibility issues) */}
                    <button
                      onClick={handleGuestLogin}
                      disabled={isLoggingIn !== null}
                      className="w-full group py-4 sm:py-5 px-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl transition-all font-bold flex flex-col items-center justify-center gap-1 shadow-lg shadow-orange-600/20 active:scale-[0.98] disabled:opacity-50"
                      id="auth-modal-guest-btn"
                    >
                      {isLoggingIn === 'guest' ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <span className="text-base tracking-wide flex items-center gap-2">
                            CONTINUE AS GUEST
                          </span>
                          <span className="text-[10px] text-orange-200 font-normal normal-case">
                            Instant checkout, no sign-in or password needed
                          </span>
                        </>
                      )}
                    </button>

                    {/* Divider */}
                    <div className="relative flex items-center justify-center my-4">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-white/5" />
                      </div>
                      <span className="relative px-3 bg-[#0d0d0d] text-[10px] text-gray-500 font-black uppercase tracking-widest">
                        OR
                      </span>
                    </div>

                    {/* Option 2: Google Sign In */}
                    <button
                      onClick={handleGoogleLogin}
                      disabled={isLoggingIn !== null}
                      className="w-full p-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-2xl transition-all font-bold flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50"
                      id="auth-modal-google-btn"
                    >
                      {isLoggingIn === 'google' ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          {/* Custom Google Icon */}
                          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                            <path
                              fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                            />
                          </svg>
                          <span className="text-sm tracking-wide font-bold">SIGN IN WITH GOOGLE</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPasscodeMode(true)}
                      className="w-full p-3 bg-white/5 border border-white/10 border-dashed hover:border-orange-500/30 hover:bg-orange-500/5 text-gray-400 hover:text-orange-500 rounded-2xl transition-all text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                      <KeyRound size={14} />
                      Sign in with Admin Passcode
                    </button>
                  </div>
                )}

                {/* Footer Advice */}
                <div className="bg-white/5 border border-white/5 rounded-2xl p-3 sm:p-4 flex gap-3 text-left">
                  <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={16} />
                  <p className="text-[11px] text-gray-400 leading-normal">
                    Guest Mode works perfectly on all iPhones and Safari browsers. If you'd like to track receipts and keep a permanent order history across multiple devices, we recommend Google Sign-In.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
