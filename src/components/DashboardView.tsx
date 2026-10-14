import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  Vendeur, 
  Product, 
  SystemConfig, 
  CurrencyType 
} from '../types';
import { 
  Eye, 
  MousePointerClick, 
  MessageCircle, 
  TrendingUp, 
  Share2, 
  QrCode, 
  ExternalLink, 
  Copy, 
  Download, 
  Sparkles, 
  Crown, 
  ShoppingBag,
  ArrowUpRight,
  Clock,
  UserCheck
} from 'lucide-react';
import { formatCurrency } from '../services/aiGenerator';
import { useToast } from './Toast';
import { StoreVisitsChart } from './StoreVisitsChart';

interface DashboardViewProps {
  vendeur: Vendeur;
  products: Product[];
  config: SystemConfig;
  onOpenStore: () => void;
  onNavigateToCatalog: () => void;
  onNavigateToAI: () => void;
  onNavigateToProfile: () => void;
  onOpenUpgradeModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  vendeur,
  products,
  config,
  onOpenStore,
  onNavigateToCatalog,
  onNavigateToAI,
  onNavigateToProfile,
  onOpenUpgradeModal,
}) => {
  const { showToast } = useToast();
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Unique Clean Store URL: domain.com/v/ID_VENDEUR
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const storeUrl = `${origin}/v/${encodeURIComponent(vendeur?.id || 'store')}`;

  useEffect(() => {
    QRCode.toDataURL(storeUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF'
      }
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('QR code generation error', err));
  }, [storeUrl]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(storeUrl);
    showToast('Lien unique de votre catalogue copié !', 'success');
  };

  const handleShareWhatsApp = () => {
    const storeName = vendeur?.name || 'Notre Boutique';
    const slogan = vendeur?.slogan ? `_${vendeur.slogan}_\n` : '';
    const loc = vendeur?.location ? `📍 ${vendeur.location}\n\n` : '\n';
    const text = encodeURIComponent(
      `👋 Bonjour ! Découvrez notre catalogue en ligne et commandez directement sur WhatsApp :\n\n🛍️ *${storeName}*\n${slogan}${loc}👉 Cliquez ici pour voir nos articles : ${storeUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `qrcode_${(vendeur?.name || 'boutique').replace(/\s+/g, '_').toLowerCase()}.png`;
    link.href = qrDataUrl;
    link.click();
    showToast('QR Code téléchargé avec succès !', 'success');
  };

  // Compute metrics safely
  const totalViews = vendeur?.views || 0;
  const safeProducts = Array.isArray(products) ? products : [];
  const totalClicks = (vendeur?.product_clicks || 0) + safeProducts.reduce((acc, p) => acc + (p?.clicks || 0), 0);
  const totalConversions = vendeur?.conversions || 0;
  const conversionRate = totalViews > 0 ? ((totalConversions / totalViews) * 100).toFixed(1) : '0.0';

  const now = Date.now();
  const vipEndsAt = (vendeur as any)?.vipEndsAt;
  const isVipActive = (vendeur?.status === 'VIP' || (vendeur as any)?.plan === 'VIP') &&
    (!vipEndsAt || new Date(vipEndsAt).getTime() > now);
  const isFreeTier = vendeur?.status === 'Gratuit' || (vendeur as any)?.plan === 'Gratuit';
  const trialStart = (vendeur as any)?.trialStartedAt || (vendeur as any)?.createdAt || vendeur?.created_at;
  const trialStartMs = trialStart ? new Date(trialStart).getTime() : Number.NaN;
  const legacyTrialEnd = vendeur?.trialEndsAt || vendeur?.date_expiration_essai;
  const legacyTrialEndMs = legacyTrialEnd ? new Date(legacyTrialEnd).getTime() : Number.NaN;
  const trialEndMs = Number.isFinite(trialStartMs) ? trialStartMs + 3 * 86400000 : legacyTrialEndMs;
  const isRestricted = !isVipActive && (isFreeTier || !Number.isFinite(trialEndMs) || trialEndMs <= now);

  return (
    <div id="dashboard-view" className="space-y-6">
      {/* Top Welcome / Store Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#25D366]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <img
              src={vendeur.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80'}
              alt={vendeur.name}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-white/20 shadow-md shrink-0 bg-white"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{vendeur.name}</h1>
                <span className="bg-sky-950/80 text-sky-300 border border-sky-700/60 px-2 py-0.5 rounded-lg text-xs font-mono font-bold">
                  ID: {vendeur.id}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  vendeur.status === 'VIP' 
                    ? 'bg-amber-400 text-slate-950' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {vendeur.status === 'VIP' ? '★ VIP' : (config.trialDays || config.trial_days ? `Essai ${config.trialDays || config.trial_days}j` : 'Essai Gratuit')}
                </span>
              </div>
              <p className="text-slate-300 text-sm mt-0.5">{vendeur.slogan || 'Boutique WhatsApp'}</p>
              <p className="text-slate-400 text-xs mt-1">📍 {vendeur.location} • Devise : <strong>{vendeur.currency}</strong></p>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2.5">
            <button
              id="btn-edit-profile"
              onClick={onNavigateToProfile}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold px-3.5 py-2.5 rounded-xl border border-white/15 text-sm transition-all cursor-pointer"
              title="Modifier mon profil, mon numéro WhatsApp et mon mot de passe"
            >
              <UserCheck className="w-4 h-4 text-emerald-300" />
              <span>Mon Profil</span>
            </button>

            <button
              id="btn-preview-store"
              onClick={onOpenStore}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-md text-sm transition-all cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Voir boutique</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-share-whatsapp"
              onClick={handleShareWhatsApp}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold px-4 py-2.5 rounded-xl border border-white/15 text-sm transition-all cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-[#25D366]" />
              <span>Partager</span>
            </button>

            <button
              id="btn-open-qr"
              onClick={() => setQrModalOpen(true)}
              className="flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white p-2.5 rounded-xl border border-white/15 transition-all cursor-pointer"
              title="Afficher le Code QR"
            >
              <QrCode className="w-5 h-5 text-amber-300" />
            </button>
          </div>
        </div>
      </div>

      {/* Unique Client Catalog Link Card */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-emerald-300/60 shadow-sm relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                Lien Unique Catalogue Client
              </span>
              <span className="text-xs font-mono font-bold bg-slate-900 text-emerald-400 px-2.5 py-0.5 rounded-full">
                ID Vendeur : {vendeur.id}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                • Isolation stricte des produits
              </span>
            </div>
            <p className="text-slate-600 text-xs sm:text-sm">
              Donnez ce lien unique à vos clients pour qu’ils commandent uniquement dans votre propre catalogue :
            </p>
            <div className="flex items-center gap-2 pt-1 font-mono text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 break-all select-all">
              <span className="text-emerald-600 font-bold shrink-0">🔗</span>
              <span className="font-semibold text-emerald-800">{storeUrl}</span>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs shadow-xs transition-all cursor-pointer"
            >
              <Copy className="w-4 h-4 text-emerald-400" />
              <span>Copier le lien</span>
            </button>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-3.5 py-2.5 rounded-xl text-xs shadow-xs transition-all cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={onOpenStore}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
              title="Tester le lien"
            >
              <ExternalLink className="w-4 h-4 text-slate-700" />
              <span>Ouvrir</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Views */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vues Boutique</span>
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Eye className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{totalViews}</span>
            <span className="text-xs font-medium text-emerald-600 flex items-center">
              <ArrowUpRight className="w-3 h-3" /> +12%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Visites sur votre catalogue</p>
        </div>

        {/* Card 2: Clicks */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Clics Produits</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <MousePointerClick className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{totalClicks}</span>
            <span className="text-xs font-medium text-amber-600">Intérêt fort</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Fiches produits ouvertes</p>
        </div>

        {/* Card 3: WhatsApp Conversions */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Commandes WA</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#25D366] flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{totalConversions}</span>
            <span className="text-xs font-medium text-emerald-600">Messages reçus</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Clics « Commander sur WhatsApp »</p>
        </div>

        {/* Card 4: Conversion Rate */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Conversion</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{conversionRate}%</span>
            <span className="text-xs font-medium text-purple-600">Visiteur → Client</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Moyenne e-commerce : ~2.5%</p>
        </div>
      </div>

      {/* Data Visualization: Store Daily Visits Evolution (Recharts) */}
      <StoreVisitsChart vendeur={vendeur} onOpenStore={onOpenStore} />

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Commercial AI Card */}
        <div 
          onClick={onNavigateToAI}
          className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:border-[#25D366] transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Sparkles className="w-5 h-5 text-[#25D366]" />
              </div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-1">
                Générateur Vente
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
              Générateur Commercial IA
            </h3>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 leading-relaxed">
              Créez des scripts de prospection, relance, traitement des objections et promotions percutants pour vos clients WhatsApp.
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-800">
            <span>Rédiger un message percutant</span>
            <ArrowUpRight className="w-4 h-4 text-[#25D366] group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </div>
        </div>

        {/* Catalog Manager Card */}
        <div 
          onClick={onNavigateToCatalog}
          className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:border-slate-400 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                {products.length} {products.length > 1 ? 'articles' : 'article'}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-slate-700 transition-colors">
              Gestionnaire de Catalogue
            </h3>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 leading-relaxed">
              Ajoutez vos produits avec jusqu’à 3 photos, prix normaux et barrés, descriptions assistées par IA et partage instantané.
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-800">
            <span>Gérer mes produits & photos</span>
            <ArrowUpRight className="w-4 h-4 text-slate-800 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </div>
        </div>
      </div>

      {/* Catalog Preview Snippet */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Articles en ligne</h3>
            <p className="text-xs text-slate-500">
              {isRestricted ? 'Compte Essai : seuls les 4 plus récents sont visibles sur votre boutique' : 'Tous vos articles sont visibles par vos acheteurs'}
            </p>
          </div>
          <button
            onClick={onNavigateToCatalog}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
          >
            Tout voir ({products.length})
          </button>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
            <p className="text-sm font-medium text-slate-600">Aucun produit dans votre catalogue</p>
            <button
              onClick={onNavigateToCatalog}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[#25D366] hover:bg-[#20ba59] px-3.5 py-2 rounded-lg"
            >
              Ajouter mon premier produit
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {products.slice(0, 4).map((product) => (
              <div key={product.id} className="group rounded-xl border border-slate-100 overflow-hidden bg-slate-50 flex flex-col">
                <div className="aspect-square w-full overflow-hidden bg-slate-200 relative">
                  <img
                    src={product?.images?.[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80'}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {product.original_price && product.original_price > product.price && (
                    <span className="absolute top-1.5 right-1.5 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                      PROMO
                    </span>
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col justify-between">
                  <h4 className="text-xs font-semibold text-slate-900 line-clamp-1">{product.name}</h4>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xs font-bold text-slate-900">
                      {formatCurrency(product.price, vendeur.currency)}
                    </span>
                    {product.original_price && (
                      <span className="text-[10px] text-slate-400 line-through">
                        {formatCurrency(product.original_price, vendeur.currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {qrModalOpen && (
        <div 
          id="qr-code-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
          onClick={() => setQrModalOpen(false)}
        >
          <div 
            className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto mb-3">
              <QrCode className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">Code QR de votre Boutique</h3>
            <p className="text-xs text-slate-500 mt-1">
              Imprimez-le sur vos flyers, comptoirs ou emballages colis pour que vos clients scannent et commandent !
            </p>

            {qrDataUrl && (
              <div className="my-5 p-4 bg-slate-50 rounded-2xl inline-block border border-slate-200">
                <img src={qrDataUrl} alt="QR Code Boutique" className="w-56 h-56 mx-auto rounded-lg" />
              </div>
            )}

            <div className="space-y-2">
              <button
                id="btn-download-qr"
                onClick={handleDownloadQr}
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-3 rounded-xl shadow-md text-sm"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger l’image (PNG)</span>
              </button>

              <button
                onClick={handleCopyLink}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold py-2.5 rounded-xl text-xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copier le lien web</span>
              </button>

              <button
                onClick={() => setQrModalOpen(false)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1.5"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
