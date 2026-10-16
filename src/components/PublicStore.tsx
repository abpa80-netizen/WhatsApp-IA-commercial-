import React, { useState, useEffect } from 'react';
import { Vendeur, Product, PublicStoreProfile } from '../types';
import { 
  ShoppingBag, 
  MessageCircle, 
  MapPin, 
  Check, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  ArrowLeft, 
  Eye,
  Search,
  Crown
} from 'lucide-react';
import { formatCurrency } from '../services/aiGenerator';
import { ApiService } from '../services/api';
import { useToast } from './Toast';
import { getVendorEntitlements } from '../services/entitlements';

interface PublicStoreProps {
  vendeur: Vendeur | PublicStoreProfile;
  products: Product[];
  onBackToDashboard?: () => void;
  isMerchantPreview?: boolean;
  isLoading?: boolean;
}

export const PublicStore: React.FC<PublicStoreProps> = ({
  vendeur,
  products,
  onBackToDashboard,
  isMerchantPreview = false,
  isLoading = false,
}) => {
  const { showToast } = useToast();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Track one shop view per browser session. Mark it only AFTER Firestore confirms the write.
  // Previously the session was marked before the async write, so a denied/failed write was never retried.
  useEffect(() => {
    if (isMerchantPreview || !vendeur.id) return;
    let cancelled = false;
    const sessionKey = `wca_viewed_store_${vendeur.id}`;
    const recordView = async () => {
      try {
        if (sessionStorage.getItem(sessionKey)) return;
        await ApiService.trackView(vendeur.id);
        if (!cancelled) sessionStorage.setItem(sessionKey, String(Date.now()));
      } catch (err) {
        console.error('[PublicStore] La visite n’a pas été enregistrée; une prochaine ouverture pourra réessayer.', err);
      }
    };
    void recordView();
    return () => { cancelled = true; };
  }, [vendeur.id, isMerchantPreview]);

  // Handle hardware / browser back button to close product modal
  useEffect(() => {
    const handlePopState = () => {
      if (selectedProduct) {
        setSelectedProduct(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedProduct]);

  // Determine product limit:
  // - Priority 1: minimal public activation flag 'hasFullCatalog' (no private dates exposed)
  // - Priority 2: merchant preview fallback evaluating full private Vendeur object
  const isFullCatalogAllowed = () => {
    if ('hasFullCatalog' in (vendeur as any) && typeof (vendeur as any).hasFullCatalog === 'boolean') {
      return Boolean((vendeur as any).hasFullCatalog);
    }

    const isVip = (vendeur as any).status === 'VIP' || (vendeur as any).plan === 'VIP';
    if (isVip) {
      const vipEnd = (vendeur as any).vipEndsAt;
      if (!vipEnd) return true;
      return new Date(vipEnd).getTime() > Date.now();
    }

    const plan = (vendeur as any).plan;
    if (plan === 'Gratuit' || (vendeur as any).status === 'Gratuit') {
      return false;
    }

    // Trial start + fixed three-day duration takes precedence over stale stored expiration fields.
    if ((vendeur as any).status === 'Actif' && plan !== 'Gratuit') {
      const created = (vendeur as any).trialStartedAt || (vendeur as any).created_at || (vendeur as any).createdAt;
      if (created) {
        const startMs = new Date(created).getTime();
        return Number.isFinite(startMs) && startMs + 3 * 86400000 > Date.now();
      }
    }

    const trialEnd = (vendeur as any).trialEndsAt || (vendeur as any).date_expiration_essai;
    if (trialEnd) {
      return new Date(trialEnd).getTime() > Date.now();
    }

    return false;
  };

  const hasFullCatalog = isFullCatalogAllowed();

  // Extract non-empty unique categories
  const categories = React.useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return Array.from(set);
  }, [products]);

  // Verified VIP status: strictly checked via single source of truth (rejects expired subscriptions)
  const isVipStore = React.useMemo(() => {
    // Public customer profiles expose only this safe boolean, not private subscription fields.
    if ('isVipActive' in vendeur) return vendeur.isVipActive === true;
    return getVendorEntitlements(vendeur as any).isVipActive;
  }, [vendeur]);

  // Search and category filtering
  const searchedProducts = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      const matchesQuery = !q || 
        p.name.toLowerCase().includes(q) || 
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q));
      const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
      return matchesQuery && matchesCat;
    });
  }, [products, searchQuery, selectedCategory]);

  const displayProducts = hasFullCatalog ? searchedProducts : searchedProducts.slice(0, 4);

  const handleOpenProduct = (product: Product) => {
    setSelectedProduct(product);
    setActiveImageIndex(0);
    window.history.pushState({ modal: 'product_detail', productId: product.id }, '');
    if (!isMerchantPreview && vendeur.id && product.id) {
      const prodSessionKey = `wca_viewed_prod_${vendeur.id}_${product.id}`;
      void (async () => {
        try {
          if (sessionStorage.getItem(prodSessionKey)) return;
          await ApiService.trackProductClick(vendeur.id, product.id);
          sessionStorage.setItem(prodSessionKey, String(Date.now()));
        } catch (err) {
          console.error('[PublicStore] Le clic produit n’a pas été enregistré; une prochaine ouverture pourra réessayer.', err);
        }
      })();
    }
  };

  // Open a product directly when a shared product link includes ?product=<id>.
  useEffect(() => {
    if (typeof window === 'undefined' || selectedProduct || products.length === 0) return;
    const requestedProductId = new URLSearchParams(window.location.search).get('product');
    if (!requestedProductId) return;
    const requestedProduct = products.find((product) => product.id === requestedProductId);
    if (requestedProduct) {
      setSelectedProduct(requestedProduct);
      setActiveImageIndex(0);
    }
  }, [products, selectedProduct]);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedProduct || products.length === 0) return;
    const requestedProductId = new URLSearchParams(window.location.search).get('product');
    if (!requestedProductId) return;
    const requestedProduct = products.find((product) => product.id === requestedProductId);
    if (requestedProduct) { setSelectedProduct(requestedProduct); setActiveImageIndex(0); }
  }, [products, selectedProduct]);

  const handleCloseProductModal = () => {
    setSelectedProduct(null);
    if (window.history.state?.modal === 'product_detail') {
      window.history.back();
    }
  };

  const normalizeInternationalWhatsApp = (raw: string, currency: string = 'MAD'): string => {
    if (!raw) return '';
    let digits = raw.replace(/\D/g, '');
    digits = digits.replace(/^00+/, '');
    // If starts with single 0 (local mobile trunk format e.g. 06... or 07...):
    if (digits.startsWith('0')) {
      const countryPrefix = currency === 'CFA' ? '225' : '212';
      digits = countryPrefix + digits.slice(1);
    }
    return digits.length >= 6 ? digits : '';
  };

  const getSellerContactDigits = () => {
    // COMMERCIAL PRIVACY ENFORCEMENT:
    // Only return commercial contact if merchant explicitly provided and authorized it.
    // 1. If merchant in preview mode within their own dashboard, permit test
    if (isMerchantPreview) {
      const v = vendeur as Vendeur;
      const raw = (v.useLoginNumberAsPublic ? (v.whatsappNumber || v.phone) : v.commercialWhatsApp) || '';
      if (raw) return normalizeInternationalWhatsApp(raw, v.currency);
    }

    // 2. Public store visitor: use sanitized orderWhatsApp
    const pub = vendeur as PublicStoreProfile;
    if (pub.allowCommercialContact && pub.orderWhatsApp) {
      return normalizeInternationalWhatsApp(pub.orderWhatsApp, pub.currency);
    }
    return '';
  };

  const hasPublicContact = Boolean(getSellerContactDigits());

  const handleOrderWhatsApp = (product: Product) => {
    const cleanPhone = getSellerContactDigits();
    if (!cleanPhone) {
      showToast('Le vendeur n’a pas encore renseigné de contact commercial WhatsApp public.', 'info');
      return;
    }

    // Exact format required by system prompt:
    // "Bonjour [Nom Vendeur], je souhaite commander le produit '[Nom Produit]' au prix de [Prix] [Devise]. Est-il disponible ?"
    const priceFormatted = formatCurrency(product.price, vendeur.currency);
    const textMessage = `Bonjour ${vendeur.name}, je suis intéressé(e) par « ${product.name} » au prix de ${priceFormatted}. Pourriez-vous me donner plus d’informations sur sa disponibilité et les modalités de commande ?`;

    const encoded = encodeURIComponent(textMessage);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encoded}`;

    // Track conversion
    if (!isMerchantPreview) {
      void ApiService.trackConversion(vendeur.id, product.id).catch((err) => {
        console.error('[PublicStore] La commande WhatsApp n’a pas été enregistrée dans les statistiques.', err);
      });
    }

    window.open(whatsappUrl, '_blank');
    showToast('Redirection vers WhatsApp...', 'success');
  };

  const handleGeneralContactWhatsApp = () => {
    const cleanPhone = getSellerContactDigits();
    if (!cleanPhone) {
      showToast('Le vendeur n’a pas encore renseigné de contact commercial WhatsApp public.', 'info');
      return;
    }
    const textMessage = `Bonjour ${vendeur.name}, j'ai vu votre catalogue en ligne et j'ai une question sur vos produits.`;
    const encoded = encodeURIComponent(textMessage);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encoded}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div id="public-store" className="min-h-screen bg-slate-50 text-slate-900 pb-28">
      {/* Merchant preview top navigation header */}
      {isMerchantPreview && onBackToDashboard && (
        <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-xs sticky top-0 z-40 border-b border-slate-800">
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 font-bold hover:text-emerald-400 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour à mon espace commerçant</span>
          </button>
          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
            Mode Aperçu Client
          </span>
        </div>
      )}

      {/* Hero Store Header */}
      <header className="bg-white border-b border-slate-200/80 shadow-xs relative">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6">
            <div className="relative">
              <img
                src={vendeur.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80'}
                alt={vendeur.name}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-2 border-slate-100 shadow-md bg-white shrink-0"
              />
              {isVipStore && (
                <div 
                  className="absolute -bottom-1.5 -right-1.5 bg-amber-400 text-slate-950 p-1.5 rounded-full shadow-md"
                  title="Boutique VIP"
                >
                  <Crown className="w-3.5 h-3.5 fill-current" />
                </div>
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  {vendeur.name}
                </h1>
                {isVipStore && (
                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-300 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full shadow-2xs">
                    <Crown className="w-3.5 h-3.5 text-amber-500 fill-current" /> Boutique VIP
                  </span>
                )}
                <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                  <ShoppingBag className="w-3 h-3 text-emerald-600" /> Catalogue en ligne
                </span>
              </div>

              {vendeur.slogan && (
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  {vendeur.slogan}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-slate-500 pt-1">
                {vendeur.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>{vendeur.location}</span>
                  </span>
                )}
                <span className="flex items-center gap-1 text-slate-600 font-medium">
                  <MessageCircle className="w-3.5 h-3.5 text-[#25D366] shrink-0" />
                  <span>Contact direct vendeur</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Search & Category Filter Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-4 shadow-xs space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom de produit, catégorie..."
              className="w-full bg-slate-50 border border-slate-200 focus:border-[#25D366] focus:bg-white focus:ring-2 focus:ring-[#25D366]/20 rounded-xl pl-10 pr-9 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-hidden transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
                title="Effacer la recherche"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Tous ({products.length})
              </button>
              {categories.map((cat) => {
                const count = products.filter((p) => p.category === cat).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-[#25D366] text-slate-950 shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {cat} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section title */}
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <span>{searchQuery ? 'Résultats de recherche' : 'Tous nos articles'}</span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded-full">
              {displayProducts.length}
            </span>
          </h2>
          <span className="text-xs text-slate-400">Prix en {vendeur.currency}</span>
        </div>

        {/* Products Grid */}
        {isLoading && displayProducts.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`skel-prod-${i}`} className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs animate-pulse flex flex-col justify-between">
                <div>
                  <div className="aspect-square w-full bg-slate-200" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-3/4" />
                    <div className="h-3 bg-slate-100 rounded w-full" />
                    <div className="h-4 bg-slate-200 rounded w-1/2 pt-1" />
                  </div>
                </div>
                <div className="p-2.5 pt-0 grid grid-cols-2 gap-1.5">
                  <div className="h-8 bg-slate-100 rounded-xl" />
                  <div className="h-8 bg-emerald-100 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : displayProducts.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs space-y-2">
            <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-700">Aucun produit disponible actuellement</h3>
            <p className="text-xs text-slate-400">Le commerçant met à jour son catalogue.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4">
            {displayProducts.map((product) => {
              const hasDiscount = product.original_price && product.original_price > product.price;
              const discountPercent = hasDiscount 
                ? Math.round(((product.original_price! - product.price) / product.original_price!) * 100) 
                : 0;

              return (
                <div
                  key={product.id}
                  onClick={() => handleOpenProduct(product)}
                  className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs hover:shadow-md hover:border-[#25D366]/40 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    {/* Image */}
                    <div className="aspect-square w-full bg-slate-100 relative overflow-hidden">
                      <img
                        src={product?.images?.[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80'}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />

                      {hasDiscount && (
                        <div className="absolute top-2 left-2 bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-md shadow-xs">
                          -{discountPercent}%
                        </div>
                      )}

                      {(product?.images?.length || 0) > 1 && (
                        <div className="absolute bottom-2 right-2 bg-slate-950/60 backdrop-blur-xs text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md">
                          +{(product?.images?.length || 1)} photos
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="p-3 space-y-1.5 flex-1">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2 leading-tight">
                        {product.name}
                      </h3>

                      {product.description && (
                        <p className="text-[11px] sm:text-xs text-slate-500 line-clamp-2 leading-snug">
                          {product.description}
                        </p>
                      )}

                      <div className="pt-1 flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-sm sm:text-base font-extrabold text-slate-950">
                          {formatCurrency(product.price, vendeur.currency)}
                        </span>
                        {hasDiscount && (
                          <span className="text-xs text-slate-400 line-through">
                            {formatCurrency(product.original_price!, vendeur.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions: product details and seller contact */}
                  <div className="p-2.5 pt-0 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProduct(product);
                      }}
                      className="flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-semibold py-2 px-2 rounded-xl text-[11px] sm:text-xs transition-all cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">Voir détails</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOrderWhatsApp(product);
                      }}
                      disabled={!hasPublicContact}
                      title={hasPublicContact ? 'Contacter le vendeur au sujet de ce produit' : 'Contact commercial non configuré'}
                      className="flex items-center justify-center gap-1 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-bold py-2 px-2 rounded-xl text-[11px] sm:text-xs transition-all shadow-xs cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span className="truncate">{hasPublicContact ? 'Contacter le vendeur' : 'Contact indisponible'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Sticky Bottom Contact Bar */}
      <div 
        id="floating-contact-bar"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-lg"
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-[#25D366]/20 text-[#25D366] flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 fill-current" />
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-slate-900 truncate">{hasPublicContact ? 'Une question ? Un conseil ?' : 'Contact WhatsApp indisponible'}</div>
              <div className="text-[11px] text-slate-500">{hasPublicContact ? 'Échange direct avec le vendeur' : 'Le vendeur doit configurer son contact public'}</div>
            </div>
          </div>

          <button
            onClick={handleGeneralContactWhatsApp}
            disabled={!hasPublicContact}
            aria-label={hasPublicContact ? 'Écrire à la boutique sur WhatsApp' : 'Contact WhatsApp non configuré'}
            className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm shadow-md shrink-0 transition-all cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 fill-current" />
            <span>{hasPublicContact ? 'Poser une question' : 'Contact indisponible'}</span>
          </button>
        </div>
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div 
          id="product-detail-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs"
          onClick={handleCloseProductModal}
        >
          <div 
            className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              {/* Carousel / Image view */}
              <div className="relative aspect-square w-full bg-slate-100 overflow-hidden rounded-t-3xl">
                <img
                  src={selectedProduct?.images?.[activeImageIndex] || selectedProduct?.images?.[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80'}
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                />

                <button
                  type="button"
                  onClick={handleCloseProductModal}
                  className="absolute top-3 right-3 bg-slate-950/60 hover:bg-slate-950 text-white p-2 rounded-full backdrop-blur-xs transition-colors cursor-pointer z-10"
                  title="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Multiple images controls */}
                {(selectedProduct?.images?.length || 0) > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : (selectedProduct?.images?.length || 1) - 1))}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 bg-slate-950/60 hover:bg-slate-950 text-white p-1.5 rounded-full backdrop-blur-xs transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setActiveImageIndex((prev) => (prev < (selectedProduct?.images?.length || 1) - 1 ? prev + 1 : 0))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-slate-950/60 hover:bg-slate-950 text-white p-1.5 rounded-full backdrop-blur-xs transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>

                    {/* Dots */}
                    <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-1.5">
                      {(selectedProduct?.images || []).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveImageIndex(i)}
                          className={`w-2 h-2 rounded-full transition-all ${
                            i === activeImageIndex ? 'bg-white w-5' : 'bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnails if > 1 */}
              {(selectedProduct?.images?.length || 0) > 1 && (
                <div className="flex gap-2 p-3 bg-slate-50 border-b border-slate-100 overflow-x-auto">
                  {(selectedProduct?.images || []).map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImageIndex(i)}
                      className={`w-14 h-14 rounded-xl overflow-hidden border-2 shrink-0 ${
                        i === activeImageIndex ? 'border-[#25D366]' : 'border-transparent opacity-60'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Body */}
              <div className="p-5 sm:p-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
                    {selectedProduct.name}
                  </h2>
                </div>

                {/* Price block */}
                <div className="flex items-baseline gap-2.5 pb-2">
                  <span className="text-2xl font-extrabold text-slate-950">
                    {formatCurrency(selectedProduct.price, vendeur.currency)}
                  </span>
                  {selectedProduct.original_price && selectedProduct.original_price > selectedProduct.price && (
                    <span className="text-sm text-slate-400 line-through">
                      {formatCurrency(selectedProduct.original_price, vendeur.currency)}
                    </span>
                  )}
                  {selectedProduct.category && (
                    <span className="ml-auto text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                      {selectedProduct.category}
                    </span>
                  )}
                </div>

                {/* Description */}
                <div className="pt-2 border-t border-slate-100 text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                  {selectedProduct.description || 'Description non renseignée.'}
                </div>

              </div>
            </div>

            {/* Modal Bottom CTA */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 rounded-b-3xl">
              <button
                id="btn-order-wa-modal"
                onClick={() => handleOrderWhatsApp(selectedProduct)}
                disabled={!hasPublicContact}
                title={hasPublicContact ? 'Demander des informations sur ce produit' : 'Contact commercial non configuré'}
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-98 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-md text-sm transition-all"
              >
                <MessageCircle className="w-5 h-5 fill-current" />
                <span>{hasPublicContact ? 'Demander ce produit' : 'Contact indisponible'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
