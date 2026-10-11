import React, { useState, useEffect } from 'react';
import { 
  Vendeur, 
  Product, 
  Prospect, 
  SystemConfig, 
  AIMessageParams,
  PublicStoreProfile 
} from './types';
import { ApiService, initSeedData, DEFAULT_CONFIG } from './services/api';
import { AuthService } from './services/authService';
import { auth, onAuthStateChanged } from './firebase';
import { ToastProvider, useToast } from './components/Toast';
import { TrialBanner } from './components/TrialBanner';
import { VipUpgradeModal } from './components/VipUpgradeModal';
import { LoginModal } from './components/LoginModal';
import { DashboardView } from './components/DashboardView';
import { CatalogManager } from './components/CatalogManager';
import { AIMessageGenerator } from './components/AIMessageGenerator';
import { ProspectsCRM } from './components/ProspectsCRM';
import { BrandingSettings } from './components/BrandingSettings';
import { PublicStore } from './components/PublicStore';
import { AdminPortal } from './components/AdminPortal';
import { PWAInstallBanner } from './components/PWAInstaller';
import { ErrorBoundary } from './components/ErrorBoundary';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Sparkles, 
  Users, 
  Palette, 
  ShieldCheck, 
  ExternalLink, 
  LogOut, 
  Crown,
  MessageCircle,
  Menu,
  X,
  UserCheck,
  ArrowLeft
} from 'lucide-react';

type ActiveTab = 'dashboard' | 'catalog' | 'ai' | 'crm' | 'branding';

