import React, { useState } from 'react';
import { ShieldCheck, Users, Copy, Check, ExternalLink, MessageCircle, ChevronDown, ChevronUp, Link as LinkIcon } from 'lucide-react';
import { useToast } from './Toast';

interface DualLinksBannerProps {
  currentRole: 'admin' | 'public' | 'client';
  onNavigateToAdmin?: () => void;
  onNavigateToPublic?: () => void;
}

export const DualLinksBanner: React.FC<DualLinksBannerProps> = ({
  currentRole,
  onNavigateToAdmin,
  onNavigateToPublic,
}) => {
  const { showToast } = useToast();
  const [copiedLink, setCopiedLink] = useState<'admin' | 'public' | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const adminUrl = `${origin}/?role=admin`;
  const publicUrl = `${origin}/?role=public`;

  const handleCopy = (url: string, type: 'admin' | 'public', label: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(type);
    showToast(`${label} copié avec succès !`, 'success');
    setTimeout(() => {
      setCopiedLink(null);
    }, 2500);
  };

  const handleSharePublicWhatsApp = () => {
    const text = encodeURIComponent(
      `👋 Bonjour ! Rejoins notre plateforme e-commerce WhatsApp !\n\n` +
      `Crée ton catalogue en ligne gratuit en 30 secondes (avec IA & commandes WhatsApp directes) :\n` +
      `👉 ${publicUrl}\n\n` +
      `Entre simplement ton numéro WhatsApp et choisis un mot de passe pour commencer !`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    showToast('Lien public envoyé vers WhatsApp !', 'success');
  };

  return (
    <div id="dual-links-banner" className="bg-slate-900 border-b border-slate-800 text-white transition-all text-xs">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-bold text-slate-200 flex items-center gap-1.5">
            <LinkIcon className="w-3.5 h-3.5 text-[#25D366]" />
            <span>Liens Distincts Déploiement :</span>
          </span>
          <span className="hidden sm:inline text-slate-400">
            {currentRole === 'admin' ? (
              <span className="text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                Mode Admin Actif
              </span>
            ) : (
              <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                Mode Public Vendeurs Actif
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="hidden md:inline">{isExpanded ? 'Réduire' : 'Afficher les liens'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-800/80 bg-slate-950/70 px-4 py-3">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 1. LIEN ADMIN PRIVÉ */}
            <div className={`p-3 rounded-2xl border transition-all ${
              currentRole === 'admin'
                ? 'bg-rose-950/30 border-rose-500/40 ring-1 ring-rose-500/20'
                : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 font-bold text-rose-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span>1. Lien Administrateur Privé (Réservé à vous)</span>
                </div>
                {currentRole === 'admin' && (
                  <span className="text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2 py-0.5 rounded-full">
                    Vous êtes ici
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                Accès exclusif : Tableau de bord, contrôle ON/OFF des vendeurs, modification des identifiants et réglage de la durée d’essai.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={adminUrl}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-rose-300 select-all"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(adminUrl, 'admin', 'Lien Administrateur')}
                  className="flex items-center gap-1 bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1.5 rounded-xl shrink-0 cursor-pointer shadow-xs transition-colors"
                >
                  {copiedLink === 'admin' ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink === 'admin' ? 'Copié' : 'Copier'}</span>
                </button>
                {currentRole !== 'admin' && onNavigateToAdmin && (
                  <button
                    type="button"
                    onClick={onNavigateToAdmin}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl shrink-0 cursor-pointer"
                    title="Ouvrir le panneau Admin"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 2. LIEN PUBLIC VENDEURS */}
            <div className={`p-3 rounded-2xl border transition-all ${
              currentRole === 'public'
                ? 'bg-emerald-950/30 border-emerald-500/40 ring-1 ring-emerald-500/20'
                : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 font-bold text-[#25D366]">
                  <Users className="w-4 h-4" />
                  <span>2. Lien Public Vendeurs (À partager à vos amis)</span>
                </div>
                {currentRole === 'public' && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full">
                    Vous êtes ici
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                Lien classique : Inscription / Connexion avec numéro WhatsApp + mot de passe, ID unique et catalogue isolé. Aucun accès admin visible.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={publicUrl}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-emerald-300 select-all"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(publicUrl, 'public', 'Lien Public Vendeurs')}
                  className="flex items-center gap-1 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-3 py-1.5 rounded-xl shrink-0 cursor-pointer shadow-xs transition-colors"
                >
                  {copiedLink === 'public' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink === 'public' ? 'Copié' : 'Copier'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSharePublicWhatsApp}
                  className="flex items-center gap-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 px-2.5 py-1.5 rounded-xl shrink-0 cursor-pointer"
                  title="Partager le lien public sur WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
                {currentRole === 'admin' && onNavigateToPublic && (
                  <button
                    type="button"
                    onClick={onNavigateToPublic}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl shrink-0 cursor-pointer"
                    title="Ouvrir l'espace Public"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
