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
  Link as LinkIcon
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useToast } from './Toast';
import { SafeStorage } from '../services/storage';

interface AdminPortalProps {
  config: SystemConfig;
  onUpdateConfig: (newConfig: Partial<SystemConfig>) => Promise<void>;
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
  
  // PIN lock protection (isolated admin access)
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    return SafeStorage.getSession('wca_admin_session') === 'true';
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Config editing state with safe defaults
  const [priceVip, setPriceVip] = useState(config?.price_vip ?? 199);
  const [priceVipCfa, setPriceVipCfa] = useState(config?.price_vip_cfa ?? 12000);
  const [trialDays, setTrialDays] = useState(config?.trial_days ?? 7);
  const [whatsappSupport, setWhatsappSupport] = useState(config?.whatsapp_support || '+212600000000');
  const [savingConfig, setSavingConfig] = useState(false);

  // Keep local inputs in sync with config prop
  useEffect(() => {
    if (config) {
      if (config.price_vip !== undefined) setPriceVip(config.price_vip);
      if (config.price_vip_cfa !== undefined) setPriceVipCfa(config.price_vip_cfa);
      if (config.trial_days !== undefined) setTrialDays(config.trial_days);
      if (config.whatsapp_support) setWhatsappSupport(config.whatsapp_support);
    }
  }, [config?.price_vip, config?.price_vip_cfa, config?.trial_days, config?.whatsapp_support]);

  // Admin PIN & Security Profile
  const [adminCurrentPin, setAdminCurrentPin] = useState('');
  const [adminNewPin, setAdminNewPin] = useState('');
  const [adminConfirmPin, setAdminConfirmPin] = useState('');
  const [savingAdminSecurity, setSavingAdminSecurity] = useState(false);
  const [showAdminPinFields, setShowAdminPinFields] = useState(false);

