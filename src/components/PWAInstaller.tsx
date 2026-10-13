import React, { useEffect, useState, useCallback } from 'react';
import { Download, Smartphone, X, Check, Share, PlusSquare, Activity, AlertTriangle, Info, RefreshCw } from 'lucide-react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __PWA_PROMPT__?: BeforeInstallPromptEvent | null;
    __PWA_PROMPT_TIMESTAMP__?: number | null;
    __PWA_PROMPT_LISTENERS__?: Array<(e: BeforeInstallPromptEvent) => void>;
  }
}

// Global capture to ensure beforeinstallprompt is NEVER missed, even before React mounts or auth finishes
let capturedInstallPrompt: BeforeInstallPromptEvent | null =
  typeof window !== 'undefined' && window.__PWA_PROMPT__ ? window.__PWA_PROMPT__ : null;
const promptListeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

const isAiStudioPreview =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && (
    window.location.hostname.includes('run.app') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ));

if (typeof window !== 'undefined') {
  // Listen directly on window as well
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    capturedInstallPrompt = e as BeforeInstallPromptEvent;
    window.__PWA_PROMPT__ = capturedInstallPrompt;
    window.__PWA_PROMPT_TIMESTAMP__ = Date.now();
    promptListeners.forEach((listener) => listener(capturedInstallPrompt));
  });

  window.addEventListener('appinstalled', () => {
    capturedInstallPrompt = null;
    window.__PWA_PROMPT__ = null;
    promptListeners.forEach((listener) => listener(null));
  });

  // Listen to early inline script custom event if dispatched
  window.addEventListener('pwa:prompt-ready', (e: Event) => {
    const customEvt = e as CustomEvent<BeforeInstallPromptEvent>;
    if (customEvt.detail) {
      capturedInstallPrompt = customEvt.detail;
      window.__PWA_PROMPT__ = capturedInstallPrompt;
      promptListeners.forEach((listener) => listener(capturedInstallPrompt));
    }
  });

  // Register in early inline listeners queue if available
  if (Array.isArray(window.__PWA_PROMPT_LISTENERS__)) {
    window.__PWA_PROMPT_LISTENERS__.push((e) => {
      capturedInstallPrompt = e;
      window.__PWA_PROMPT__ = e;
      promptListeners.forEach((listener) => listener(e));
    });
  }

  // Early Service Worker registration in production on Vercel
  if ('serviceWorker' in navigator && !isAiStudioPreview) {
    const registerSW = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[SW Registration error]', err);
      });
    };
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
}

export interface PWADiagnostics {
  promptReceived: boolean;
  promptTimestamp: number | null;
  swStatus: 'active' | 'installing' | 'waiting' | 'unregistered' | 'unsupported' | 'preview-mode';
  swScope: string | null;
  manifestStatus: 'valid' | 'invalid' | 'checking' | 'error';
  manifestName: string | null;
  manifestShortName: string | null;
  manifestDisplay: string | null;
  iconsStatus: 'valid' | 'invalid' | 'checking' | 'error';
  iconsCount: number;
  isStandalone: boolean;
  isSecureContext: boolean;
  isWebView: boolean;
  browserName: string;
  unavailableReason: string;
}

