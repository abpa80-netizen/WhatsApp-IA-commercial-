import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Vendeur, SystemConfig } from '../types';
import { X, Crown, Check, MessageCircle, Sparkles, Zap, ShieldCheck } from 'lucide-react';
import { formatCurrency } from '../services/aiGenerator';

interface VipUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendeur: Vendeur;
  config: SystemConfig;
  onActivateVIPInstant?: () => void;
}

export const VipUpgradeModal: React.FC<VipUpgradeModalProps> = ({
  isOpen,
  onClose,
  vendeur,
  config,
  onActivateVIPInstant,
}) => {
  if (!isOpen) return null;

  const cleanSupportNumber = (config.whatsapp_support || '+212600000000').replace(/\D/g, '');
  const upgradeMessage = encodeURIComponent(
    `Bonjour, je souhaite activer le Pack VIP pour ma boutique ${vendeur.name || vendeur.id} (${vendeur.phone}). Merci de me donner les instructions de paiement.`
  );
  const whatsappUrl = `https://wa.me/${cleanSupportNumber}?text=${upgradeMessage}`;

  const currentPrice = vendeur.currency === 'MAD' 
    ? (config.price_vip ?? 199)
    : (config.price_vip_cfa ?? 12000);

  const priceFormatted = vendeur.currency === 'MAD'
    ? `${currentPrice} DH — Accès VIP À Vie (Paiement unique)`
    : `${Number(currentPrice).toLocaleString('fr-FR')} FCFA — Accès VIP À Vie (Paiement unique)`;

  const benefits = [
    {
      title: 'Catalogue Produits Illimité',
      desc: 'Ajoutez autant d’articles que vous souhaitez sans la bride des 4 produits.',
      icon: Sparkles,
    },
    {
      title: 'Générateur Commercial IA Illimité',
      desc: 'Rédigez des messages de vente percutants (prospection, relance, promos) en 3 secondes.',
      icon: Zap,
    },
    {
      title: 'Mini-CRM Prospects & Suivi Clients',
      desc: 'Gérez vos contacts chauds et relancez-les en un clic sur WhatsApp.',
      icon: MessageCircle,
    },
    {
      title: 'Analytiques Détaillées en Temps Réel',
      desc: 'Visualisez les vues de votre boutique, clics produits et taux de conversion.',
      icon: ShieldCheck,
    },
    {
      title: 'Badge Vérifié & Support Prioritaire 7j/7',
      desc: 'Inspirez une confiance maximale à vos acheteurs dès le premier regard.',
      icon: Crown,
    },
  ];

  return (
    <AnimatePresence>
      <div 
        id="vip-modal-backdrop"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          id="vip-modal-content"
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white p-6 relative">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Fermer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="inline-flex items-center gap-1.5 bg-amber-400/20 text-amber-300 border border-amber-400/30 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3">
              <Crown className="w-3.5 h-3.5" /> Pack Vendeur VIP
            </div>

            <h2 className="text-2xl font-bold font-heading">
              Boostez vos Ventes WhatsApp
            </h2>
            <p className="text-slate-300 text-sm mt-1">
              Passez à la vitesse supérieure sans aucune restriction technique.
            </p>

            <div className="mt-4 bg-slate-950/60 rounded-2xl p-3 border border-emerald-500/30">
              <div className="text-xl sm:text-2xl font-extrabold text-[#25D366]">
                {priceFormatted}
              </div>
              <div className="text-slate-300 text-xs mt-0.5 flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]"></span>
                <span>Paiement unique • Aucun abonnement mensuel • Sans engagement</span>
              </div>
            </div>
          </div>

          {/* Benefits list */}
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-3">
              {benefits.map((b, i) => {
                const Icon = b.icon;
                return (
                  <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{b.title}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{b.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="pt-3 space-y-2.5">
              <a
                id="btn-whatsapp-upgrade"
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-md transition-all active:scale-98 text-sm"
              >
                <MessageCircle className="w-5 h-5 fill-current" />
                <span>Activer le Pack VIP sur WhatsApp</span>
              </a>

              <p className="text-[11px] text-center text-slate-500">
                Contact WhatsApp Support direct : <strong className="text-slate-800 font-bold">{config.whatsapp_support || '+212600000000'}</strong>
              </p>

              {onActivateVIPInstant && (
                <button
                  type="button"
                  onClick={() => {
                    onActivateVIPInstant();
                    onClose();
                  }}
                  className="w-full text-xs text-slate-500 hover:text-slate-800 py-1.5 transition-colors underline font-medium"
                >
                  ⚡ Activer instantanément pour le test (Démo)
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