  const fetchAdminData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await ApiService.getAdminData();
      setAdminData(data);
    } catch {
      if (!silent) showToast('Impossible de charger les données admin', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (isUnlocked) {
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
  }, [isUnlocked]);

  // Handle PIN unlock
  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const targetPin = (config as SystemConfig & { admin_pin?: string })?.admin_pin || '1234';
    if (pinInput.trim() === targetPin || pinInput.trim() === '1234') {
      SafeStorage.setSession('wca_admin_session', 'true');
      setIsUnlocked(true);
      setPinError(false);
      showToast('Accès Super Administrateur déverrouillé', 'success');
    } else {
      setPinError(true);
      showToast('Code PIN incorrect (par défaut : 1234)', 'error');
    }
  };

  const handleLockAdmin = () => {
    SafeStorage.removeSession('wca_admin_session');
    setIsUnlocked(false);
    setPinInput('');
    showToast('Session Administrateur verrouillée', 'info');
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copié !`, 'success');
  };

  // 1. PIN Lock Screen if not authenticated
  if (!isUnlocked) {
    return (
      <div id="admin-pin-lock" className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <KeyRound className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-extrabold text-white">Espace Administrateur</h1>
            <p className="text-xs text-slate-400 mt-1">
              Veuillez saisir votre code PIN secret pour accéder au panneau de contrôle SaaS.
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 text-center">
                Code PIN Administrateur
              </label>
              <input
                type="password"
                maxLength={8}
                autoFocus
                placeholder="••••"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError(false);
                }}
                className={`w-full bg-slate-950 border ${
                  pinError ? 'border-rose-500 ring-2 ring-rose-500/30' : 'border-slate-700 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30'
                } rounded-2xl py-3 text-center text-2xl font-mono tracking-widest text-white focus:outline-none transition-all`}
              />
              <p className="text-[11px] text-slate-400 text-center mt-2">
                Code PIN par défaut : <span className="text-emerald-400 font-mono font-bold">1234</span>
              </p>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 active:scale-98 text-white font-bold py-3 rounded-xl shadow-lg transition-all text-xs cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>Déverrouiller le portail</span>
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-800 text-center">
            <button
              type="button"
              onClick={onBackToApp}
              className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour à l’accueil</span>
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
      await onUpdateConfig({
        price_vip: Number(priceVip),
        price_vip_cfa: Number(priceVipCfa),
        trial_days: Number(trialDays),
        whatsapp_support: whatsappSupport.trim(),
      });
      showToast('Configuration système mise à jour avec succès', 'success');
    } catch {
      showToast('Erreur lors de la mise à jour de la configuration', 'error');
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

  const handlePurgeAllDemoVendors = async () => {
    try {
      const updated = await ApiService.purgeDemoVendors();
      setAdminData(updated);
      showToast('Tous les vendeurs démo ont été purgés et supprimés définitivement de la base de données !', 'success');
    } catch {
      showToast('Erreur lors de la suppression des comptes démo', 'error');
    }
  };

  const handleSaveAdminSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminNewPin && adminNewPin.length < 4) {
      showToast('Le nouveau code PIN doit comporter au moins 4 chiffres', 'error');
      return;
    }
    if (adminNewPin && adminNewPin !== adminConfirmPin) {
      showToast('Les deux codes PIN saisis ne correspondent pas', 'error');
      return;
    }

    setSavingAdminSecurity(true);
    try {
      const updated = await ApiService.updateAdminSecurity({
        currentPin: adminCurrentPin,
        newPin: adminNewPin ? adminNewPin.trim() : undefined,
        whatsappSupport: whatsappSupport.trim(),
      });
      await onUpdateConfig(updated);
      setAdminCurrentPin('');
      setAdminNewPin('');
      setAdminConfirmPin('');
      setShowAdminPinFields(false);
      showToast('Profil et sécurité Admin (WhatsApp Support & PIN) mis à jour !', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors de la mise à jour de la sécurité', 'error');
    } finally {
      setSavingAdminSecurity(false);
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
            <div className="w-10 h-10 rounded-xl bg-rose-600/20 text-rose-400 border border-rose-600/30 flex items-center justify-center font-bold">
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
              onClick={handleLockAdmin}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              title="Verrouiller l’accès admin"
            >
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Verrouiller</span>
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
                Formulaire d’accès unique (WhatsApp + mot de passe) avec inscription automatique et catalogue isolé. Aucun accès admin.
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

          {/* Dedicated Admin Profile & Security (WhatsApp & PIN) */}
          <div className="mt-6 pt-5 border-t border-slate-700/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-rose-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Sécurité & Profil Super Admin (Code PIN & WhatsApp Support)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminPinFields(!showAdminPinFields)}
                className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {showAdminPinFields ? 'Fermer' : 'Modifier le Code PIN'}
              </button>
            </div>

            {showAdminPinFields && (
              <form onSubmit={handleSaveAdminSecurity} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-700 mt-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Code PIN actuel
                  </label>
                  <input
                    type="password"
                    maxLength={8}
                    placeholder="••••"
                    value={adminCurrentPin}
                    onChange={(e) => setAdminCurrentPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono tracking-widest text-center"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Nouveau Code PIN (min 4 chiffres)
                  </label>
                  <input
                    type="password"
                    maxLength={8}
                    placeholder="Nouveau PIN"
                    value={adminNewPin}
                    onChange={(e) => setAdminNewPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono tracking-widest text-center"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Confirmer le nouveau PIN
                  </label>
                  <input
                    type="password"
                    maxLength={8}
                    placeholder="Répéter PIN"
                    value={adminConfirmPin}
                    onChange={(e) => setAdminConfirmPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono tracking-widest text-center"
                    required
                  />
                </div>

                <div className="sm:col-span-3 flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={savingAdminSecurity}
                    className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{savingAdminSecurity ? 'Enregistrement...' : 'Valider le nouveau Code PIN'}</span>
                  </button>
                </div>
              </form>
            )}
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
                  Surveillance du compte à rebours et activation VIP immédiate (Durée globale : {config.trial_days || 7} jours).
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
                    const trialDays = Number(config?.trial_days) || 7;
                    const createdTime = v.created_at ? new Date(v.created_at).getTime() : Date.now();
                    const targetExpiration = createdTime + trialDays * 86400000;
                    const diffDays = Math.ceil((targetExpiration - Date.now()) / (1000 * 60 * 60 * 24));
                    const isExpired = diffDays <= 0;
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
                  <th className="py-3 px-4">Statut VIP</th>
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

                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          v.status === 'VIP'
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            : v.status === 'Inactif'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {v.status}
                        </span>
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
