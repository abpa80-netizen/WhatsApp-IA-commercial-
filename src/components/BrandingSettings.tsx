import React, { useState } from 'react';
import { Vendeur, CurrencyType } from '../types';
import { 
  Building2, 
  MapPin, 
  Check, 
  Upload, 
  Phone, 
  Palette,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Zap,
  KeyRound,
  AlertCircle
} from 'lucide-react';
import { useToast } from './Toast';
import { uploadImageToStorage, ACCEPTED_IMAGE_TYPES } from '../services/imageUpload';
import { ApiService } from '../services/api';

interface BrandingSettingsProps {
  vendeur: Vendeur;
  onUpdateBranding: (data: Partial<Vendeur>) => Promise<void>;
}

const PRESET_LOGOS = [
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=400&q=80'
];

export const BrandingSettings: React.FC<BrandingSettingsProps> = ({
  vendeur,
  onUpdateBranding,
}) => {
  const { showToast } = useToast();
  
  // Profile fields
  const [name, setName] = useState(vendeur.name);
  const [phone, setPhone] = useState(vendeur.phone);
  const [useLoginNumberAsPublic, setUseLoginNumberAsPublic] = useState(Boolean(vendeur.useLoginNumberAsPublic));
  const [commercialWhatsApp, setCommercialWhatsApp] = useState(vendeur.commercialWhatsApp || '');
  const [allowCommercialContact, setAllowCommercialContact] = useState(Boolean(vendeur.allowCommercialContact));
  const [slogan, setSlogan] = useState(vendeur.slogan);
  const [location, setLocation] = useState(vendeur.location);
  const [logo, setLogo] = useState(vendeur.logo);
  const [currency, setCurrency] = useState<CurrencyType>(vendeur.currency);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState(String(vendeur.defaultDeliveryFee ?? 0));

  // Security / Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingLogo(true);
    try {
      const downloadUrl = await uploadImageToStorage(file, 'logos', vendeur.id);
      setLogo(downloadUrl);
      showToast('Photo de profil téléversée et optimisée sur Cloudinary ! ✨', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Impossible de téléverser la photo sélectionnée', 'error');
    } finally {
      setIsUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      showToast('Le nom de la boutique est obligatoire', 'error');
      return;
    }

    const cleanPhoneDigits = phone.replace(/\D/g, '');
    if (cleanPhoneDigits.length < 6) {
      const err = 'Le numéro WhatsApp doit comporter au moins 6 chiffres';
      setErrorMessage(err);
      showToast(err, 'error');
      return;
    }

    // Password validation
    if (newPassword.trim().length > 0) {
      if (!currentPassword) {
        const err = 'Veuillez saisir votre mot de passe actuel pour autoriser le changement';
        setErrorMessage(err);
        showToast(err, 'error');
        return;
      }
      if (newPassword.length < 6) {
        const err = 'Le nouveau mot de passe doit comporter au moins 6 caractères';
        setErrorMessage(err);
        showToast(err, 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        const err = 'Les deux nouveaux mots de passe ne correspondent pas';
        setErrorMessage(err);
        showToast(err, 'error');
        return;
      }
    }

    setIsSaving(true);
    try {
      const updatedVendor = await ApiService.updateProfile(vendeur.id, {
        name: name.trim(),
        phone: phone.trim(),
        useLoginNumberAsPublic: Boolean(useLoginNumberAsPublic),
        commercialWhatsApp: commercialWhatsApp.trim(),
        allowCommercialContact: Boolean(useLoginNumberAsPublic || (allowCommercialContact && commercialWhatsApp.trim())),
        slogan: slogan.trim(),
        location: location.trim(),
        logo: logo.trim(),
        currency,
        defaultDeliveryFee: Number(defaultDeliveryFee || 0),
      });

      await onUpdateBranding(updatedVendor);

      if (newPassword.length > 0) {
        try {
          await ApiService.changePassword(vendeur.id, currentPassword, newPassword);
        } catch (passwordErr: any) {
          throw new Error(`Profil enregistré, mais le mot de passe n’a pas été modifié : ${passwordErr?.message || 'erreur inconnue'}`);
        }
      }
      
      // Reset password inputs
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      showToast('Profil et sécurité mis à jour ! Synchronisation avec l’Admin effectuée.', 'success');
    } catch (err: any) {
      const msg = err?.message || 'Erreur lors de la mise à jour';
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const uniqueStoreUrl = `${origin}/v/${vendeur.id}`;

  return (
    <div id="branding-settings" className="max-w-2xl mx-auto space-y-6 pb-8">
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs">
        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-[#25D366]/10 text-emerald-600 flex items-center justify-center">
            <Palette className="w-5 h-5 text-[#25D366]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Profil Vendeur & Sécurité</h2>
            <p className="text-xs text-slate-500">
              Modifiez votre numéro WhatsApp, votre mot de passe et l’identité visuelle de votre boutique.
            </p>
          </div>
        </div>

        {/* Vendor ID & Public Link Card */}
        <div className="mb-6 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Identifiant Unique Vendeur
            </span>
            <span className="font-mono font-bold bg-slate-900 text-emerald-400 px-2.5 py-0.5 rounded-lg text-xs">
              {vendeur.id}
            </span>
          </div>

          <div>
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
              Lien Catalogue Public Unique
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={uniqueStoreUrl}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-emerald-800 select-all font-semibold"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(uniqueStoreUrl);
                  showToast('Lien boutique copié !', 'success');
                }}
                className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer"
              >
                Copier
              </button>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* SECTION 1: WHATSAPP NUMBER & COMMERCIAL CONTACT SETTINGS */}
          <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/50 border border-emerald-200/80 space-y-4">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-[#25D366]" />
              <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Numéro WhatsApp de connexion (Privé) *
              </label>
              <span className="ml-auto text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-[#25D366]" /> Identifiant Privé
              </span>
            </div>

            <div className="relative">
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="+212 6 00 00 00 00"
                className="w-full bg-white border border-slate-300 rounded-xl pl-3.5 pr-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              🔒 <strong>Confidentialité garantie :</strong> Ce numéro sert à l’authentification de votre compte. Il n’est jamais rendu public sans votre consentement explicite.
            </p>

            {/* EXPLICIT OPTION: Utiliser mon numéro WhatsApp de connexion comme contact commercial public */}
            <div className="pt-2 border-t border-emerald-200/60 space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-xl bg-white border border-emerald-200 cursor-pointer hover:bg-emerald-50/30 transition-colors">
                <input
                  type="checkbox"
                  checked={useLoginNumberAsPublic}
                  onChange={(e) => {
                    setUseLoginNumberAsPublic(e.target.checked);
                    if (e.target.checked) {
                      setAllowCommercialContact(true);
                    }
                  }}
                  className="mt-0.5 w-4 h-4 text-[#25D366] rounded border-slate-300 focus:ring-[#25D366] cursor-pointer"
                />
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-900 block">
                    Utiliser mon numéro WhatsApp de connexion comme contact commercial public
                  </span>
                  <span className="text-[11px] text-slate-500 block leading-relaxed">
                    Désactivé par défaut. Si vous activez cette option, les clients de votre catalogue public pourront vous envoyer leurs commandes directement sur ce numéro WhatsApp ({phone || 'enregistré'}).
                  </span>
                </div>
              </label>

              {/* IF NOT USING LOGIN NUMBER: OPTION TO ENTER A DISTINCT COMMERCIAL NUMBER */}
              {!useLoginNumberAsPublic && (
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                      Numéro commercial distinct (Optionnel)
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Renseignez un numéro WhatsApp commercial séparé si vous ne souhaitez pas utiliser votre numéro personnel de connexion.
                    </p>
                  </div>

                  <input
                    type="tel"
                    value={commercialWhatsApp}
                    onChange={(e) => {
                      setCommercialWhatsApp(e.target.value);
                      if (e.target.value.trim().length > 0) {
                        setAllowCommercialContact(true);
                      }
                    }}
                    placeholder="Ex : +212 6 00 00 00 00 ou +225 07 00 00 00 00"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                  />

                  {commercialWhatsApp.trim().length > 0 && (
                    <label className="flex items-center gap-2 pt-1 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowCommercialContact}
                        onChange={(e) => setAllowCommercialContact(e.target.checked)}
                        className="w-3.5 h-3.5 text-[#25D366] rounded border-slate-300 focus:ring-[#25D366]"
                      />
                      <span>Publier ce numéro commercial pour recevoir les commandes clients</span>
                    </label>
                  )}

                  {!commercialWhatsApp.trim() && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
                      ℹ️ <strong>Remarque :</strong> Aucun contact commercial public n’est configuré. Vos visiteurs pourront voir les produits du catalogue, mais ne pourront pas cliquer sur « Commander sur WhatsApp » tant que vous n’aurez pas activé l’option ci-dessus ou renseigné un numéro.
                    </div>
                  )}
                </div>
              )}

              {useLoginNumberAsPublic && (
                <div className="p-2.5 rounded-lg bg-emerald-100/60 border border-emerald-300 text-[11px] text-emerald-900 font-medium flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Votre numéro de connexion sera utilisé pour recevoir les commandes passées par vos clients.</span>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: PASSWORD CHANGE */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-700" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Modifier mon mot de passe (Optionnel)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPasswords ? 'Masquer' : 'Afficher'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Mot de passe actuel
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Nouveau mot de passe
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  placeholder="Nouveau (min 6 car.)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Confirmer le nouveau
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  placeholder="Répétez"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Laissez ces champs vides si vous ne souhaitez pas modifier votre mot de passe.
            </p>
          </div>

          {/* Logo / Avatar Preview & Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Logo / Photo de profil de la boutique
            </label>
            
            <div className="flex items-center gap-4 mb-3">
              <img
                src={logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80'}
                alt="Logo boutique"
                className="w-20 h-20 rounded-2xl object-cover border-2 border-slate-200 shadow-xs bg-slate-100 shrink-0"
              />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES.join(',')}
                      onChange={handleLogoFileUpload}
                      className="hidden"
                      disabled={isUploadingLogo}
                    />
                    <div className="flex items-center justify-center gap-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/30 text-emerald-950 font-bold px-3.5 py-2 rounded-xl text-xs transition-colors">
                      <Upload className="w-3.5 h-3.5 text-[#25D366]" />
                      <span>{isUploadingLogo ? 'Importation en cours...' : 'Importer depuis la galerie / Téléverser'}</span>
                    </div>
                  </label>
                </div>

                <div className="relative">
                  <input
                    type="url"
                    placeholder="Ou coller une URL d'image (https://...)"
                    value={logo}
                    onChange={(e) => setLogo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                  />
                </div>
                
                <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium">Suggestions :</span>
                  {PRESET_LOGOS.map((preset, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setLogo(preset)}
                      className={`w-7 h-7 rounded-lg overflow-hidden border shrink-0 transition-transform hover:scale-105 cursor-pointer ${
                        logo === preset ? 'ring-2 ring-[#25D366] border-transparent' : 'border-slate-200'
                      }`}
                    >
                      <img src={preset} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Store Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Nom commercial de la boutique *
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Ex : Ma Super Boutique"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                required
              />
            </div>
          </div>

          {/* Slogan */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Slogan ou accroche commerciale
            </label>
            <input
              type="text"
              placeholder="Ex : Vente directe & service rapide sur WhatsApp"
              value={slogan}
              onChange={(e) => setSlogan(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Localisation & Villes desservies
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Ex : Casablanca, Maroc ou Abidjan, Côte d’Ivoire"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
              />
            </div>
          </div>

          {/* Structured order delivery fee */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
            <label htmlFor="default-delivery-fee" className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Frais de livraison par défaut
            </label>
            <p className="text-xs text-slate-600">Ce montant est appliqué côté serveur aux commandes structurées. Le client ne peut pas le modifier depuis le formulaire de commande.</p>
            <div className="flex items-center gap-3">
              <input id="default-delivery-fee" type="number" min="0" max="1000000" step="0.01" value={defaultDeliveryFee} onChange={(e) => setDefaultDeliveryFee(e.target.value)} className="w-full max-w-xs bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]" />
              <span className="text-sm font-bold text-slate-600">{currency}</span>
            </div>
          </div>

          {/* Currency Selector (MAD vs CFA) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Devise de facturation (Catalogue & Messages)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCurrency('MAD')}
                className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  currency === 'MAD'
                    ? 'bg-emerald-50 border-[#25D366] text-slate-950 shadow-xs ring-1 ring-[#25D366]'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-bold text-xs text-emerald-700 shrink-0">
                  DH
                </div>
                <div>
                  <div className="text-xs font-bold">MAD (Dirham Marocain)</div>
                  <div className="text-[11px] text-slate-500">Ex : 450 DH</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCurrency('CFA')}
                className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  currency === 'CFA'
                    ? 'bg-emerald-50 border-[#25D366] text-slate-950 shadow-xs ring-1 ring-[#25D366]'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-bold text-xs text-emerald-700 shrink-0">
                  CFA
                </div>
                <div>
                  <div className="text-xs font-bold">CFA (Franc FCFA)</div>
                  <div className="text-[11px] text-slate-500">Ex : 15 000 FCFA</div>
                </div>
              </button>
            </div>
          </div>

          {/* Submit */}
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              id="btn-save-branding"
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold px-6 py-3 rounded-xl text-xs sm:text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <span>Enregistrement en cours...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Enregistrer les modifications</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