export function usePWASelective(enabled: boolean) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => (enabled ? (typeof window !== 'undefined' ? window.__PWA_PROMPT__ || capturedInstallPrompt : null) : null)
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PWADiagnostics>({
    promptReceived: false,
    promptTimestamp: null,
    swStatus: isAiStudioPreview ? 'preview-mode' : 'unregistered',
    swScope: null,
    manifestStatus: 'checking',
    manifestName: null,
    manifestShortName: null,
    manifestDisplay: null,
    iconsStatus: 'checking',
    iconsCount: 0,
    isStandalone: false,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
    isWebView: false,
    browserName: 'Inconnu',
    unavailableReason: '',
  });

  const runDiagnostics = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isAndroidDevice = /android/.test(userAgent);
    const isWebViewDevice = /wv|whatsapp|fb_iab|instagram/i.test(userAgent);

    let detectedBrowser = 'Navigateur standard';
    if (isWebViewDevice) detectedBrowser = 'WebView intégrée (ex. WhatsApp)';
    else if (/chrome|crios/i.test(userAgent)) detectedBrowser = 'Google Chrome';
    else if (/samsungbrowser/i.test(userAgent)) detectedBrowser = 'Samsung Internet';
    else if (/firefox|fxios/i.test(userAgent)) detectedBrowser = 'Mozilla Firefox';
    else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) detectedBrowser = 'Apple Safari';

    // Standalone detection
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith('android-app://') ||
      window.location.search.includes('source=pwa');

    let installedStatus = standaloneMode;
    if (!installedStatus && 'getInstalledRelatedApps' in navigator) {
      try {
        const apps = await (navigator as unknown as { getInstalledRelatedApps: () => Promise<unknown[]> }).getInstalledRelatedApps();
        if (apps && apps.length > 0) {
          installedStatus = true;
        }
      } catch {
        // Ignorer si non supporté
      }
    }
    setIsInstalled(installedStatus);

    // Prompt capture state
    const currentPrompt = deferredPrompt || window.__PWA_PROMPT__ || capturedInstallPrompt;
    const hasPrompt = Boolean(currentPrompt);
    const promptTime = window.__PWA_PROMPT_TIMESTAMP__ || null;

    // Service Worker state
    let swState: PWADiagnostics['swStatus'] = isAiStudioPreview ? 'preview-mode' : 'unregistered';
    let swScopeUrl: string | null = null;

    if (!isAiStudioPreview && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          swScopeUrl = reg.scope;
          if (reg.active) swState = 'active';
          else if (reg.installing) swState = 'installing';
          else if (reg.waiting) swState = 'waiting';
        }
      } catch {
        swState = 'unregistered';
      }
    } else if (!('serviceWorker' in navigator)) {
      swState = 'unsupported';
    }

    // Manifest & Icons validation
    let mStatus: PWADiagnostics['manifestStatus'] = 'checking';
    let mName: string | null = null;
    let mShortName: string | null = null;
    let mDisplay: string | null = null;
    let iStatus: PWADiagnostics['iconsStatus'] = 'checking';
    let iCount = 0;

    try {
      const res = await fetch('/manifest.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        mStatus = 'valid';
        mName = data.name || null;
        mShortName = data.short_name || null;
        mDisplay = data.display || null;

        if (Array.isArray(data.icons) && data.icons.length > 0) {
          iCount = data.icons.length;
          const checks = await Promise.allSettled(
            data.icons.map(async (icon: { src: string }) => {
              const iconRes = await fetch(icon.src, { method: 'HEAD', cache: 'no-cache' });
              return iconRes.ok;
            })
          );
          const allOk = checks.every((c) => c.status === 'fulfilled' && c.value === true);
          iStatus = allOk ? 'valid' : 'error';
        } else {
          iStatus = 'error';
        }
      } else {
        mStatus = 'error';
        iStatus = 'error';
      }
    } catch {
      mStatus = 'error';
      iStatus = 'error';
    }

    // Determine reason if beforeinstallprompt is not available on Android
    let reason = '';
    if (installedStatus) {
      reason = 'L’application est déjà installée sur votre appareil en mode autonome.';
    } else if (isWebViewDevice) {
      reason = 'Vous êtes dans le navigateur intégré de WhatsApp. Les WebViews Android ne permettent pas l’installation PWA native : appuyez sur ⋮ puis « Ouvrir dans Chrome ».';
    } else if (!window.isSecureContext) {
      reason = 'L’application n’est pas servie sous un contexte sécurisé HTTPS valide.';
    } else if (mStatus !== 'valid') {
      reason = 'Le fichier manifest.json n’a pas pu être chargé ou est invalide.';
    } else if (iStatus !== 'valid') {
      reason = 'Une ou plusieurs icônes PWA déclarées dans le manifest ne sont pas accessibles.';
    } else if (!isAiStudioPreview && swState !== 'active') {
      reason = 'Le Service Worker n’est pas encore actif ou en cours d’activation.';
    } else if (!hasPrompt && isAndroidDevice) {
      reason = 'L’événement beforeinstallprompt n’a pas encore été déclenché par Chrome. Causes fréquentes : l’invitation a déjà été fermée récemment (délai de temporisation automatique Chrome), ou l’application est déjà enregistrée dans le système Android.';
    }

    setDiagnostics({
      promptReceived: hasPrompt,
      promptTimestamp: promptTime,
      swStatus: swState,
      swScope: swScopeUrl,
      manifestStatus: mStatus,
      manifestName: mName,
      manifestShortName: mShortName,
      manifestDisplay: mDisplay,
      iconsStatus: iStatus,
      iconsCount: iCount,
      isStandalone: installedStatus,
      isSecureContext: window.isSecureContext,
      isWebView: isWebViewDevice,
      browserName: detectedBrowser,
      unavailableReason: reason,
    });
  }, [deferredPrompt]);

  useEffect(() => {
    // 1. Standalone check
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.location.search.includes('source=pwa');
    setIsInstalled(isStandalone);

    // 2. Detect iOS & Android
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    // 3. Selective manifest injection
    const existingManifest = document.getElementById('pwa-manifest-link');

    if (!enabled) {
      if (existingManifest) {
        existingManifest.remove();
      }
      setDeferredPrompt(null);
      return;
    }

    if (!existingManifest) {
      const manifestLink = document.createElement('link');
      manifestLink.id = 'pwa-manifest-link';
      manifestLink.rel = 'manifest';
      manifestLink.href = '/manifest.json';
      document.head.appendChild(manifestLink);
    }

    // Check captured prompt from window or memory
    const existingPrompt = window.__PWA_PROMPT__ || capturedInstallPrompt;
    if (existingPrompt) {
      setDeferredPrompt(existingPrompt);
    }

    const handlePromptChange = (prompt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(prompt);
    };
    promptListeners.add(handlePromptChange);

    // Register Service Worker in Merchant / Admin mode if not already registered
    if ('serviceWorker' in navigator && !isAiStudioPreview) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('[SW Registration error]', err);
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      capturedInstallPrompt = promptEvent;
      window.__PWA_PROMPT__ = promptEvent;
      window.__PWA_PROMPT_TIMESTAMP__ = Date.now();
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      capturedInstallPrompt = null;
      window.__PWA_PROMPT__ = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    runDiagnostics();

    return () => {
      promptListeners.delete(handlePromptChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [enabled, runDiagnostics]);

  const install = async (): Promise<boolean> => {
    const promptToUse = deferredPrompt || (typeof window !== 'undefined' ? window.__PWA_PROMPT__ : null) || capturedInstallPrompt;
    if (!promptToUse) {
      runDiagnostics();
      return false;
    }
    try {
      await promptToUse.prompt();
      const choiceResult = await promptToUse.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        capturedInstallPrompt = null;
        if (typeof window !== 'undefined') {
          window.__PWA_PROMPT__ = null;
        }
        promptListeners.forEach((l) => l(null));
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[PWA] Error triggering install prompt:', err);
      return false;
    }
  };

  const isInstallable = !!(deferredPrompt || (typeof window !== 'undefined' && window.__PWA_PROMPT__) || capturedInstallPrompt);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    diagnostics,
    runDiagnostics,
    install,
  };
}

interface PWAInstallBannerProps {
  enabled: boolean;
}

export const PWAInstallBanner: React.FC<PWAInstallBannerProps> = ({ enabled }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, diagnostics, runDiagnostics, install } = usePWASelective(enabled);
  const [dismissed, setDismissed] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  // If not enabled (e.g. public customer store), or already installed, or dismissed by user
  if (!enabled || isInstalled || dismissed) {
    return null;
  }

  // Only show if browser supports install prompt OR on mobile (Android or iOS)
  if (!isInstallable && !isIOS && !isAndroid) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      // Native direct install dialog via beforeinstallprompt
      await install();
    } else if (isAndroid) {
      // When beforeinstallprompt is not yet available: show Android instructions modal
      setShowAndroidModal(true);
    } else if (isIOS) {
      // iOS Safari: show Share -> Add to Home Screen instructions
      setShowIOSModal(true);
    } else {
      setShowAndroidModal(true);
    }
  };

  const renderButtonContent = () => {
    if (isAndroid) {
      return (
        <>
          <Download className="w-3.5 h-3.5" />
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

            {/* Diagnostics Button */}
            <button
              id="btn-pwa-diagnostics"
              onClick={() => {
                runDiagnostics();
                setShowDiagnosticsModal(true);
              }}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1.5 rounded-lg text-[11px] border border-slate-700 transition-colors cursor-pointer"
              title="Vérifier l'état de l'installation et du Service Worker"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Diagnostic</span>
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

      {/* Diagnostics Modal */}
      {showDiagnosticsModal && (
        <div 
          id="pwa-diagnostics-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setShowDiagnosticsModal(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-slate-900 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Diagnostic Installation Android PWA</h3>
                  <p className="text-[11px] text-slate-500">Statut technique de l'événement et du système</p>
                </div>
              </div>
              <button 
                onClick={() => setShowDiagnosticsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Status Checklist */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Événement beforeinstallprompt :</span>
                {diagnostics.promptReceived ? (
                  <span className="flex items-center gap-1 font-bold text-emerald-600">
                    <Check className="w-3.5 h-3.5" /> Reçu (Prêt)
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-bold text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> Non reçu
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Service Worker :</span>
                <span className={`font-bold ${diagnostics.swStatus === 'active' ? 'text-emerald-600' : 'text-slate-700'}`}>
                  {diagnostics.swStatus === 'active' && '✅ Actif (/sw.js)'}
                  {diagnostics.swStatus === 'installing' && '⏳ En cours d’installation'}
                  {diagnostics.swStatus === 'waiting' && '⏳ En attente'}
                  {diagnostics.swStatus === 'unregistered' && '⚠️ Non enregistré'}
                  {diagnostics.swStatus === 'preview-mode' && '🛡️ Aperçu AI Studio (contourné)'}
                  {diagnostics.swStatus === 'unsupported' && '❌ Non supporté'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Fichier manifest.json :</span>
                <span className={`font-bold ${diagnostics.manifestStatus === 'valid' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {diagnostics.manifestStatus === 'valid' && '✅ Accessible (200 OK)'}
                  {diagnostics.manifestStatus === 'checking' && '⏳ Vérification...'}
                  {diagnostics.manifestStatus === 'error' && '❌ Erreur de chargement'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Icônes PWA (192 & 512) :</span>
                <span className={`font-bold ${diagnostics.iconsStatus === 'valid' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {diagnostics.iconsStatus === 'valid' && `✅ ${diagnostics.iconsCount} icônes valides (200 OK)`}
                  {diagnostics.iconsStatus === 'checking' && '⏳ Vérification...'}
                  {diagnostics.iconsStatus === 'error' && '❌ Erreur sur une icône'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Navigateur détecté :</span>
                <span className="font-semibold text-slate-800">{diagnostics.browserName}</span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">Contexte sécurisé (HTTPS) :</span>
                <span className="font-bold text-emerald-600">
                  {diagnostics.isSecureContext ? '✅ Oui' : '❌ Non (HTTP)'}
                </span>
              </div>
            </div>

            {/* Explanation / Identified Cause */}
            {diagnostics.unavailableReason && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-900">
                <div className="font-bold flex items-center gap-1 text-amber-800">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>Cause identifiée :</span>
                </div>
                <p className="leading-relaxed text-[11px] text-amber-800">
                  {diagnostics.unavailableReason}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2 pt-1">
              {diagnostics.promptReceived ? (
                <button
                  onClick={() => {
                    setShowDiagnosticsModal(false);
                    install();
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Lancer l'installation native maintenant</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowDiagnosticsModal(false);
                    setShowAndroidModal(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Consulter le guide manuel alternatif (menu ⋮)</span>
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => runDiagnostics()}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualiser</span>
                </button>
                <button
                  onClick={() => setShowDiagnosticsModal(false)}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium py-2 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Android Manual Guide Modal (Accessible when prompt is not yet ready or via diagnostic) */}
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

            <div className="space-y-2">
              <button
                id="btn-close-android-modal"
                onClick={() => setShowAndroidModal(false)}
                className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Compris
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAndroidModal(false);
                  runDiagnostics();
                  setShowDiagnosticsModal(true);
                }}
                className="w-full text-slate-500 hover:text-slate-800 text-[11px] font-medium py-1.5 transition-colors cursor-pointer text-center"
              >
                Voir le diagnostic technique détaillé
              </button>
            </div>
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
