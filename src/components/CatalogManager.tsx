import React, { useState, useEffect } from 'react';
import { Product, Vendeur } from '../types';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Sparkles, 
  Image as ImageIcon, 
  X, 
  Check, 
  ShoppingBag, 
  ExternalLink,
  ChevronRight,
  Upload,
  Wand2,
  Palette,
  Loader2,
  RefreshCw,
  Sparkle,
  Sliders,
  Share2,
  MessageCircle,
  Copy
} from 'lucide-react';
import { formatCurrency } from '../services/aiGenerator';
import { useToast } from './Toast';
import { uploadImageToStorage, ACCEPTED_IMAGE_TYPES } from '../services/imageUpload';
import { GeminiClient } from '../services/geminiClient';

interface CatalogManagerProps {
  vendeur: Vendeur;
  products: Product[];
  onSaveProduct: (product: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onOpenStore: () => void;
  onOpenUpgradeModal: () => void;
}

const PRESET_SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1608248597359-2e11d0442654?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
];

const PROMO_PROMPT_SUGGESTIONS = [
  'Sac à main cuir de luxe sur fond marbre moderne',
  'Montre haut de gamme avec reflets dorés et fond sombre',
  'Sneakers streetwear tendance sur socle minimaliste',
  'Flacon de parfum élégant entouré d’ingrédients naturels',
  'Caftan traditionnel brodé main avec éclairage doux de studio',
];