// Utility to inspect URL parameters and hash routes for instant public store / admin access
const getInitialRouteInfo = () => {
  if (typeof window === 'undefined') return { mode: 'app' as const, targetVendeurId: null };
  const urlParams = new URLSearchParams(window.location.search);
  const vParam = urlParams.get('vendeur') || urlParams.get('v') || urlParams.get('store') || urlParams.get('catalog') || urlParams.get('catalogue');
  if (vParam) {
    return { mode: 'store' as const, targetVendeurId: vParam.trim() };
  }

  // Check pathname: e.g. /v/VEND-101 or /catalogue/VEND-101 or /catalog/VEND-101 or /store/VEND-101
  const pathMatch = window.location.pathname.match(/\/(?:v|catalogue|catalog|store)\/([^/?#]+)/i);
  if (pathMatch && pathMatch[1]) {
    return { mode: 'store' as const, targetVendeurId: decodeURIComponent(pathMatch[1]).trim() };
  }

  // Check hash: e.g. #/v/VEND-101 or #/catalogue/VEND-101 or #vendeur=VEND-101 or #v=VEND-101
  const hash = window.location.hash;
  const hashMatch = hash.match(/#(?:(?:\/(?:v|catalogue|catalog|store)\/)|(?:vendeur=)|(?:v=))([^&?]+)/i);
  if (hashMatch && hashMatch[1]) {
    return { mode: 'store' as const, targetVendeurId: decodeURIComponent(hashMatch[1]).trim() };
  }

  const roleParam = (urlParams.get('role') || '').toLowerCase();
  const isAdmin = roleParam === 'admin' || urlParams.get('admin') === 'true';
  const pathname = window.location.pathname.toLowerCase();

  if (isAdmin || pathname === '/admin' || pathname.endsWith('/admin') || hash === '#/admin' || hash === '#admin') {
    return { mode: 'admin' as const, targetVendeurId: null };
  }

  return { mode: 'app' as const, targetVendeurId: null };
};

function MainApp() {
  const { showToast } = useToast();
  const initialRoute = getInitialRouteInfo();

  // Core state
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [activeVendeur, setActiveVendeur] = useState<Vendeur | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selectedAiProspectId, setSelectedAiProspectId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isVipModalOpen, setIsVipModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Portal routing state - initialized synchronously from URL
  const [viewMode, setViewMode] = useState<'app' | 'store' | 'admin'>(initialRoute.mode);
  const [publicStoreVendeur, setPublicStoreVendeur] = useState<Vendeur | PublicStoreProfile | null>(null);
  const [publicStoreProducts, setPublicStoreProducts] = useState<Product[]>([]);
  const [storeLoading, setStoreLoading] = useState<boolean>(initialRoute.mode === 'store');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Set initial history state on mount
  useEffect(() => {
    if (!window.history.state) {
      if (initialRoute.mode === 'store') {
        window.history.replaceState({ view: 'store', vendeur: initialRoute.targetVendeurId }, '');
      } else if (initialRoute.mode === 'admin') {
        window.history.replaceState({ view: 'admin' }, '');
      } else {
        window.history.replaceState({ view: 'app', tab: 'dashboard' }, '');
      }
    }
  }, []);

  // Global popstate handler for Hardware / Browser Back button
  useEffect(() => {
    const handlePopState = () => {
      // 1. If VIP upgrade modal is open, close it without leaving the app
      if (isVipModalOpen) {
        setIsVipModalOpen(false);
        return;
      }

      // Check current route from URL parameters
      const currentRoute = getInitialRouteInfo();

      // 2. If current URL still indicates a public store, stay in store mode
      if (currentRoute.mode === 'store') {
        if (viewMode !== 'store') {
          setViewMode('store');
        }
        return;
      }

      // 3. If current URL indicates admin, stay in admin mode
      if (currentRoute.mode === 'admin') {
        if (viewMode !== 'admin') {
          setViewMode('admin');
        }
        return;
      }

      // 4. For public visitors without merchant credentials:
      // Never switch to 'app' (which would display the login/signup screen)
      if (!activeVendeur) {
        if (publicStoreVendeur) {
          setViewMode('store');
        }
        return;
      }

      // 5. For logged-in merchants navigating their own workspace:
      if (viewMode !== 'app') {
        setViewMode('app');
        return;
      }

      if (activeTab !== 'dashboard') {
        setActiveTab('dashboard');
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isVipModalOpen, viewMode, activeTab, activeVendeur, publicStoreVendeur]);

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    window.history.pushState({ view: 'app', tab }, '');
  };

  const handleOpenVipModal = () => {
    setIsVipModalOpen(true);
    window.history.pushState({ modal: 'vip_upgrade' }, '');
  };

  const handleCloseVipModal = () => {
    setIsVipModalOpen(false);
    if (window.history.state?.modal === 'vip_upgrade') {
      window.history.back();
    }
  };

  const handleOpenAdmin = () => {
    setViewMode('admin');
    window.history.pushState({ view: 'admin' }, '', '?admin=true');
  };

  const handleBackToApp = () => {
    setViewMode('app');
    window.history.pushState({ view: 'app' }, '', window.location.pathname);
  };

  // Initialize seed data & load active vendor
  useEffect(() => {
    initSeedData();
    const route = getInitialRouteInfo();
    let isSubscribed = true;

    // 1. Non-blocking background config fetch: loads in parallel without delaying Auth
    ApiService.getConfig()
      .then((conf) => {
        if (isSubscribed && conf) {
          setConfig(conf);
        }
      })
      .catch((err) => {
        console.warn('Config fetch error, using defaults:', err);
      });

    // 2. Client route handling (?vendeur=... or /catalog/...)
    if (route.mode === 'store' && route.targetVendeurId) {
      setStoreLoading(true);
      ApiService.getPublicStoreProfile(route.targetVendeurId)
        .then(async (publicStore) => {
          if (!isSubscribed) return;
          if (publicStore) {
            setPublicStoreVendeur(publicStore);
            const prods = await ApiService.getCatalog(publicStore.id);
            if (isSubscribed) {
              setPublicStoreProducts(prods);
              ApiService.trackView(publicStore.id);
            }
          } else {
            setPublicStoreVendeur(null);
            setPublicStoreProducts([]);
          }
        })
        .catch((err) => {
          console.error('Error loading public store:', err);
          if (isSubscribed) {
            setPublicStoreVendeur(null);
          }
        })
        .finally(() => {
          if (isSubscribed) {
            setStoreLoading(false);
          }
        });
    } else if (route.mode === 'admin') {
      setViewMode('admin');
    }

    // Safety timeout: Ensures loading screen never hangs more than 2 seconds
    const safetyTimer = setTimeout(() => {
      if (isSubscribed) {
        setLoading(false);
      }
    }, 2000);

    // 3. Real Firebase Auth state listener registered IMMEDIATELY
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isSubscribed) return;

      if (firebaseUser) {
        try {
          const v = await ApiService.getVendeur(firebaseUser.uid);
          if (!isSubscribed) return;
          if (v) {
            setActiveVendeur(v);
            localStorage.setItem('wca_current_vendeur_id', v.id);
            // Load products and prospects in parallel
            const [prods, prosps] = await Promise.all([
              ApiService.getCatalog(v.id).catch(() => []),
              ApiService.getProspects(v.id).catch(() => []),
            ]);
            if (isSubscribed) {
              setProducts(prods);
              setProspects(prosps);
            }
          } else {
            setActiveVendeur(null);
            localStorage.removeItem('wca_current_vendeur_id');
          }
        } catch (err) {
          console.error('Error fetching merchant profile for auth user:', err);
          if (isSubscribed) {
            setActiveVendeur(null);
          }
        }
      } else {
        setActiveVendeur(null);
        localStorage.removeItem('wca_current_vendeur_id');
      }

      if (isSubscribed) {
        clearTimeout(safetyTimer);
        setLoading(false);
      }
    });

    return () => {
      isSubscribed = false;
      clearTimeout(safetyTimer);
      unsubscribeAuth();
    };
  }, []);

  // When active vendor changes, load their products and prospects
  const reloadVendeurData = async (vendeurId: string) => {
    try {
      const [v, prods, prosps] = await Promise.all([
        ApiService.getVendeur(vendeurId),
        ApiService.getCatalog(vendeurId),
        ApiService.getProspects(vendeurId),
      ]);
      if (v) setActiveVendeur(v);
      setProducts(prods);
      setProspects(prosps);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLoginSuccess = async (vendeur: Vendeur) => {
    setActiveVendeur(vendeur);
    localStorage.setItem('wca_current_vendeur_id', vendeur.id);
    await reloadVendeurData(vendeur.id);
    setViewMode('app');
  };

  const handleLogout = () => {
    localStorage.removeItem('wca_current_vendeur_id');
    AuthService.logout().catch(() => {});
    setActiveVendeur(null);
    showToast('Déconnexion effectuée', 'info');
  };

  // Continuous synchronization: trial days updates, ON/OFF account toggle, VIP status changes, Pack VIP price & WhatsApp support
  useEffect(() => {
    const syncLatest = async () => {
      try {
        const latestConfig = await ApiService.getConfig();
        if (latestConfig) {
          setConfig(prev => (JSON.stringify(prev) !== JSON.stringify(latestConfig) ? latestConfig : prev));
        }
        if (activeVendeur) {
          const latestVendeur = await ApiService.getVendeur(activeVendeur.id);
          if (latestVendeur) {
            setActiveVendeur(prev => {
              if (!prev) return latestVendeur;
              if (
                prev.status !== latestVendeur.status ||
                prev.is_active !== latestVendeur.is_active ||
                prev.date_expiration_essai !== latestVendeur.date_expiration_essai ||
                JSON.stringify(prev) !== JSON.stringify(latestVendeur)
              ) {
                return latestVendeur;
              }
              return prev;
            });
          }
        }
      } catch {
        // silent polling catch
      }
    };

    // Poll every 2.5 seconds so trial countdown, VIP status and prices react to admin changes
    const interval = setInterval(syncLatest, 2500);

    const handleVendorUpdate = (e: any) => {
      if (!activeVendeur) return;
      const d = e.detail;
      const isMatch = !d || (
        (d.id && activeVendeur.id && d.id.toLowerCase() === activeVendeur.id.toLowerCase()) ||
        (d.phone && activeVendeur.phone && d.phone.replace(/\D/g, '') === activeVendeur.phone.replace(/\D/g, ''))
      );
      if (isMatch) {
        if (d && d.status) {
          setActiveVendeur(prev => prev ? ({ ...prev, ...d }) : d);
        }
        syncLatest();
      }
    };

    const handleConfigUpdate = (e: any) => {
      if (e.detail) {
        setConfig(e.detail);
      }
      syncLatest();
    };

    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === 'wca_last_config_update' || 
        e.key === 'wca_last_vendor_update' || 
        e.key === 'wca_config' || 
        e.key === 'wca_vendeurs'
      ) {
        syncLatest();
      }
    };

    window.addEventListener('wca_vendor_updated', handleVendorUpdate);
    window.addEventListener('wca_config_updated', handleConfigUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(interval);
      window.removeEventListener('wca_vendor_updated', handleVendorUpdate);
      window.removeEventListener('wca_config_updated', handleConfigUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [activeVendeur?.id, activeVendeur?.phone]);

  // Open store view
  const handleOpenStore = async (vendeurToOpen?: Vendeur) => {
    const target = vendeurToOpen || activeVendeur;
    if (!target) return;
    setPublicStoreVendeur(target);
    setStoreLoading(true);
    setViewMode('store');
    window.history.pushState({ view: 'store', vendeur: target.id }, '', `?vendeur=${encodeURIComponent(target.id)}`);
    const prods = await ApiService.getCatalog(target.id);
    setPublicStoreProducts(prods);
    setStoreLoading(false);
  };

  // Catalog actions
  const handleSaveProduct = async (productData: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }) => {
    if (!activeVendeur) return;
    await ApiService.saveProduct(activeVendeur.id, productData);
    const updated = await ApiService.getCatalog(activeVendeur.id);
    setProducts(updated);
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!activeVendeur) return;
    await ApiService.deleteProduct(activeVendeur.id, productId);
    setProducts(products.filter(p => p.id !== productId));
  };

  // CRM actions
  const handleSaveProspect = async (prospectData: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }) => {
    if (!activeVendeur) return;
    await ApiService.saveProspect(activeVendeur.id, prospectData);
    const updated = await ApiService.getProspects(activeVendeur.id);
    setProspects(updated);
  };

  const handleDeleteProspect = async (prospectId: string) => {
    if (!activeVendeur) return;
    await ApiService.deleteProspect(activeVendeur.id, prospectId);
    setProspects(prospects.filter(p => p.id !== prospectId));
  };

  // Branding update
  const handleUpdateBranding = async (data: Partial<Vendeur>) => {
    if (!activeVendeur) return;
    const updated = await ApiService.updateBranding(activeVendeur.id, data);
    setActiveVendeur(updated);
  };

  // Admin config update
  const handleUpdateConfig = async (newConf: Partial<SystemConfig>): Promise<SystemConfig> => {
    const updated = await ApiService.updateConfig(newConf);
    setConfig(updated);
    return updated;
  };

  // Instant VIP activation toggle for testing
  const handleActivateVIPInstant = async () => {
    if (!activeVendeur) return;
    const newStatus = activeVendeur.status === 'VIP' ? 'Gratuit' : 'VIP';
    await ApiService.updateVendeurStatus(activeVendeur.id, newStatus);
    setActiveVendeur({ ...activeVendeur, status: newStatus });
    showToast(`Pack VIP ${newStatus === 'VIP' ? 'activé avec succès !' : 'désactivé'}`, 'success');
  };

  // Navigate to AI with specific prospect
  const handleSelectProspectForAI = (prospect: Prospect) => {
    setSelectedAiProspectId(prospect.id);
    setActiveTab('ai');
    window.history.pushState({ view: 'app', tab: 'ai' }, '');
    showToast(`Prospect ${prospect.name} sélectionné pour le coach IA`, 'info');
  };

  // 1. PUBLIC STORE VIEW
  if (viewMode === 'store') {
    if (storeLoading && !publicStoreVendeur) {
      return (
        <div id="store-skeleton-screen" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-[#25D366]/20 border border-[#25D366]/30 text-[#25D366] flex items-center justify-center mx-auto animate-pulse shadow-sm">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Chargement de la boutique...</h2>
              <p className="text-xs text-slate-500 mt-1">Connexion directe avec le catalogue du vendeur.</p>
            </div>
          </div>
        </div>
      );
    }

    if (publicStoreVendeur || activeVendeur) {
      const storeTarget = publicStoreVendeur || activeVendeur!;

      // Guard: if store account is deactivated (OFF), show polite notice to customer
      if (storeTarget.is_active === false || storeTarget.status === 'Inactif') {
        const contactDigits = ((storeTarget as PublicStoreProfile).orderWhatsApp || (storeTarget as Vendeur).phone || '').replace(/\D/g, '');
        return (
          <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-800/90 border border-slate-700 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-white">Boutique Momentanément Indisponible</h2>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Le catalogue en ligne de <strong className="text-white">{storeTarget.name}</strong> est actuellement en pause ou désactivé par l’administration.
              </p>
              {contactDigits && (
                <div className="pt-2">
                  <a
                    href={`https://wa.me/${contactDigits}?text=${encodeURIComponent(`Bonjour ${storeTarget.name}, je souhaitais consulter votre catalogue en ligne.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-3 px-4 rounded-xl text-xs shadow-md transition-all"
                  >
                    <MessageCircle className="w-4 h-4 fill-current" />
                    <span>Contacter {storeTarget.name} sur WhatsApp</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      }

      return (
        <PublicStore
          vendeur={storeTarget}
          products={publicStoreProducts.length > 0 ? publicStoreProducts : products}
          isLoading={storeLoading}
          isMerchantPreview={Boolean(activeVendeur && activeVendeur.id === storeTarget.id)}
          onBackToDashboard={activeVendeur && activeVendeur.id === storeTarget.id ? handleBackToApp : undefined}
        />
      );
    }

    // If store was not found (invalid public slug or deleted store), show safe 404 screen
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-800/90 border border-slate-700 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-700 text-slate-400 flex items-center justify-center mx-auto">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Boutique introuvable</h2>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Le lien de boutique que vous avez suivi n'existe pas ou n'est plus actif.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.history.length > 1) {
                  window.history.back();
                } else {
                  window.location.reload();
                }
              }}
              className="bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-2.5 px-5 rounded-xl text-xs transition-all cursor-pointer inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Retour à la page précédente</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. ADMIN PORTAL VIEW
  if (viewMode === 'admin') {
    return (
      <>
        <PWAInstallBanner enabled={true} />
        <AdminPortal
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onBackToApp={handleBackToApp}
          onImpersonateVendeur={async (v) => {
            setActiveVendeur(v);
            localStorage.setItem('wca_current_vendeur_id', v.id);
            await reloadVendeurData(v.id);
            setViewMode('app');
            showToast(`Connecté sur le compte de ${v.name || v.phone}`, 'info');
          }}
        />
      </>
    );
  }

  // 3. LOGIN IF NOT AUTHENTICATED
  if (!activeVendeur && !loading) {
    return <LoginModal onLoginSuccess={handleLoginSuccess} />;
  }

  if (loading || !activeVendeur) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#25D366]/20 border border-[#25D366]/40 text-[#25D366] flex items-center justify-center mx-auto animate-pulse">
            <MessageCircle className="w-6 h-6 fill-current" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Chargement de votre espace vendeur...</p>
        </div>
      </div>
    );
  }

  // Guard: if current vendor account is deactivated (OFF) by Admin
  if (activeVendeur.is_active === false || activeVendeur.status === 'Inactif') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center mx-auto">
            <LogOut className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Compte Vendeur Désactivé</h2>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Votre compte vendeur (<span className="text-white font-mono">{activeVendeur.phone}</span> • <span className="text-sky-400 font-mono">{activeVendeur.id}</span>) a été désactivé par l’administrateur (Position OFF).
          </p>
          <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
            L’accès à vos outils et à votre boutique est temporairement suspendu.
          </div>
          <div className="space-y-2 pt-2">
            <a
              href={`https://wa.me/${(config.whatsapp_support || '+212600000000').replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour, mon compte vendeur ${activeVendeur.id} (${activeVendeur.phone}) est désactivé. Pouvez-vous m'aider à le réactiver ?`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-3 px-4 rounded-xl text-xs transition-all"
            >
              <MessageCircle className="w-4 h-4 fill-current" />
              <span>Contacter le support WhatsApp</span>
            </a>
            <button
              onClick={handleLogout}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer"
            >
              Se déconnecter / Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. MAIN MERCHANT DASHBOARD
  const navItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'catalog', label: 'Catalogue', icon: ShoppingBag, badge: products.length },
    { id: 'ai', label: 'Commercial IA', icon: Sparkles, highlight: true },
    { id: 'crm', label: 'CRM Prospects', icon: Users, badge: prospects.length },
    { id: 'branding', label: 'Mon Profil & Sécurité', icon: UserCheck },
  ];

  return (
    <div id="merchant-app" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col pb-24 md:pb-10 font-sans">
      {/* Selective PWA Installation Banner (Merchant only, never in Public Store) */}
      <PWAInstallBanner enabled={true} />

      {/* Dynamic Trial Banner */}
      <TrialBanner
        vendeur={activeVendeur}
        config={config}
        onOpenUpgradeModal={handleOpenVipModal}
      />

      {/* Main Top Header */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#25D366] text-slate-950 flex items-center justify-center font-bold shadow-md shadow-[#25D366]/20 shrink-0">
              <MessageCircle className="w-6 h-6 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-slate-950">
                  WhatsApp Commercial AI
                </span>
                <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  SaaS Vendeur
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block truncate max-w-xs">
                {activeVendeur.name} ({activeVendeur.phone})
              </p>
            </div>
          </div>

          {/* Desktop Tab Links */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectTab(item.id as ActiveTab)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${item.highlight ? 'text-[#25D366]' : ''}`} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Top Right Quick Actions */}
          <div className="flex items-center gap-2">
            {/* View store button */}
            <button
              onClick={() => handleOpenStore()}
              className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title="Aperçu de la boutique en ligne"
            >
              <ShoppingBag className="w-3.5 h-3.5 text-[#25D366]" />
              <span className="hidden sm:inline">Ma Boutique</span>
              <ExternalLink className="w-3 h-3 text-emerald-600" />
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 transition-colors cursor-pointer"
              title="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full">
        {activeTab === 'dashboard' && (
          <DashboardView
            vendeur={activeVendeur}
            products={products}
            config={config}
            onOpenStore={() => handleOpenStore()}
            onNavigateToCatalog={() => handleSelectTab('catalog')}
            onNavigateToAI={() => handleSelectTab('ai')}
            onNavigateToProfile={() => handleSelectTab('branding')}
            onOpenUpgradeModal={handleOpenVipModal}
          />
        )}

        {activeTab === 'catalog' && (
          <CatalogManager
            vendeur={activeVendeur}
            products={products}
            onSaveProduct={handleSaveProduct}
            onDeleteProduct={handleDeleteProduct}
            onOpenStore={() => handleOpenStore()}
            onOpenUpgradeModal={handleOpenVipModal}
          />
        )}

        {activeTab === 'ai' && (
          <AIMessageGenerator
            vendeur={activeVendeur}
            products={products}
            prospects={prospects}
            initialProspectId={selectedAiProspectId}
            onOpenUpgradeModal={handleOpenVipModal}
          />
        )}

        {activeTab === 'crm' && (
          <ProspectsCRM
            vendeur={activeVendeur}
            prospects={prospects}
            onSaveProspect={handleSaveProspect}
            onDeleteProspect={handleDeleteProspect}
            onSelectForAI={handleSelectProspectForAI}
            onOpenUpgradeModal={handleOpenVipModal}
          />
        )}

        {activeTab === 'branding' && (
          <BrandingSettings
            vendeur={activeVendeur}
            onUpdateBranding={handleUpdateBranding}
          />
        )}
      </main>

      {/* Mobile-First Bottom Navigation Bar */}
      <nav 
        id="mobile-bottom-nav"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 flex items-center justify-around shadow-lg"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleSelectTab(item.id as ActiveTab)}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all relative cursor-pointer ${
                isActive ? 'text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive && item.highlight ? 'text-[#25D366]' : ''}`} />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#25D366] text-slate-950 text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight truncate max-w-[64px]">
                {item.label}
              </span>
              {isActive && (
                <span className="w-1 h-1 bg-[#25D366] rounded-full absolute bottom-0.5" />
              )}
            </button>
          );
        })}
      </nav>

      {/* VIP Upgrade Modal */}
      <VipUpgradeModal
        isOpen={isVipModalOpen}
        onClose={handleCloseVipModal}
        vendeur={activeVendeur}
        config={config}
        onActivateVIPInstant={handleActivateVIPInstant}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <MainApp />
      </ToastProvider>
    </ErrorBoundary>
  );
}
