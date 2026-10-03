import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  MessageCircle, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles, 
  Lock, 
  Eye, 
  EyeOff, 
  UserCheck, 
  AlertCircle 
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Vendeur } from '../types';
import { useToast } from './Toast';

interface LoginModalProps {
  onLoginSuccess: (vendeur: Vendeur) => void;
}

const COUNTRY_PREFIXES = [
  { code: '+212', label: 'Maroc (+212)', flag: '🇲🇦', placeholder: '6 12 34 56 78' },
  { code: '+225', label: 'Côte d’Ivoire (+225)', flag: '🇨🇮', placeholder: '07 12 34 56 78' },
  { code: '+221', label: 'Sénégal (+221)', flag: '🇸🇳', placeholder: '77 123 45 67' },
  { code: '+237', label: 'Cameroun (+237)', flag: '🇨🇲', placeholder: '6 12 34 56 78' },
  { code: '+33', label: 'France (+33)', flag: '🇫🇷', placeholder: '6 12 34 56 78' },
];

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [selectedPrefix, setSelectedPrefix] = useState('+212');
  const [rawNumber, setRawNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { showToast } = useToast();

  const currentPrefixObj = COUNTRY_PREFIXES.find(c => c.code === selectedPrefix) || COUNTRY_PREFIXES[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanDigits = rawNumber.replace(/\D/g, '');
    if (cleanDigits.length < 6) {
      const msg = 'Veuillez saisir un numéro de téléphone WhatsApp valide';
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    if (!password || password.length < 4) {
      const msg = 'Veuillez définir un mot de passe d’au moins 4 caractères';
      setErrorMessage(msg);
      showToast(msg, 'error');
      return;
    }

    const fullPhone = `${selectedPrefix}${cleanDigits}`;
    setIsLoading(true);

    try {
      const vendeur = await ApiService.loginOrRegister(fullPhone, password);
      showToast(`Bienvenue, ${vendeur.name || 'Commerçant'} !`, 'success');
      onLoginSuccess(vendeur);
    } catch (err: any) {
      const errMsg = err?.message || 'Erreur lors de l’authentification';
      setErrorMessage(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemo = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const demo = await ApiService.loginOrRegister('+212612345678', 'demo1234');
      showToast('Connecté au compte démo (VEND-101)', 'success');
      onLoginSuccess(demo);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erreur de connexion');
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
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-800/40 relative overflow-hidden"
      >
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#25D366]/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-[#25D366]/10 text-[#25D366] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#25D366]/20 shadow-inner">
            <MessageCircle className="w-8 h-8 fill-current" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            WhatsApp Commercial AI
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 font-medium">
            Accès Vendeur • Connexion & Inscription Automatique
          </p>
        </div>

        {/* Informational banner about automatic registration */}
        <div className="mb-5 p-3 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-xs text-emerald-950 flex items-start gap-2.5">
          <UserCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Formulaire d’accès unique :</p>
            <p className="text-emerald-800 mt-0.5 leading-relaxed text-[11px]">
              Si votre numéro n’existe pas encore, votre compte et votre catalogue seront créés automatiquement. Si vous êtes déjà client, entrez simplement votre mot de passe pour vous connecter.
            </p>
          </div>
        </div>

        {/* Error Alert if any */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* WhatsApp Field */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Numéro de téléphone WhatsApp
            </label>
            
            <div className="flex gap-2">
              <select
                id="country-prefix-select"
                value={selectedPrefix}
                onChange={(e) => setSelectedPrefix(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#25D366] shrink-0"
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-3 py-3 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all"
                  autoFocus
                  required
                />
              </div>
            </div>
          </div>

          {/* Password Field */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mot de passe
            </label>
            
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="password-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Votre mot de passe secret"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-3 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                title={showPassword ? 'Masquer' : 'Afficher'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Mot de passe sécurisé et haché par chiffrement
            </p>
          </div>

          {/* Submit Button */}
          <button
            id="btn-login-submit"
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-98 text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all text-sm disabled:opacity-50 cursor-pointer mt-2"
          >
            {isLoading ? (
              <span className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-slate-950 border-t-transparent" />
            ) : (
              <>
                <span>Accéder à mon espace vendeur</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Free trial badge */}
        <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2.5 text-xs text-slate-700">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Nouveau vendeur ?</strong> Un catalogue dédié et 7 jours d’essai VIP sont offerts instantanément !
          </span>
        </div>

        {/* Demo Fast Access */}
        <div className="mt-4 pt-4 border-t border-slate-100 text-center">
          <button
            id="btn-quick-demo"
            type="button"
            onClick={handleQuickDemo}
            disabled={isLoading}
            className="text-xs font-semibold text-slate-600 hover:text-emerald-600 transition-colors py-1 px-3 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            👉 Tester en 1-clic avec le compte Démo (Boutique Caftan & Élégance)
          </button>
        </div>
      </motion.div>
    </div>
  );
};
