import React, { useState, useEffect } from 'react';
import { AdminData, SystemConfig, Vendeur, VendeurStatus } from '../types';
import { 
  ShieldCheck, 
  Users, 
  ShoppingBag, 
  Eye, 
  MessageCircle, 
  Settings, 
  Search, 
  Check, 
  X, 
  Crown, 
  ArrowLeft,
  Clock,
  Phone,
  Power,
  RotateCw,
  Lock,
  Unlock,
  KeyRound,
  ExternalLink,
  Copy,
  Trash2,
  Zap,
  CheckCircle2,
  Share2,
  Link as LinkIcon,
  AlertCircle,
  Mail,
  Info
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useToast } from './Toast';
import { auth, onAuthStateChanged } from '../firebase';
import { AuthService, ADMIN_EMAIL } from '../services/authService';

interface AdminPortalProps {
  config: SystemConfig;
  onUpdateConfig: (newConfig: Partial<SystemConfig>) => Promise<SystemConfig | void>;
  onBackToApp: () => void;
  onImpersonateVendeur: (vendeur: Vendeur) => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  config,
  onUpdateConfig,
  onBackToApp,
  onImpersonateVendeur,
}) => {
  const { showToast } = useToast();
  
  // Track Firebase Auth user & admin privilege
  const [currentUser, setCurrentUser] = useState(() => auth.currentUser);
  const isAuthorizedAdmin = Boolean(
    currentUser && 
    currentUser.email && 
    currentUser.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );

  // Admin login states
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingInGoogle, setSigningInGoogle] = useState(false);
  const [signingInPassword, setSigningInPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  // Admin password reset states
  const [sendingResetEmail, setSendingResetEmail] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sendingInAdminReset, setSendingInAdminReset] = useState(false);
  const [inAdminResetFeedback, setInAdminResetFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Config editing state with safe defaults
  const [priceVip, setPriceVip] = useState(config?.vipPrice ?? config?.price_vip ?? 199);
  const [priceVipCfa, setPriceVipCfa] = useState(config?.vipPriceCfa ?? config?.price_vip_cfa ?? 12000);
  const [trialDays, setTrialDays] = useState(config?.trialDays ?? config?.trial_days ?? 7);
  const [whatsappSupport, setWhatsappSupport] = useState(config?.supportWhatsapp || config?.whatsapp_support || '+212600000000');
  const [savingConfig, setSavingConfig] = useState(false);
  // These hooks must remain above every conditional return to preserve React hook order.
  const [migrating, setMigrating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Keep local inputs in sync with config prop
  useEffect(() => {
    if (config) {
      if (config.vipPrice !== undefined || config.price_vip !== undefined) {
        setPriceVip(config.vipPrice ?? config.price_vip!);
      }
      if (config.vipPriceCfa !== undefined || config.price_vip_cfa !== undefined) {
        setPriceVipCfa(config.vipPriceCfa ?? config.price_vip_cfa!);
      }
      if (config.trialDays !== undefined || config.trial_days !== undefined) {
        setTrialDays(config.trialDays ?? config.trial_days!);
      }
      if (config.supportWhatsapp || config.whatsapp_support) {
        setWhatsappSupport(config.supportWhatsapp || config.whatsapp_support || '+212600000000');
      }
    }
  }, [config?.vipPrice, config?.price_vip, config?.vipPriceCfa, config?.price_vip_cfa, config?.trialDays, config?.trial_days, config?.supportWhatsapp, config?.whatsapp_support]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      if (u && u.email && u.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        fetchAdminData(true);
      } else {
        setAdminData(null);
      }
    });
    return () => unsub();
  }, []);

  const fetchAdminData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await ApiService.getAdminData();
      setAdminData(data);
      setDiagnosticError(null);
    } catch (err: any) {
      console.error('[AdminPortal] Erreur chargement admin data:', err);
      let errorMsg = 'Impossible de charger les données admin';
      try {
        const parsed = JSON.parse(err.message);
        errorMsg = `Erreur de permission Firestore (${parsed.operationType} ${parsed.path}) : ${parsed.error}`;
      } catch {
        errorMsg = err?.message || errorMsg;
      }
      setDiagnosticError(errorMsg);
      if (!silent) showToast(errorMsg, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleGoogleAdminLogin = async () => {
    setSigningInGoogle(true);
    setAuthError(null);
    try {
      await AuthService.loginAdminWithGoogle();
      showToast('Authentification Administrateur Firebase réussie !', 'success');
      setDiagnosticError(null);
    } catch (err: any) {
      console.error('[Admin Google Login Error]:', err);
      const msg = err?.message || 'Erreur lors de la connexion Google';
      setAuthError(msg);
      showToast(msg, 'error');
    } finally {
      setSigningInGoogle(false);
    }
  };

  const handlePasswordAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!adminPasswordInput.trim()) {
      setAuthError('Veuillez saisir votre mot de passe administrateur.');
      return;
    }
    setSigningInPassword(true);
    try {
      await AuthService.loginAdminWithPassword(adminPasswordInput);
      showToast('Authentification Administrateur Firebase réussie !', 'success');
      setDiagnosticError(null);
      setAdminPasswordInput('');
    } catch (err: any) {
      console.error('[Admin Password Login Error]:', err);
      const msg = err?.message || 'Mot de passe administrateur incorrect.';
      setAuthError(msg);
      showToast(msg, 'error');
    } finally {
      setSigningInPassword(false);
    }
  };

  const handleAdminForgotPassword = async () => {
    setResetFeedback(null);
    setAuthError(null);
    setSendingResetEmail(true);
    try {
      const res = await AuthService.sendAdminPasswordReset(ADMIN_EMAIL);
      setResetFeedback({ type: 'success', message: res.message });
      showToast('Lien de réinitialisation Firebase envoyé !', 'success');
    } catch (err: any) {
      console.error('[Admin Forgot Password Error]:', err);
      const msg = err?.message || 'Erreur lors de l’envoi de l’email de réinitialisation.';
      setResetFeedback({ type: 'error', message: msg });
      showToast(msg, 'error');
    } finally {
      setSendingResetEmail(false);
    }
  };

  const handleInAdminSendPasswordReset = async () => {
    setInAdminResetFeedback(null);
    setSendingInAdminReset(true);
    try {
      const res = await AuthService.sendAdminPasswordReset(ADMIN_EMAIL);
      setInAdminResetFeedback({ type: 'success', message: res.message });
      showToast('Lien officiel Firebase envoyé à votre adresse email !', 'success');
    } catch (err: any) {
      console.error('[In-Admin Password Reset Error]:', err);
      const msg = err?.message || 'Erreur lors de l’envoi de l’email de réinitialisation.';
      setInAdminResetFeedback({ type: 'error', message: msg });
      showToast(msg, 'error');
    } finally {
      setSendingInAdminReset(false);
    }
  };

  const handleLogoutAdmin = async () => {
    try {
      await AuthService.logout();
      showToast('Session Administrateur fermée.', 'info');
      onBackToApp();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  useEffect(() => {
    if (isAuthorizedAdmin) {
      fetchAdminData();
      // Auto-poll every 3.5 seconds so newly registered users and profile updates appear automatically
      const interval = setInterval(() => {
        fetchAdminData(true);
      }, 3500);

      // Instant synchronization handler: when a vendor updates phone or details, refresh immediately
      const handleVendorUpdated = () => {
        fetchAdminData(true);
      };
      const handleStorage = (e: StorageEvent) => {
        if (e.key === 'wca_last_vendor_update' || e.key === 'wca_last_config_update') {
          fetchAdminData(true);
        }
      };

      window.addEventListener('wca_vendor_updated', handleVendorUpdated);
      window.addEventListener('storage', handleStorage);

      return () => {
        clearInterval(interval);
        window.removeEventListener('wca_vendor_updated', handleVendorUpdated);
        window.removeEventListener('storage', handleStorage);
      };
    }
  }, [isAuthorizedAdmin]);

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copié !`, 'success');
  };

  // 1. Unauthenticated Screen: Requires genuine Firebase Auth for foosco80@gmail.com
  if (!currentUser) {
    return (
      <div id="admin-auth-screen" className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-[#25D366] border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-extrabold text-white">Espace Administrateur Sécurisé</h1>
            <p className="text-xs text-slate-400">
              Accès strictement réservé au compte administrateur autorisé{' '}
              <strong className="text-emerald-400 font-mono">{ADMIN_EMAIL}</strong>.
            </p>
          </div>

          {authError && (
            <div className="bg-rose-950/80 border border-rose-800/80 rounded-2xl p-3.5 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Échec d’authentification</span>
                <span className="text-[11px] text-rose-300">{authError}</span>
              </div>
            </div>
          )}

          {/* Method 1: Google Sign-In */}
          <div className="space-y-3">
            <button
              id="btn-admin-google-login"
              type="button"
              onClick={handleGoogleAdminLogin}
              disabled={signingInGoogle || signingInPassword}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 active:scale-98 text-slate-900 font-bold py-3.5 px-4 rounded-xl shadow-md transition-all text-xs cursor-pointer disabled:opacity-50"
            >
              {signingInGoogle ? (
                <RotateCw className="w-4 h-4 animate-spin text-slate-900" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              <span>Se connecter avec Google ({ADMIN_EMAIL})</span>
            </button>

            <div className="relative flex items-center justify-center my-3">
              <div className="border-t border-slate-800 w-full" />
              <span className="bg-slate-900 px-3 text-[10px] text-slate-500 uppercase tracking-wider">
                ou mot de passe Firebase
              </span>
              <div className="border-t border-slate-800 w-full" />
            </div>

            {/* Method 2: Firebase Email/Password Sign-In */}
            <form onSubmit={handlePasswordAdminLogin} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Identifiant Administrateur
                </label>
                <input
                  type="email"
                  value={ADMIN_EMAIL}
                  disabled
                  className="w-full bg-slate-950/70 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-400 font-mono cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                    Mot de passe
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? 'Masquer' : 'Afficher'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    value={adminPasswordInput}
                    onChange={(e) => {
                      setAdminPasswordInput(e.target.value);
                      setAuthError(null);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 transition-all"
                    required
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <button
                    id="btn-admin-forgot-password"
                    type="button"
                    onClick={handleAdminForgotPassword}
                    disabled={sendingResetEmail || signingInPassword || signingInGoogle}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {sendingResetEmail ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Envoi du lien Firebase...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" />
                        <span>Mot de passe oublié ?</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {resetFeedback && (
                <div className={`rounded-xl p-3 text-xs flex items-start gap-2.5 ${
                  resetFeedback.type === 'success' 
                    ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-300' 
                    : 'bg-rose-950/80 border border-rose-800/80 text-rose-300'
                }`}>
                  {resetFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-bold block">
                      {resetFeedback.type === 'success' ? 'Email de réinitialisation envoyé' : 'Information Firebase'}
                    </span>
                    <span className="text-[11px] leading-relaxed block mt-0.5">{resetFeedback.message}</span>
                  </div>
                </div>
              )}

              <button
                id="btn-admin-password-login"
                type="submit"
                disabled={signingInPassword || signingInGoogle}
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-98 text-slate-950 font-bold py-3 px-4 rounded-xl shadow-lg transition-all text-xs cursor-pointer disabled:opacity-50 mt-2"
              >
                {signingInPassword ? (
                  <RotateCw className="w-4 h-4 animate-spin text-slate-950" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                <span>Se connecter à l’Administration</span>
              </button>
            </form>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Précision d’authentification</span>
              </div>
              <p className="leading-relaxed">
                L’accès par mot de passe utilise le compte Firebase officiel <strong className="text-emerald-400 font-mono">{ADMIN_EMAIL}</strong>. Si vous vous connectez habituellement via Google, utilisez le bouton Google ci-dessus. Si vous n'avez pas encore défini de mot de passe, cliquez sur « Mot de passe oublié ? » pour recevoir un lien officiel Firebase par email.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 text-center">
            <button
              type="button"
              onClick={onBackToApp}
              className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour à l’application</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated but Unauthorized User Screen (e.g. Regular Seller or Other Google Account)
  if (currentUser && !isAuthorizedAdmin) {
    return (
      <div id="admin-access-denied" className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-rose-900/60 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-extrabold text-white">Accès Administrateur Refusé</h1>
            <p className="text-xs text-slate-400">
              L’accès à cette section est strictement réservé au compte Super Administrateur autorisé.
            </p>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-xs space-y-2">
            <div className="text-slate-400">
              Compte actuellement connecté :
            </div>
            <div className="font-mono text-rose-300 font-bold break-all">
              {currentUser.email || currentUser.phoneNumber || `UID: ${currentUser.uid}`}
            </div>
            <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
              Ce compte ne dispose pas des privilèges administrateur. Seul le compte Firebase{' '}
              <strong className="text-emerald-400 font-mono">{ADMIN_EMAIL}</strong> est habilité.
            </div>
          </div>

          {authError && (
            <div className="bg-rose-950/80 border border-rose-800/80 rounded-2xl p-3 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleAdminLogin}
              disabled={signingInGoogle}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold py-3.5 px-4 rounded-xl text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{signingInGoogle ? 'Connexion en cours...' : `Se connecter avec Google (${ADMIN_EMAIL})`}</span>
            </button>

            <button
              type="button"
              onClick={handleLogoutAdmin}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-4 rounded-xl text-xs transition-all cursor-pointer"
            >
              Se déconnecter et retourner à l’application
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const updated = await onUpdateConfig({
        price_vip: Number(priceVip),
        price_vip_cfa: Number(priceVipCfa),
        trial_days: Number(trialDays),
        whatsapp_support: whatsappSupport.trim(),
        vipPrice: Number(priceVip),
        vipPriceCfa: Number(priceVipCfa),
        trialDays: Number(trialDays),
        supportWhatsapp: whatsappSupport.trim(),
      });
      if (updated) {
        if (updated.vipPrice !== undefined || updated.price_vip !== undefined) {
          setPriceVip(updated.vipPrice ?? updated.price_vip!);
        }
        if (updated.vipPriceCfa !== undefined || updated.price_vip_cfa !== undefined) {
          setPriceVipCfa(updated.vipPriceCfa ?? updated.price_vip_cfa!);
        }
        if (updated.trialDays !== undefined || updated.trial_days !== undefined) {
          setTrialDays(updated.trialDays ?? updated.trial_days!);
        }
        if (updated.supportWhatsapp || updated.whatsapp_support) {
          setWhatsappSupport(updated.supportWhatsapp || updated.whatsapp_support || whatsappSupport);
        }
      }
      setDiagnosticError(null);

      // Recalculate server-side catalog rights immediately after trial duration changes.
      // The server uses the same trial-start + configured-duration rule as this dashboard.
      let entitlementRefreshError: string | null = null;
      try {
        await ApiService.recalculateEntitlements();
      } catch (recalcErr: any) {
        entitlementRefreshError = recalcErr?.message || 'Recalcul des droits impossible.';
        console.error('[AdminPortal] Configuration sauvegardée, mais recalcul des droits échoué:', recalcErr);
      }

      await fetchAdminData(true);
      if (entitlementRefreshError) {
        setDiagnosticError(`Configuration enregistrée, mais les droits du catalogue n’ont pas pu être recalculés automatiquement : ${entitlementRefreshError}`);
        showToast('Configuration enregistrée, mais le recalcul des expirations a échoué. Utilisez « Recalculer expirations ».', 'error');
      } else {
        showToast('Configuration globale enregistrée ; les expirations et droits des essais ont été recalculés.', 'success');
      }
    } catch (err: any) {
      console.error('[AdminPortal] Erreur lors de la sauvegarde de la configuration:', err);
      let errorMsg = 'Erreur lors de la mise à jour de la configuration';
      try {
        const parsed = JSON.parse(err.message);
        errorMsg = `Échec de sauvegarde Firestore (${parsed.operationType} ${parsed.path}) : ${parsed.error}`;
      } catch {
        errorMsg = err?.message || errorMsg;
      }
      setDiagnosticError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleVip = async (vendeur: Vendeur) => {
    try {
      const updated = await ApiService.toggleVendorVip(vendeur.id);
      showToast(`Statut VIP de ${vendeur.name || vendeur.phone} : ${updated.status}`, 'success');
      setAdminData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          vendeurs: prev.vendeurs.map(v => v.id === vendeur.id ? updated : v),
        };
      });
    } catch {
      showToast('Erreur lors de la mise à jour VIP', 'error');
    }
  };

  const handleToggleActive = async (vendeur: Vendeur) => {
    try {
      const updated = await ApiService.toggleVendorActive(vendeur.id);
      const isNowActive = updated.is_active !== false && updated.status !== 'Inactif';
      showToast(
        `Compte de ${vendeur.name || vendeur.phone} ${isNowActive ? 'ACTIVÉ (ON)' : 'DÉSACTIVÉ (OFF)'}`,
        isNowActive ? 'success' : 'error'
      );
      setAdminData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          vendeurs: prev.vendeurs.map(v => v.id === vendeur.id ? updated : v),
        };
      });
    } catch {
      showToast('Erreur lors de la modification de l’accès', 'error');
    }
  };

  const handleDeleteVendor = async (vendeur: Vendeur) => {
    if (!window.confirm(`Confirmez-vous la suppression définitive du compte de ${vendeur.name || vendeur.phone} (${vendeur.id}) ? Tous ses produits et données seront effacés.`)) {
      return;
    }
    try {
      await ApiService.deleteVendor(vendeur.id);
      showToast(`Vendeur ${vendeur.id} supprimé avec succès`, 'success');
      setAdminData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          total_vendeurs: Math.max(0, prev.total_vendeurs - 1),
          vendeurs: prev.vendeurs.filter(v => v.id !== vendeur.id),
        };
      });
    } catch {
      showToast('Erreur lors de la suppression du vendeur', 'error');
    }
  };

  const handleMigratePublicStores = async () => {
    setMigrating(true);
    try {
      const res = await ApiService.migratePublicStores();
      showToast(`Migration terminée : ${res.migrated}/${res.total} boutiques synchronisées vers /publicStores (profils publics sécurisés).`, 'success');
      await fetchAdminData(false);
    } catch {
      showToast('Erreur lors de la migration des boutiques publiques', 'error');
    } finally {
      setMigrating(false);
    }
  };

  const handleRecalculateEntitlements = async () => {
    setRecalculating(true);
    try {
      const res = await ApiService.recalculateEntitlements();
      showToast(
        `Expirations recalculées : ${res.updated} boutiques mises à jour (${res.fullCatalog} accès total, ${res.restricted} restreintes à 4 produits, ${res.suspended} suspendues).`,
        'success'
      );
      await fetchAdminData(false);
    } catch {
      showToast('Erreur lors du recalcul des droits d’expiration', 'error');
    } finally {
      setRecalculating(false);
    }
  };

  const handlePurgeAllDemoVendors = async () => {
    try {
      const updated = await ApiService.purgeDemoVendors();
      setAdminData(updated);
      showToast('Tous les vendeurs démo ont été purgés et supprimés définitivement de la base de données !', 'success');
    } catch {
      showToast('Erreur lors de la suppression des comptes démo', 'error');
    }
  };

  const trialVendors = (adminData?.vendeurs || []).filter(v => v && v.status !== 'VIP');

  const filteredVendeurs = (adminData?.vendeurs || []).filter((v) => {
    if (!v) return false;
    const nameStr = (v.name || '').toLowerCase();
    const phoneStr = (v.phone || v.id || '').toLowerCase();
    const locStr = (v.location || '').toLowerCase();
    const q = (searchQuery || '').toLowerCase();

    const matchesSearch = !q || nameStr.includes(q) || phoneStr.includes(q) || locStr.includes(q);

    const matchesStatus = statusFilter === 'all' 
      ? true 
      : statusFilter === 'Essai Gratuit' || statusFilter === 'Gratuit'
        ? v.status !== 'VIP'
        : v.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div id="admin-portal" className="min-h-screen bg-slate-900 text-slate-100 pb-16">
      {/* Admin Top Navigation */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-[#25D366] border border-emerald-500/30 flex items-center justify-center font-bold">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold">Portail Administration SaaS</h1>
              <p className="text-xs text-slate-400">WhatsApp Commercial AI • Super Admin</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAdminData(false)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="Actualiser les données"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleLogoutAdmin}
              className="flex items-center gap-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              title="Déconnecter la session administrateur"
            >
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Déconnexion Admin</span>
            </button>

            <button
              id="btn-back-to-app"
              onClick={onBackToApp}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Quitter l’Admin</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* Firebase Admin Authentication Status & Diagnostics */}
        <div className="bg-emerald-950/60 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <div>
              <span className="font-bold text-white">Session Firebase Administrateur Active : </span>
              <span className="font-mono text-emerald-300 font-semibold">{currentUser?.email}</span>
              <span className="text-slate-400 ml-2">UID: {currentUser?.uid}</span>
            </div>
          </div>
          <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2.5 py-1 rounded-full border border-emerald-500/40 w-fit">
            Droits Firestore Admin Validés (isAdmin() = true)
          </span>
        </div>

        {diagnosticError && (
          <div className="bg-rose-950/70 border border-rose-800/60 rounded-xl p-3 text-xs text-rose-300 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-rose-200">
              <X className="w-3.5 h-3.5 text-rose-400" />
              <span>Journal de diagnostic Firestore :</span>
            </div>
            <p className="font-mono text-[11px] break-all">{diagnosticError}</p>
          </div>
        )}

        {/* Dedicated Two Distinct Links Card for Testing & Publication */}
        <div className="bg-slate-950/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-[#25D366] flex items-center justify-center font-bold">
                <LinkIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Liens Distincts de Publication & Tests</h2>
                <p className="text-xs text-slate-400">Deux accès strictement séparés pour tester et partager l’application.</p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700">
              Routage par URL
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. LIEN ADMIN PRIVÉ */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-rose-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-rose-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span>1. Votre Lien Administrateur Privé</span>
                </div>
                <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 px-2 py-0.5 rounded-full">
                  Réservé à vous
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Ouvre ce tableau de bord complet avec contrôle ON/OFF des accès, métriques, et gestion de la durée d’essai.
              </p>
              <div className="flex items-center gap-2 pt-1">
                {(() => {
                  const origin = typeof window !== 'undefined' ? window.location.origin : '';
                  const cleanPath = typeof window !== 'undefined' ? window.location.pathname.replace(/\/admin\/?$/i, '').replace(/\/+$/, '') : '';
                  const adminUrl = `${origin}${cleanPath}/?role=admin`;
                  return (
                    <>
                      <input
                        type="text"
                        readOnly
                        value={adminUrl}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-rose-300 select-all font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(adminUrl);
                          showToast('Lien Administrateur copié !', 'success');
                        }}
                        className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs shrink-0 cursor-pointer shadow-sm transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* 2. LIEN PUBLIC VENDEURS */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-[#25D366]">
                  <Users className="w-4 h-4" />
                  <span>2. Lien Public Vendeurs à partager à vos amis</span>
                </div>
                <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                  À diffuser
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Portail d’accès vendeur avec inscription sécurisée, connexion (WhatsApp + mot de passe) et catalogue isolé. Aucun accès admin.
              </p>
              <div className="flex items-center gap-2 pt-1">
                {(() => {
                  const origin = typeof window !== 'undefined' ? window.location.origin : '';
                  const cleanPath = typeof window !== 'undefined' ? window.location.pathname.replace(/\/admin\/?$/i, '').replace(/\/+$/, '') : '';
                  const publicUrl = `${origin}${cleanPath}/?role=public`;
                  return (
                    <>
                      <input
                        type="text"
                        readOnly
                        value={publicUrl}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 select-all font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(publicUrl);
                          showToast('Lien Public Vendeurs copié !', 'success');
                        }}
                        className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-3.5 py-2 rounded-xl text-xs shrink-0 cursor-pointer shadow-sm transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const text = encodeURIComponent(
                            `👋 Rejoins notre plateforme e-commerce WhatsApp !\n\n` +
                            `Crée ta boutique en ligne avec catalogue gratuit et commandes directes :\n` +
                            `👉 ${publicUrl}\n\n` +
                            `Entre simplement ton numéro WhatsApp et ton mot de passe.`
                          );
                          window.open(`https://wa.me/?text=${text}`, '_blank');
                        }}
                        className="flex items-center gap-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 px-3 py-2 rounded-xl text-xs shrink-0 cursor-pointer"
                        title="Partager sur WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* KPI Stats Grid with Skeletons */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase">
              <span>Vendeurs Totaux</span>
              <Users className="w-5 h-5 text-sky-400" />
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-slate-700 animate-pulse rounded-lg mt-3" />
            ) : (
              <div className="mt-3 text-3xl font-extrabold text-white">
                {adminData?.total_vendeurs ?? adminData?.vendeurs?.length ?? 0}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Comptes enregistrés</p>
          </div>

          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase">
              <span>Produits en ligne</span>
              <ShoppingBag className="w-5 h-5 text-amber-400" />
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-slate-700 animate-pulse rounded-lg mt-3" />
            ) : (
              <div className="mt-3 text-3xl font-extrabold text-white">
                {adminData?.total_products || 0}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Dans tous les catalogues</p>
          </div>

          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase">
              <span>Vues Boutiques</span>
              <Eye className="w-5 h-5 text-purple-400" />
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-slate-700 animate-pulse rounded-lg mt-3" />
            ) : (
              <div className="mt-3 text-3xl font-extrabold text-white">
                {adminData?.total_views || 0}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Visites uniques enregistrées</p>
          </div>

          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase">
              <span>Conversions WA</span>
              <MessageCircle className="w-5 h-5 text-[#25D366]" />
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-slate-700 animate-pulse rounded-lg mt-3" />
            ) : (
              <div className="mt-3 text-3xl font-extrabold text-[#25D366]">
                {adminData?.total_conversions || 0}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Commandes déclenchées</p>
          </div>
        </div>

        {/* System Configuration Section */}
        <div className="bg-slate-800/60 rounded-3xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700">
            <Settings className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Configuration Globale du Système</h2>
          </div>

          <form onSubmit={handleSaveConfig} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Prix Pack VIP (MAD / DH)
              </label>
              <input
                type="number"
                value={priceVip}
                onChange={(e) => setPriceVip(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Prix Pack VIP (CFA / FCFA)
              </label>
              <input
                type="number"
                value={priceVipCfa}
                onChange={(e) => setPriceVipCfa(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Durée Essai Gratuit (Jours)
              </label>
              <input
                type="number"
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                WhatsApp Support Ventes
              </label>
              <input
                type="tel"
                value={whatsappSupport}
                onChange={(e) => setWhatsappSupport(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-[11px] text-emerald-400/90 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span>La modification de la durée d’essai recalcule immédiatement le compte à rebours de tous les vendeurs en essai.</span>
              </p>
              <button
                type="submit"
                disabled={savingConfig}
                className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs shadow-md transition-all disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Check className="w-4 h-4" />
                <span>{savingConfig ? 'Enregistrement...' : 'Mettre à jour la configuration'}</span>
              </button>
            </div>
          </form>

          {/* Dedicated Account Security & Password Management Section ("Sécurité du compte") */}
          <div id="admin-account-security-section" className="mt-6 pt-5 border-t border-slate-700/80 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Sécurité du Compte & Mot de Passe Administrateur
                </h3>
              </div>
              <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full uppercase tracking-wider w-fit">
                Accès Super Admin Protégé
              </span>
            </div>

            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <span className="text-slate-400 text-[11px] block">Compte Firebase autorisé :</span>
                <span className="font-mono text-emerald-300 font-bold break-all">{ADMIN_EMAIL}</span>
                <span className="block text-[10px] text-slate-500">UID : {currentUser?.uid || 'N/A'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 text-[11px] block">Méthode de connexion active :</span>
                <span className="text-slate-300 font-medium">
                  {currentUser?.providerData && currentUser.providerData.length > 0 
                    ? currentUser.providerData.map(p => p.providerId === 'google.com' ? 'Google Sign-In' : p.providerId === 'password' ? 'Email/Mot de passe' : p.providerId).join(', ')
                    : 'Google Sign-In / Firebase'}
                </span>
                <span className="block text-[10px] text-slate-500">Règles Firestore : isAdmin() = true</span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 text-[11px] block">Stockage des identifiants :</span>
                <span className="text-emerald-400 font-medium">Zéro mot de passe en base de données</span>
                <span className="block text-[10px] text-slate-500">Protection native Firebase Authentication</span>
              </div>
            </div>

            {/* Email Password Reset Action */}
            <div className="bg-slate-900/60 p-4 sm:p-5 rounded-2xl border border-emerald-500/20 space-y-3">
              <div className="flex items-start gap-3">
                <KeyRound className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Réinitialiser ou Définir le Mot de Passe Administrateur
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Si vous ne connaissez pas le mot de passe actuel ou souhaitez le mettre à jour, vous pouvez demander à Firebase d’envoyer un lien de réinitialisation sécurisé à l’adresse officielle <strong className="text-emerald-400 font-mono">{ADMIN_EMAIL}</strong>. Aucun mot de passe n’est enregistré dans Firestore ou dans le code source.
                  </p>
                </div>
              </div>

              {inAdminResetFeedback && (
                <div className={`rounded-xl p-3 text-xs flex items-start gap-2.5 ${
                  inAdminResetFeedback.type === 'success' 
                    ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-300' 
                    : 'bg-rose-950/80 border border-rose-800/80 text-rose-300'
                }`}>
                  {inAdminResetFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-bold block">
                      {inAdminResetFeedback.type === 'success' ? 'Email de réinitialisation envoyé' : 'Information Firebase'}
                    </span>
                    <span className="text-[11px] leading-relaxed block mt-0.5">{inAdminResetFeedback.message}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-500">
                  Lien généré et expédié exclusivement à {ADMIN_EMAIL}
                </span>
                <button
                  id="btn-in-admin-reset-password"
                  type="button"
                  onClick={handleInAdminSendPasswordReset}
                  disabled={sendingInAdminReset}
                  className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-98 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs shadow-md transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {sendingInAdminReset ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Envoi en cours...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      <span>Envoyer le lien de réinitialisation par email</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dedicated Free Trial Vendors Table ("Tableau des Vendeurs en Mode Essai Gratuit") */}
        <div id="trial-vendors-section" className="bg-slate-800/80 rounded-3xl p-6 border border-emerald-500/30 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-[#25D366] flex items-center justify-center font-bold">
                <Clock className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-white">Vendeurs en Mode Essai Gratuit</h2>
                  <span className="text-xs font-bold bg-[#25D366] text-slate-950 px-2.5 py-0.5 rounded-full">
                    {trialVendors.length} en essai
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Surveillance du compte à rebours et activation VIP immédiate (Durée globale : {config.trialDays || config.trial_days ? `${config.trialDays || config.trial_days} jours` : 'configurée dans les paramètres' }).
                </p>
              </div>
            </div>

            <button
              onClick={() => setStatusFilter('Essai Gratuit')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
            >
              Filtrer ci-dessous
            </button>
          </div>

          {trialVendors.length === 0 ? (
            <div className="py-8 text-center bg-slate-900/50 rounded-2xl border border-slate-700/60">
              <p className="text-xs text-slate-400">Aucun vendeur en période d’essai pour le moment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-700">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 uppercase text-[10px] font-semibold text-slate-400 tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Boutique & ID</th>
                    <th className="py-3 px-4">WhatsApp Direct</th>
                    <th className="py-3 px-4">Compte à Rebours / Expiration</th>
                    <th className="py-3 px-4">Date Inscription</th>
                    <th className="py-3 px-4">Accès (ON / OFF)</th>
                    <th className="py-3 px-4 text-right">Action VIP Rapide</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                  {trialVendors.map((v) => {
                    if (!v) return null;
                    // Use the configured trial duration from the actual trial start.
                    // A persisted trialEndsAt may be stale after the administrator changes trialDays.
                    const configuredTrialDays = Math.max(0, Number(config?.trialDays ?? config?.trial_days ?? 7));
                    const trialStartValue = v.trialStartedAt || v.createdAt || v.created_at;
                    const trialStartMs = trialStartValue ? new Date(trialStartValue).getTime() : Number.NaN;
                    const storedExpirationValue = v.trialEndsAt || v.date_expiration_essai;
                    const storedExpirationMs = storedExpirationValue ? new Date(storedExpirationValue).getTime() : Number.NaN;
                    const targetExpiration = Number.isFinite(trialStartMs)
                      ? trialStartMs + configuredTrialDays * 86400000
                      : Number.isFinite(storedExpirationMs)
                        ? storedExpirationMs
                        : Date.now();
                    const diffDays = Math.ceil((targetExpiration - Date.now()) / 86400000);
                    const isExpired = targetExpiration <= Date.now();
                    const trialStartDate = Number.isFinite(trialStartMs) ? new Date(trialStartMs) : null;
                    const phoneClean = String(v.phone || v.id || '').replace(/\D/g, '');
                    const dateFormatted = v.created_at ? new Date(v.created_at).toLocaleDateString('fr-FR') : 'Récent';

                    return (
                      <tr key={`trial-${v.id}`} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={v.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=100&q=80'}
                              alt=""
                              className="w-8 h-8 rounded-lg object-cover bg-slate-800 border border-slate-700 shrink-0"
                            />
                            <div>
                              <div className="font-bold text-white text-xs sm:text-sm">{v.name || `Boutique ${v.phone || v.id}`}</div>
                              <span className="text-[10px] font-mono bg-sky-950/80 text-sky-300 border border-sky-800/60 px-1.5 py-0.2 rounded font-bold">
                                ID: {v.id}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`https://wa.me/${phoneClean}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-emerald-400 font-semibold hover:underline flex items-center gap-1"
                              title="Ouvrir WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                              <span>{v.phone || v.id}</span>
                            </a>
                            <button
                              onClick={() => handleCopyText(v.phone || v.id, 'Numéro WhatsApp')}
                              className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer"
                              title="Copier"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          {isExpired ? (
                            <span className="inline-flex items-center gap-1 bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              🔴 Essai expiré ({new Date(targetExpiration).toLocaleDateString('fr-FR')})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              ⏳ {diffDays} jour{diffDays > 1 ? 's' : ''} restant{diffDays > 1 ? 's' : ''}
                            </span>
                          )}
                          {trialStartDate && (
                            <div className="text-[10px] text-slate-400 mt-1 font-mono">
                              Du {trialStartDate.toLocaleDateString('fr-FR')} au {new Date(targetExpiration).toLocaleDateString('fr-FR')}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-slate-400 text-xs">
                          {dateFormatted}
                        </td>

                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(v)}
                            className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                              v.is_active !== false && v.status !== 'Inactif' ? 'bg-[#25D366]' : 'bg-slate-700'
                            }`}
                            title="Bascule ON / OFF"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                v.is_active !== false && v.status !== 'Inactif' ? 'translate-x-5' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleToggleVip(v)}
                            className="inline-flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                            title="Passer immédiatement ce vendeur en VIP"
                          >
                            <Crown className="w-3.5 h-3.5 fill-current" />
                            <span>★ Passer en VIP</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Vendors Management Section */}
        <div className="bg-slate-800/60 rounded-3xl p-6 border border-slate-700 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-700">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white">Gestion de Tous les Vendeurs</h2>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Zap className="w-3 h-3 text-[#25D366]" /> Synchronisation en direct
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Gérez les comptes, basculez l’accès (ON/OFF), supprimez des comptes ou passez en VIP.</p>
            </div>

            {/* Filter buttons & Demo Purge action */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={handleMigratePublicStores}
                disabled={migrating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                title="Synchronise tous les vendeurs vers la structure publique dédiée /publicStores"
              >
                <RotateCw className={`w-3.5 h-3.5 ${migrating ? 'animate-spin' : ''}`} />
                <span>{migrating ? 'Migration...' : 'Synchroniser /publicStores'}</span>
              </button>

              <button
                type="button"
                onClick={handleRecalculateEntitlements}
                disabled={recalculating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                title="Recalcule immédiatement l’expiration des essais et abonnements VIP et synchronise /publicStores"
              >
                <Clock className={`w-3.5 h-3.5 ${recalculating ? 'animate-spin' : ''}`} />
                <span>{recalculating ? 'Calcul...' : 'Recalculer expirations'}</span>
              </button>

              <button
                type="button"
                onClick={handlePurgeAllDemoVendors}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 transition-colors cursor-pointer shrink-0"
                title="Supprime tous les vendeurs d’exemple ou démo"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Supprimer vendeurs démo</span>
              </button>

              {['all', 'Essai Gratuit', 'VIP', 'Actif', 'Inactif'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[#25D366] text-slate-950 font-bold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {st === 'all' ? 'Tous' : st}
                </button>
              ))}
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un vendeur par nom, numéro WhatsApp, ville..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]"
            />
          </div>

          {/* Vendors Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-700">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 uppercase text-[10px] font-semibold text-slate-400 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Vendeur / Boutique & ID</th>
                  <th className="py-3 px-4">WhatsApp</th>
                  <th className="py-3 px-4">Accès Compte (ON / OFF)</th>
                  <th className="py-3 px-4">Localisation & Devise</th>
                  <th className="py-3 px-4">Statut, Plan & Période</th>
                  <th className="py-3 px-4 text-center">Vues / Clics / Conv</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                {loading ? (
                  Array.from({ length: 4 }).map((_, idx) => (
                    <tr key={`skel-row-${idx}`} className="animate-pulse">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-slate-700 shrink-0" />
                          <div className="space-y-1.5 flex-1">
                            <div className="h-3.5 bg-slate-700 rounded w-28" />
                            <div className="h-2.5 bg-slate-800 rounded w-20" />
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4"><div className="h-3.5 bg-slate-700 rounded w-28" /></td>
                      <td className="py-3.5 px-4"><div className="h-3.5 bg-slate-700 rounded w-20" /></td>
                      <td className="py-3.5 px-4"><div className="h-5 bg-slate-700 rounded-full w-14" /></td>
                      <td className="py-3.5 px-4"><div className="h-3.5 bg-slate-700 rounded w-20 mx-auto" /></td>
                      <td className="py-3.5 px-4 text-right"><div className="h-7 bg-slate-700 rounded-lg w-24 ml-auto" /></td>
                    </tr>
                  ))
                ) : filteredVendeurs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Aucun vendeur ne correspond aux critères.
                    </td>
                  </tr>
                ) : (
                  filteredVendeurs.map((v) => {
                    if (!v) return null;
                    const phoneClean = String(v.phone || v.id || '').replace(/\D/g, '');
                    const dateFormatted = v.created_at ? new Date(v.created_at).toLocaleDateString('fr-FR') : 'Récent';

                    return (
                    <tr key={v.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={v.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=100&q=80'}
                            alt=""
                            className="w-9 h-9 rounded-xl object-cover bg-slate-800 border border-slate-700 shrink-0"
                          />
                          <div>
                            <div className="font-bold text-white text-sm">{v.name || `Boutique ${v.phone || v.id}`}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] font-mono bg-sky-950/80 text-sky-300 border border-sky-800/60 px-1.5 py-0.5 rounded font-bold">
                                ID: {v.id}
                              </span>
                              <button
                                onClick={() => handleCopyText(v.id, 'ID')}
                                className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer"
                                title="Copier l’identifiant"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`https://wa.me/${phoneClean}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-emerald-400 font-semibold hover:underline flex items-center gap-1"
                            title="Ouvrir la conversation WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                            <span>{v.phone || v.id}</span>
                          </a>
                          <button
                            onClick={() => handleCopyText(v.phone || v.id, 'Numéro WhatsApp')}
                            className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer"
                            title="Copier le numéro"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Créé le {dateFormatted}
                        </div>
                      </td>

                      {/* Interactive Switch ON / OFF */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(v)}
                            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                              v.is_active !== false && v.status !== 'Inactif' ? 'bg-[#25D366]' : 'bg-slate-700 border border-slate-600'
                            }`}
                            title={v.is_active !== false && v.status !== 'Inactif' ? 'Désactiver ce compte' : 'Activer ce compte'}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                                v.is_active !== false && v.status !== 'Inactif' ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            v.is_active !== false && v.status !== 'Inactif'
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                              : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                          }`}>
                            {v.is_active !== false && v.status !== 'Inactif' ? 'ON' : 'OFF'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-slate-200">{v.location || 'Non renseigné'}</div>
                        <span className="text-[10px] font-bold text-emerald-400">{v.currency}</span>
                      </td>

                      <td className="py-3 px-4 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            v.status === 'VIP'
                              ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                              : v.status === 'Inactif'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {v.status}
                          </span>
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            Plan {v.plan || (v.status === 'VIP' ? 'VIP' : 'Essai')}
                          </span>
                        </div>
                        {v.trialStartedAt && v.trialEndsAt ? (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Essai : {new Date(v.trialStartedAt).toLocaleDateString('fr-FR')} → {new Date(v.trialEndsAt).toLocaleDateString('fr-FR')}
                          </div>
                        ) : v.trialEndsAt ? (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Fin essai : {new Date(v.trialEndsAt).toLocaleDateString('fr-FR')}
                          </div>
                        ) : null}
                      </td>

                      <td className="py-3 px-4 text-center font-mono">
                        <span className="text-sky-400">{v.views || 0}</span> / {' '}
                        <span className="text-amber-400">{v.product_clicks || 0}</span> / {' '}
                        <span className="text-emerald-400 font-bold">{v.conversions || 0}</span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Open Public Store */}
                          <a
                            href={`?vendeur=${encodeURIComponent(v.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                            title="Ouvrir la boutique en ligne"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>

                          {/* Toggle VIP */}
                          <button
                            onClick={() => handleToggleVip(v)}
                            className={`p-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                              v.status === 'VIP'
                                ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                                : 'bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-amber-300 border border-amber-400/30'
                            }`}
                            title={v.status === 'VIP' ? 'Rétrograder en Gratuit' : 'Passer en VIP'}
                          >
                            <Crown className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Active */}
                          <button
                            onClick={() => handleToggleActive(v)}
                            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                              v.status === 'Inactif'
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/40'
                            }`}
                            title={v.status === 'Inactif' ? 'Activer' : 'Désactiver'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>

                          {/* Impersonate / Open store */}
                          <button
                            onClick={() => onImpersonateVendeur(v)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                          >
                            Gérer
                          </button>

                          {/* Delete Vendor */}
                          <button
                            onClick={() => handleDeleteVendor(v)}
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
                            title="Supprimer définitivement ce vendeur"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};