export const CatalogManager: React.FC<CatalogManagerProps> = ({
  vendeur,
  products,
  onSaveProduct,
  onDeleteProduct,
  onOpenStore,
  onOpenUpgradeModal: _onOpenUpgradeModal,
}) => {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [originalPrice, setOriginalPrice] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  // AI Description Generator ("Magie IA 🪄")
  const [aiLanguage, setAiLanguage] = useState<'fr' | 'darija'>('fr');
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  // AI Image Enhancer ("Sublimer la photo ✨")
  const [enhancingIndex, setEnhancingIndex] = useState<number | null>(null);

  // AI Promo Banner Generator modal
  const [imageGeneratorOpen, setImageGeneratorOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageAspectRatio, setImageAspectRatio] = useState<'1:1' | '16:9' | '4:3'>('1:1');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Filter and search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories: string[] = ['all', ...Array.from(new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c))))];

  // Hardware / Browser Back button handling for closing modal
  useEffect(() => {
    const handlePopState = () => {
      if (imageGeneratorOpen) {
        setImageGeneratorOpen(false);
        return;
      }
      if (modalOpen) {
        setModalOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [modalOpen, imageGeneratorOpen]);

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setPrice('');
    setOriginalPrice('');
    setDescription('');
    setCategory('');
    setImages([PRESET_SAMPLE_IMAGES[Math.floor(Math.random() * PRESET_SAMPLE_IMAGES.length)]]);
    setModalOpen(true);
    window.history.pushState({ modal: 'product_form' }, '');
  };

  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setPrice(p.price);
    setOriginalPrice(p.original_price || '');
    setDescription(p.description);
    setCategory(p.category || '');
    setImages(p.images || []);
    setModalOpen(true);
    window.history.pushState({ modal: 'product_form', productId: p.id }, '');
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setImageGeneratorOpen(false);
    if (window.history.state?.modal === 'product_form') {
      window.history.back();
    }
  };

  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = 3 - images.length;
    if (remainingSlots <= 0) {
      showToast('Maximum 3 photos autorisées par produit', 'info');
      e.target.value = '';
      return;
    }

    setIsUploadingImages(true);
    try {
      const filesToProcess = Array.from(files).slice(0, remainingSlots);
      const newCompressedImages: string[] = [];

      for (const file of filesToProcess) {
        const uploadedUrl = await uploadImageToStorage(file, 'products', vendeur.id);
        newCompressedImages.push(uploadedUrl);
      }

      setImages((prev) => [...prev, ...newCompressedImages].slice(0, 3));
      showToast(`${newCompressedImages.length} photo(s) téléversée(s) et optimisée(s) sur Cloudinary ! ✨`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors du téléversement de l’image', 'error');
    } finally {
      setIsUploadingImages(false);
      e.target.value = '';
    }
  };

  const handleAddImage = (url: string) => {
    if (!url.trim()) return;
    if (images.length >= 3) {
      showToast('Maximum 3 images par produit', 'info');
      return;
    }
    setImages([...images, url.trim()]);
    setNewImageUrl('');
  };

  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  // 1. "Magie IA 🪄" : AI Product Description Generator
  const handleGenerateAIDescription = async () => {
    if (!name.trim()) {
      showToast('Indiquez d’abord le nom de l’article pour guider l’IA', 'info');
      return;
    }

    setIsGeneratingDescription(true);
    try {
      const aiDesc = await GeminiClient.generateDescription({
        name: name.trim(),
        price: price !== '' ? Number(price) : undefined,
        currency: vendeur.currency,
        category: category.trim(),
        location: vendeur.location,
        language: aiLanguage,
      });

      setDescription(aiDesc);
      showToast(
        aiLanguage === 'darija' 
          ? 'Description en Darija générée avec succès ! 🇲🇦' 
          : 'Description vendeuse générée avec succès ! ✨', 
        'success'
      );
    } catch (err: any) {
      console.error('Error generating description:', err);
      showToast('Erreur lors de la génération de la description', 'error');
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  // 2. "Sublimer la photo ✨" : AI Photo Enhancement
  const handleEnhanceImage = async (index: number) => {
    const targetImage = images[index];
    if (!targetImage) return;

    setEnhancingIndex(index);
    showToast('Sublimation de la photo en cours avec Gemini... ✨', 'info');
    try {
      const enhancedUrl = await GeminiClient.enhanceImage(targetImage, 'enhance');
      setImages((prev) => {
        const next = [...prev];
        next[index] = enhancedUrl;
        return next;
      });
      showToast('Photo sublimée avec succès ! Éclairage et netteté optimisés.', 'success');
    } catch (err: any) {
      console.error('Error enhancing image:', err);
      showToast(err.message || 'Impossible de sublimer cette photo pour le moment', 'error');
    } finally {
      setEnhancingIndex(null);
    }
  };

  // 3. "Générer une bannière promo 🎨" : Text-to-Image Generation
  const handleGeneratePromoImage = async () => {
    if (!imagePrompt.trim()) {
      showToast('Veuillez décrire l’image ou la bannière souhaitée', 'info');
      return;
    }

    setIsGeneratingImage(true);
    showToast('Génération de votre image promotionnelle en cours...', 'info');
    try {
      const generatedUrl = await GeminiClient.generateImage(imagePrompt.trim(), imageAspectRatio);
      
      if (images.length < 3) {
        setImages((prev) => [...prev, generatedUrl]);
      } else {
        // Replace last image if already at 3
        setImages((prev) => [...prev.slice(0, 2), generatedUrl]);
      }

      showToast('Bannière promotionnelle créée et ajoutée aux photos ! 🎉', 'success');
      setImageGeneratorOpen(false);
      setImagePrompt('');
    } catch (err: any) {
      console.error('Error generating image:', err);
      showToast(err.message || 'Erreur lors de la création de l’image', 'error');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || price === '' || Number(price) <= 0) {
      showToast('Veuillez renseigner au moins un titre et un prix valide', 'error');
      return;
    }

    if (images.length === 0) {
      showToast('Ajoutez au moins une photo pour vos clients', 'info');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveProduct({
        id: editingProduct?.id,
        name: name.trim(),
        price: Number(price),
        original_price: originalPrice !== '' ? Number(originalPrice) : undefined,
        description: description.trim(),
        category: category.trim() || 'Général',
        images: images.slice(0, 3),
      });

      showToast(editingProduct ? 'Produit mis à jour avec succès' : 'Nouveau produit ajouté au catalogue !', 'success');
      setModalOpen(false);
    } catch {
      showToast('Erreur lors de l’enregistrement', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, prodName: string) => {
    if (confirm(`Confirmez-vous la suppression de "${prodName}" ?`)) {
      try {
        await onDeleteProduct(id);
        showToast('Produit supprimé', 'success');
      } catch {
        showToast('Erreur lors de la suppression', 'error');
      }
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleShareCatalogWhatsApp = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const catalogUrl = `${origin}/v/${encodeURIComponent(vendeur.id)}`;
    const text = encodeURIComponent(
      `🛍️ *Découvrez le catalogue en ligne de ${vendeur.name}*\n\n` +
      `Bonjour ! Consultez tous nos articles disponibles et passez commande directement sur WhatsApp :\n` +
      `👉 ${catalogUrl}\n\n` +
      `📦 Commande simple, service rapide & livraison garantie !`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    showToast('Lien de partage du catalogue ouvert sur WhatsApp !', 'success');
  };

  const handleShareProductWhatsApp = (prod: Product) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const catalogUrl = `${origin}/v/${encodeURIComponent(vendeur.id)}`;
    const priceFormatted = formatCurrency(prod.price, vendeur.currency);
    const text = encodeURIComponent(
      `✨ *Article : ${prod.name}*\n` +
      `💰 Prix : *${priceFormatted}*\n\n` +
      `${prod.description ? `${prod.description}\n\n` : ''}` +
      `👉 Commander directement sur WhatsApp : ${catalogUrl}\n` +
      `📞 Vendeur : ${vendeur.phone}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    showToast('Fiche article prête à envoyer sur WhatsApp !', 'success');
  };

  return (
    <div id="catalog-manager" className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">Catalogue Produits</h2>
            <span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">
              {products.length} {products.length > 1 ? 'articles' : 'article'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Devise active : <strong className="text-slate-800 font-bold">{vendeur.currency}</strong> • 3 photos par fiche avec retouche & rédaction IA
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {/* Button to share catalog on WhatsApp */}
          <button
            id="btn-share-catalog-whatsapp"
            onClick={handleShareCatalogWhatsApp}
            className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs shadow-md transition-all cursor-pointer"
            title="Partager tout le catalogue sur WhatsApp avec vos clients"
          >
            <MessageCircle className="w-4 h-4 fill-current" />
            <span>Partager catalogue sur WhatsApp</span>
          </button>

          <button
            onClick={onOpenStore}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
            <span>Voir la boutique</span>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </button>

          <button
            id="btn-add-product"
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Nouveau produit</span>
          </button>
        </div>
      </div>

      {/* Filter and search bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Rechercher par nom, description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
          />
        </div>

        {categories.length > 2 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat === 'all' ? 'Toutes les catégories' : cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-xs space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-[#25D366] flex items-center justify-center mx-auto">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Aucun produit dans le catalogue</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Ajoutez vos premiers articles avec leurs photos, prix et descriptions générées par l’IA pour lancer votre boutique en ligne.
          </p>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter mon premier article</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProducts.map((p) => {
            const hasPromo = p.original_price && p.original_price > p.price;
            const discountPercent = hasPromo
              ? Math.round(((p.original_price! - p.price) / p.original_price!) * 100)
              : 0;

            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Image display */}
                  <div className="relative aspect-4/3 bg-slate-100 overflow-hidden group">
                    <img
                      src={p?.images?.[0] || PRESET_SAMPLE_IMAGES[0]}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {hasPromo && (
                      <span className="absolute top-2.5 left-2.5 bg-rose-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-xs">
                        -{discountPercent}%
                      </span>
                    )}
                    <span className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                      {(p?.images?.length || 1)} photo{(p?.images?.length || 1) > 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 line-clamp-1">{p.name}</h4>
                        {p.category && (
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            {p.category}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-extrabold text-[#20ba59]">
                          {formatCurrency(p.price, vendeur.currency)}
                        </div>
                        {hasPromo && (
                          <div className="text-[10px] text-slate-400 line-through">
                            {formatCurrency(p.original_price!, vendeur.currency)}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {p.description || 'Aucune description rédigée.'}
                    </p>
                  </div>
                </div>

                {/* Footer action buttons */}
                <div className="p-4 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    ID : {p.id.slice(0, 8)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleShareProductWhatsApp(p)}
                      className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                      title="Partager cet article sur WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4 fill-current" />
                    </button>
                    <button
                      onClick={() => handleOpenEdit(p)}
                      className="p-1.5 text-slate-600 hover:text-slate-950 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      title="Modifier"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Product Add / Edit Modal */}
      {modalOpen && (
        <div 
          id="product-edit-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
          onClick={handleCloseModal}
        >
          <div 
            className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingProduct ? 'Modifier le produit' : 'Ajouter un nouveau produit'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Product Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nom du produit *
                </label>
                <input
                  type="text"
                  placeholder="Ex : Caftan Royal Brodé Main"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                  required
                />
              </div>

              {/* Price & Promo Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Prix de vente ({vendeur.currency}) *
                  </label>
                  <input
                    type="number"
                    placeholder="Ex : 450"
                    value={price}
                    onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Prix d’origine barré (Optionnel)
                  </label>
                  <input
                    type="number"
                    placeholder="Ex : 600"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catégorie
                </label>
                <input
                  type="text"
                  placeholder="Ex : Vêtements, Cosmétiques, Accessoires..."
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>

              {/* Description & "Magie IA 🪄" Generator */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Description commerciale
                  </label>

                  <div className="flex items-center gap-1.5">
                    {/* Language selector toggle */}
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setAiLanguage('fr')}
                        className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                          aiLanguage === 'fr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Rédiger en Français"
                      >
                        FR 🇫🇷
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiLanguage('darija')}
                        className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                          aiLanguage === 'darija' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Rédiger en Darija marocaine"
                      >
                        Darija 🇲🇦
                      </button>
                    </div>

                    {/* Magie IA 🪄 button */}
                    <button
                      type="button"
                      onClick={handleGenerateAIDescription}
                      disabled={isGeneratingDescription}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-[#25D366] to-[#1ebe5d] hover:brightness-105 active:scale-95 px-3 py-1.5 rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
                      title="Générer automatiquement une description vendeuse basée sur le nom et le prix"
                    >
                      {isGeneratingDescription ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                          <span>Réflexion IA...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                          <span>Magie IA 🪄</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <textarea
                  rows={3}
                  placeholder="Matières, finitions, tailles disponibles, instructions de commande..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>

              {/* Photos & AI Image Studio */}
              <div className="space-y-2 pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Photos du produit (Jusqu'à 3 images)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {images.length}/3 photos
                  </span>
                </div>

                {/* Thumbnails with "Sublimer la photo ✨" Action */}
                <div className="grid grid-cols-3 gap-2.5">
                  {images.map((img, i) => {
                    const isEnhancing = enhancingIndex === i;

                    return (
                      <div key={i} className="flex flex-col gap-1.5 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                        <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 group">
                          <img src={img} alt={`Aperçu ${i}`} className="w-full h-full object-cover" />
                          
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(i)}
                            className="absolute top-1 right-1 bg-rose-600/90 hover:bg-rose-600 text-white rounded-full p-1 shadow-md transition-opacity"
                            title="Retirer"
                          >
                            <X className="w-3 h-3" />
                          </button>

                          {/* Enhancing overlay */}
                          {isEnhancing && (
                            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center text-white">
                              <Loader2 className="w-5 h-5 animate-spin text-[#25D366] mb-1" />
                              <span className="text-[10px] font-bold">Sublimation IA...</span>
                            </div>
                          )}
                        </div>

                        {/* "Sublimer la photo ✨" Button */}
                        <button
                          type="button"
                          onClick={() => handleEnhanceImage(i)}
                          disabled={isEnhancing}
                          className="w-full flex items-center justify-center gap-1 py-1.5 px-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200/80 rounded-lg text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                          title="Nettoie l'arrière-plan ou optimise la luminosité et les détails du produit via Gemini"
                        >
                          <Wand2 className="w-3 h-3 text-purple-600" />
                          <span>Sublimer ✨</span>
                        </button>
                      </div>
                    );
                  })}

                  {/* Empty Slot Placeholder */}
                  {images.length < 3 && (
                    <div className="aspect-square rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 p-3 text-center bg-slate-50/50">
                      <ImageIcon className="w-6 h-6 mb-1 text-slate-300" />
                      <span className="text-[11px] font-medium leading-tight">Emplacement libre</span>
                      <span className="text-[9px] text-slate-400">Photo {images.length + 1}/3</span>
                    </div>
                  )}
                </div>

                {/* Upload & AI Generation Bar */}
                {images.length < 3 && (
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {/* 1. Phone upload */}
                      <label className="cursor-pointer block">
                        <input
                          type="file"
                          accept={ACCEPTED_IMAGE_TYPES.join(',')}
                          multiple
                          onChange={handleFilesUpload}
                          className="hidden"
                          disabled={isUploadingImages}
                        />
                        <div className="flex items-center justify-center gap-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/30 text-emerald-950 font-bold py-2.5 px-3 rounded-xl text-xs transition-colors">
                          <Upload className="w-4 h-4 text-[#25D366]" />
                          <span className="truncate">
                            {isUploadingImages ? 'Import...' : 'Galerie / Appareil photo'}
                          </span>
                        </div>
                      </label>

                      {/* 2. "Générer une bannière promo" with Imagen */}
                      <button
                        type="button"
                        onClick={() => {
                          if (name) {
                            setImagePrompt(`${name} de qualité supérieure sur fond moderne et élégant`);
                          }
                          setImageGeneratorOpen(true);
                        }}
                        className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 border border-purple-200 text-purple-900 font-bold py-2.5 px-3 rounded-xl text-xs transition-all cursor-pointer"
                        title="Créer une image ou bannière publicitaire à partir d'un simple texte"
                      >
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        <span className="truncate">Générer bannière promo 🎨</span>
                      </button>
                    </div>

                    {/* URL Input */}
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="Ou coller une URL d'image (https://...)"
                        value={newImageUrl}
                        onChange={(e) => setNewImageUrl(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddImage(newImageUrl)}
                        className="bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                      >
                        Ajouter
                      </button>
                    </div>

                    {/* Quick presets */}
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                      <span className="text-[10px] text-slate-400 shrink-0">Exemples :</span>
                      {PRESET_SAMPLE_IMAGES.slice(0, 4).map((pImg, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleAddImage(pImg)}
                          className="shrink-0 w-8 h-8 rounded-lg overflow-hidden border border-slate-200 hover:border-[#25D366] cursor-pointer"
                        >
                          <img src={pImg} alt="Preset" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span>Enregistrement...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{editingProduct ? 'Mettre à jour' : 'Ajouter au catalogue'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Promo Banner / Image Generator Drawer Modal */}
      {imageGeneratorOpen && (
        <div 
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setImageGeneratorOpen(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-purple-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Palette className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Générer une bannière promo avec l'IA</h3>
                  <p className="text-[11px] text-slate-500">Créez une photo de produit ou visuel publicitaire à partir d'un texte</p>
                </div>
              </div>
              <button
                onClick={() => setImageGeneratorOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description du visuel souhaité
                </label>
                <textarea
                  rows={3}
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Ex : Sac à main cuir de luxe sur fond marbre moderne avec éclairage doux de studio..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Suggestions chips */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                  Suggestions prêtes à l'emploi :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PROMO_PROMPT_SUGGESTIONS.map((sug, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setImagePrompt(sug)}
                      className="text-[10px] bg-slate-100 hover:bg-purple-50 hover:text-purple-700 text-slate-600 px-2 py-1 rounded-lg border border-slate-200/80 transition-colors text-left"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect ratio */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Format de l'image
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setImageAspectRatio('1:1')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-all ${
                      imageAspectRatio === '1:1'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 font-bold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Carré (1:1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageAspectRatio('16:9')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-all ${
                      imageAspectRatio === '16:9'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 font-bold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Bannière (16:9)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageAspectRatio('4:3')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-all ${
                      imageAspectRatio === '4:3'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 font-bold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Photo (4:3)
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setImageGeneratorOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleGeneratePromoImage}
                disabled={isGeneratingImage || !imagePrompt.trim()}
                className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isGeneratingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Création en cours...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Générer l'image ✨</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
