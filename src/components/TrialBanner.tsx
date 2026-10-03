import React, { useState, useEffect } from 'react';
import { Vendeur, SystemConfig } from '../types';
import { Crown, Clock, AlertTriangle, Sparkles, ChevronRight, Hourglass } from 'lucide-react';

interface TrialBannerProps {
  vendeur: Vendeur;
  config: SystemConfig;
  onOpenUpgradeModal: () => void;
}

export const TrialBanner: React.FC<TrialBannerProps> = ({
  vendeur,
  config,
  onOpenUpgradeModal,
}) => {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isExpired: boolean;
  }>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isExpired: false,
  });

  useEffect(() => {
    const calculateTime = () => {
      // Dynamic trial calculation based on registration date and current config.trial_days
      const createdTime = vendeur?.created_at ? new Date(vendeur.created_at).getTime() : Date.now();
      const trialDays = Number(config?.trial_days) || 7;
      const dynamicExpiration = createdTime + trialDays * 86400000;
      const serverExpiration = vendeur?.date_expiration_essai ? new Date(vendeur.date_expiration_essai).getTime() : 0;
      
      // Use dynamicExpiration so changes made by admin in trial_days react instantly for all trial vendors!
      const targetExpiration = dynamicExpiration || serverExpiration;
      const now = Date.now();
      const diff = targetExpiration - now;

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true });
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft({ days, hours, minutes, seconds, isExpired: false });
      }
    };

    calculateTime();
    // High-precision live countdown updated every second
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [vendeur?.created_at, vendeur?.date_expiration_essai, config?.trial_days]);

  if (!vendeur) return null;

  if (vendeur.status === 'VIP') {
    return (
      <div 
        id="vip-active-banner"
        className="bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs sm:text-sm text-slate-800"
      >
        <div className="flex items-center gap-2 font-medium">
          <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 flex items-center justify-center">
            <Crown className="w-3.5 h-3.5" />
          </div>
          <span>
            Compte <strong className="text-amber-700 font-bold">Pack VIP Actif</strong> — Catalogue illimité & Accès IA complet
          </span>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-100 px-2.5 py-0.5 rounded-full text-xs">
          <Sparkles className="w-3 h-3" /> Illimité
        </span>
      </div>
    );
  }

  const isExpired = timeLeft.isExpired || vendeur.status === 'Inactif';

  return (
    <div 
      id="trial-banner"
      className={`border-b px-4 py-2.5 transition-colors ${
        isExpired 
          ? 'bg-rose-50 border-rose-200 text-rose-900' 
          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5">
          {isExpired ? (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <Hourglass className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
          )}
          
          <div className="flex items-center gap-2 flex-wrap">
            {isExpired ? (
              <span>
                <strong>Période d’essai de {config.trial_days || 7} jours terminée :</strong> Passez en VIP pour réactiver votre catalogue illimité et l’IA.
              </span>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span>
                  <strong>Compte à rebours Essai Gratuit ({config.trial_days}j) :</strong>
                </span>
                <span className="font-mono font-bold bg-white text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-md shadow-2xs tracking-wider">
                  {timeLeft.days}j {String(timeLeft.hours).padStart(2, '0')}h {String(timeLeft.minutes).padStart(2, '0')}m {String(timeLeft.seconds).padStart(2, '0')}s
                </span>
                <span className="hidden md:inline text-xs text-emerald-700">
                  restantes pour tester toutes les fonctionnalités VIP.
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          id="btn-upgrade-banner"
          onClick={onOpenUpgradeModal}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold shadow-xs transition-transform active:scale-95 text-xs cursor-pointer ${
            isExpired
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-[#25D366] hover:bg-[#20ba59] text-slate-950'
          }`}
        >
          <Crown className="w-3.5 h-3.5" />
          <span>Passer au Pack VIP</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
