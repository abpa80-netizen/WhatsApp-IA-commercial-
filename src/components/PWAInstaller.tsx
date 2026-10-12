import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X, Check, Share, PlusSquare } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWASelective(enabled: boolean) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    // 1. Check if running in standalone mode (already installed)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    // 2. Detect iOS & Android
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    // 3. Selective manifest and service worker injection
    const existingManifest = document.getElementById('pwa-manifest-link');

    if (!enabled) {
      // Public customer shop: remove manifest link and unregister SW if needed
      if (existingManifest) {
        existingManifest.remove();
      }
      setDeferredPrompt(null);
      return;
    }

    // Merchant / Admin mode: inject manifest link if not present
    if (!existingManifest) {
      const manifestLink = document.createElement('link');
      manifestLink.id = 'pwa-manifest-link';
      manifestLink.rel = 'manifest';
      manifestLink.href = '/manifest.json';
      document.head.appendChild(manifestLink);
    }

    // Register Service Worker in Merchant / Admin mode
    // Note: Skipped in AI Studio preview / dev mode where /sw.js fails due to proxy redirect, preserved in production on Vercel.
    const isAiStudioPreview =
      import.meta.env.DEV ||
      window.location.hostname.includes('run.app') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if ('serviceWorker' in navigator && !isAiStudioPreview) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[SW Registration error]', err);
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [enabled]);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isAndroid,
    install,
  };
}

interface PWAInstallBannerProps {
  enabled: boolean;
}

export const PWAInstallBanner: React.FC<PWAInstallBannerProps> = ({ enabled }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWASelective(enabled);
  const [dismissed, setDismissed] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);

  // If not enabled (e.g. public customer store), or already installed, or dismissed by user
  if (!enabled || isInstalled || dismissed) {
    return null;
  }

  // Only show if browser supports install prompt OR on mobile (Android or iOS)
  if (!isInstallable && !isIOS && !isAndroid) {
    return null;
  }

  const handleInstallClick = () => {
    if (isInstallable) {
      // Native one-click install available via beforeinstallprompt
      install();
    } else if (isAndroid) {
      // beforeinstallprompt not available on Android: show browser-adapted instructions
      setShowAndroidModal(true);
    } else if (isIOS) {
      // iOS Safari: show Share -> Add to Home Screen instructions
      setShowIOSModal(true);
    }
  };

  const renderButtonContent = () => {
    if (isInstallable) {
      return (
        <>
          <Download className="w-3.5 h-3.5" />
          <span>Installer l'application sur mon téléphone</span>
        </>
      );
    }
    if (isAndroid) {
      return (
        <>
          <Smartphone className="w-3.5 h-3.5" />
          <span>Installer sur Android</span>
        </>
      );
    }
    if (isIOS) {
      return (
        <>
          <Share className="w-3.5 h-3.5" />
          <span>Installer sur iPhone / iPad</span>
        </>
      );
    }
    return (
      <>
        <Download className="w-3.5 h-3.5" />
        <span>Installer l'application</span>
      </>
    );
  };

  return (
    <>
      <div 
        id="pwa-install-banner" 
        className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/80 px-4 py-2.5 text-white shadow-md relative z-30"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-[#25D366] text-slate-950 flex items-center justify-center shrink-0 font-bold shadow-xs">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className="font-extrabold text-white block sm:inline mr-1">
                Accès rapide commerçant :
              </span>
              <span className="text-slate-300">
                Installez l'application sur votre écran d'accueil pour un accès instantané sans ouvrir le navigateur.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-install-pwa"
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-extrabold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-all cursor-pointer whitespace-nowrap"
            >
              {renderButtonContent()}
            </button>

            <button
              onClick={() => setDismissed(true)}
              className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Android Installation Guide Modal (when beforeinstallprompt is not available) */}
      {showAndroidModal && (
        <div 
          id="pwa-android-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setShowAndroidModal(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#25D366] text-slate-950 flex items-center justify-center font-bold">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold">Installer sur Android</h3>
              </div>
              <button 
                id="btn-close-android-modal-x"
                onClick={() => setShowAndroidModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs text-slate-600">
              <p className="font-medium text-slate-800">
                Pour ajouter <strong>WhatsApp Commercial AI</strong> à l'écran d'accueil de votre téléphone Android :
              </p>
              
              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <div>
                  Ouvrez le menu de votre navigateur (les <strong>trois points verticaux ⋮</strong> en haut à droite sur Chrome, ou le menu <strong>☰</strong> sur Samsung Internet).
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <div>
                  Appuyez sur <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                <div>
                  Confirmez en appuyant sur <strong>Installer</strong> ou <strong>Ajouter</strong>. L'icône apparaîtra sur votre écran d'accueil avec un accès direct et rapide.
                </div>
              </div>
            </div>

            <button
              id="btn-close-android-modal"
              onClick={() => setShowAndroidModal(false)}
              className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Compris
            </button>
          </div>
        </div>
      )}

      {/* iOS Installation Guide Modal */}
      {showIOSModal && (
        <div 
          id="pwa-ios-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setShowIOSModal(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#25D366] text-slate-950 flex items-center justify-center font-bold">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold">Installer sur iPhone / iPad</h3>
              </div>
              <button 
                id="btn-close-ios-modal-x"
                onClick={() => setShowIOSModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs text-slate-600">
              <p className="font-medium text-slate-800">
                Pour ajouter <strong>WhatsApp Commercial AI</strong> à votre écran d'accueil :
              </p>
              
              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <div>
                  Appuyez sur le bouton <strong>Partager</strong> <Share className="w-3.5 h-3.5 inline mx-1 text-sky-600" /> dans la barre inférieure de Safari.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <div>
                  Faites défiler vers le bas et appuyez sur <strong>« Sur l'écran d'accueil »</strong> <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-slate-800" />.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                <div>
                  Confirmez en appuyant sur <strong>Ajouter</strong> en haut à droite.
                </div>
              </div>
            </div>

            <button
              id="btn-close-ios-modal"
              onClick={() => setShowIOSModal(false)}
              className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
};
