import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageCircle, 
  ArrowRight, 
  Sparkles, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  LogIn, 
  UserPlus, 
  Store
} from 'lucide-react';
import { ApiService } from '../services/api';
import { normalizeWhatsAppNumber, validatePassword } from '../services/authService';
import { Vendeur } from '../types';
import { useToast } from './Toast';

interface LoginModalProps {
  onLoginSuccess: (vendeur: Vendeur) => void;
}

type AuthMode = 'login' | 'register';

const COUNTRY_PREFIXES = [
  { code: '+212', label: 'Maroc (+212)', flag: '🇲🇦', placeholder: '6 00 00 00 00' },
  { code: '+225', label: 'Côte d’Ivoire (+225)', flag: '🇨🇮', placeholder: '07 00 00 00 00' },
  { code: '+221', label: 'Sénégal (+221)', flag: '🇸🇳', placeholder: '77 000 00 00' },
  { code: '+237', label: 'Cameroun (+237)', flag: '🇨🇲', placeholder: '6 00 00 00 00' },
  { code: '+33', label: 'France (+33)', flag: '🇫🇷', placeholder: '6 00 00 00 00' },
];

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [selectedPrefix, setSelectedPrefix] = useState('+212');
  const [rawNumber, setRawNumber] = useState('');
  const [storeName, setStoreName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [configuredTrialDays, setConfiguredTrialDays] = useState<number | null>(null);
  const { showToast } = useToast();

  const currentPrefixObj = COUNTRY_PREFIXES.find(c => c.code === selectedPrefix) || COUNTRY_PREFIXES[0];

  // Fetch dynamic trial duration from settings/global
  useEffect(() => {
    let isMounted = true;
    ApiService.getConfig()
      .then((cfg) => {
        if (isMounted && cfg) {
          const days = cfg.trialDays ?? cfg.trial_days;
          if (typeof days === 'number' && days > 0) {
            setConfiguredTrialDays(days);
          }
        }
      })
      .catch(() => {
        // Silent fallback: configuredTrialDays remains null
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Helper to switch modes cleanly
  const handleSwitchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setErrorMessage(null);
    setPassword('');
    setConfirmPassword('');
  };

  // Submit Handler: strictly separates registration from login
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Validate WhatsApp Number
    const phoneNorm = normalizeWhatsAppNumber(rawNumber, selectedPrefix);
    if (!phoneNorm.isValid) {
      const msg = phoneNorm.errorMessage || 'Veuillez saisir un numéro WhatsApp valide.';
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    // 2. Validate Password
    const pwdValidation = validatePassword(password);
    if (!pwdValidation.isValid) {
      const msg = pwdValidation.errorMessage || 'Le mot de passe doit comporter au moins 6 caractères.';
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    // 3. In registration mode, validate password confirmation
    if (mode === 'register') {
      if (!confirmPassword) {
        const msg = 'Veuillez confirmer votre mot de passe.';
        setErrorMessage(msg);
        showToast(msg, 'error');
        return;
      }
      if (password !== confirmPassword) {
        const msg = 'Les deux mots de passe ne correspondent pas.';
        setErrorMessage(msg);
        showToast(msg, 'error');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (mode === 'login') {
        // STRICT LOGIN MODE: Never registers. Rejects unregistered numbers.
        const vendeur = await ApiService.login(phoneNorm.fullPhone, password);
        showToast(`Ravi de vous revoir, ${vendeur.name || 'Commerçant'} !`, 'success');
        onLoginSuccess(vendeur);
      } else {
        // STRICT REGISTRATION MODE: Creates new account and initialises Firestore profile
        const newVendeur = await ApiService.register(
          phoneNorm.fullPhone, 
          password, 
          confirmPassword, 
          storeName.trim() || undefined
        );
        const trialMsg = configuredTrialDays 
          ? `Votre boutique ${newVendeur.name} est créée avec ${configuredTrialDays} jours d'essai VIP.`
          : `Votre boutique ${newVendeur.name} est créée avec votre période d'essai VIP.`;
        showToast(trialMsg, 'success');
        onLoginSuccess(newVendeur);
      }
    } catch (err: any) {
      const errMsg = err?.message || (mode === 'login' ? 'Erreur de connexion' : 'Erreur d’inscription');
      setErrorMessage(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      id="login-view-container"
      className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 flex flex-col justify-center items-center p-4 sm:p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-800/30 relative overflow-hidden"
      >
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#25D366]/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-[#25D366]/10 text-[#25D366] rounded-2xl flex items-center justify-center mx-auto mb-3.5 border border-[#25D366]/25 shadow-inner">
            <MessageCircle className="w-8 h-8 fill-current" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            WhatsApp Commercial AI
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            Plateforme de vente professionnelle & CRM WhatsApp
          </p>
        </div>

        {/* 2 DISTINCT MODES SWITCHER (Se connecter vs Créer mon compte) */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl mb-6 border border-slate-200">
          <button
            id="tab-mode-login"
            type="button"
            onClick={() => handleSwitchMode('login')}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              mode === 'login'
                ? 'bg-white text-slate-950 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <LogIn className="w-4 h-4" />
            <span>Se connecter</span>
          </button>

          <button
            id="tab-mode-register"
            type="button"
            onClick={() => handleSwitchMode('register')}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              mode === 'register'
                ? 'bg-white text-[#20ba59] shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Créer mon compte</span>
          </button>
        </div>

        {/* Mode subtitle banner */}
        <div className="mb-5">
          <h2 className="text-lg font-bold text-slate-900">
            {mode === 'login' ? 'Connexion à votre espace vendeur' : 'Créer votre compte vendeur'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {mode === 'login' 
              ? 'Saisissez vos identifiants pour accéder à votre catalogue et vos commandes.'
              : 'Configurez votre accès sécurisé avec votre numéro WhatsApp et mot de passe.'}
          </p>
        </div>

        {/* Error Alert */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">{errorMessage}</span>
                {mode === 'login' && errorMessage.includes('incorrect') && (
                  <button 
                    type="button"
                    onClick={() => handleSwitchMode('register')}
                    className="mt-1 text-emerald-700 underline font-bold cursor-pointer"
                  >
                    Pas encore de compte ? Cliquez ici pour vous inscrire.
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FORM */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Optional Store Name in Register Mode */}
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Nom de votre boutique <span className="text-slate-400 font-normal lowercase">(facultatif)</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Store className="w-4 h-4" />
                </div>
                <input
                  id="store-name-input"
                  type="text"
                  placeholder="Ex : Boutique Élégance & Beauté"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  maxLength={100}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all"
                />
              </div>
            </div>
          )}

          {/* WhatsApp Phone Field */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Numéro de téléphone WhatsApp
            </label>
            
            <div className="flex gap-2">
              <select
                id="country-prefix-select"
                value={selectedPrefix}
                onChange={(e) => setSelectedPrefix(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#25D366] shrink-0"
              >
                {COUNTRY_PREFIXES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.code}
                  </option>
                ))}
              </select>

              <div className="relative flex-1">
                <input
                  id="phone-number-input"
                  type="tel"
                  placeholder={currentPrefixObj.placeholder}
                  value={rawNumber}
                  onChange={(e) => {
                    setRawNumber(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-3 py-2.5 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all"
                  autoFocus
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Votre identifiant sécurisé sera relié à ce numéro.
            </p>
          </div>

          {/* Password Field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Mot de passe
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPassword ? 'Masquer' : 'Afficher'}</span>
              </button>
            </div>

            <div className="relative">
              <input
                id="password-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Au moins 6 caractères"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all"
                required
              />
            </div>
          </div>

          {/* Confirm Password Field (Register Only) */}
          {mode === 'register' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Confirmer le mot de passe
                </label>
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showConfirmPassword ? 'Masquer' : 'Afficher'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  id="confirm-password-input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Répétez votre mot de passe"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  className={`w-full bg-slate-50 border rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all ${
                    confirmPassword && confirmPassword !== password
                      ? 'border-rose-400 ring-1 ring-rose-300'
                      : 'border-slate-200'
                  }`}
                  required
                />
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="text-[11px] text-rose-500 mt-1">
                  Les deux mots de passe ne correspondent pas.
                </p>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            id="btn-login-submit"
            type="submit"
            disabled={isLoading || (mode === 'register' && confirmPassword !== '' && confirmPassword !== password)}
            className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-98 text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all text-sm disabled:opacity-50 cursor-pointer mt-3"
          >
            {isLoading ? (
              <span className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-slate-950 border-t-transparent" />
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Se connecter</span>
                <ArrowRight className="w-4 h-4 ml-auto" />
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-emerald-950" />
                <span>
                  {configuredTrialDays 
                    ? `Créer mon compte (${configuredTrialDays} jours d’essai VIP)`
                    : 'Créer mon compte (Essai VIP offert)'}
                </span>
                <ArrowRight className="w-4 h-4 ml-auto" />
              </>
            )}
          </button>
        </form>

        {/* Free trial info badge for registration */}
        {mode === 'register' ? (
          <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-start gap-2.5 text-xs text-emerald-950">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-semibold">Offre de bienvenue :</strong>
              <span className="text-[11px] text-emerald-800">
                {configuredTrialDays 
                  ? `Votre boutique bénéficie immédiatement de ${configuredTrialDays} jours d’essai VIP offerts pour tester l’IA, le CRM et le catalogue sans engagement.`
                  : 'Votre boutique bénéficie immédiatement de votre période d’essai VIP offerte pour tester l’IA, le CRM et le catalogue sans engagement.'}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-5 text-center">
            <p className="text-xs text-slate-500">
              Vous êtes nouveau commerçant ?{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('register')}
                className="text-emerald-600 font-bold hover:underline cursor-pointer"
              >
                Créer un compte en 1 minute
              </button>
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
};
