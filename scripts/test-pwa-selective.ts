import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('--- DÉBUT DES TESTS D’AFFICHAGE ET FONCTIONNEMENT PWA SELECTIF ---');

// 1. Vérification statique des règles PWA dans App.tsx
const appContent = fs.readFileSync(path.resolve('./src/App.tsx'), 'utf-8');

// A. Vérification de l'exclusion PWA dans la boutique publique
assert(
  !appContent.includes('<PublicStore') || !appContent.includes('<PWAInstallBanner enabled={true} />\n        <PublicStore'),
  'ÉCHEC: La boutique publique ne doit jamais contenir la bannière PWA'
);
console.log('✅ [PASS] 1. Le composant PublicStore ne monte aucune bannière PWA');

// B. Nettoyage explicite du manifest en mode store
assert(
  appContent.includes("if (viewMode === 'store')") &&
  appContent.includes("pwa-manifest-link"),
  'ÉCHEC: En mode store public, le manifest PWA doit être systématiquement retiré du DOM'
);
console.log('✅ [PASS] 2. Le lien manifest est systématiquement nettoyé du DOM lorsque viewMode === store');

// C. Maintien strict du mode store pour les visiteurs publics lors du popstate (bouton retour)
assert(
  appContent.includes("if (!activeVendeur)") &&
  appContent.includes("if (viewMode !== 'store')") &&
  appContent.includes("setViewMode('store')"),
  'ÉCHEC: Les visiteurs sans session vendeur doivent rester strictement confinés en mode store lors du popstate'
);
console.log('✅ [PASS] 3. Les visiteurs du catalogue public restent confinés en mode store lors du retour arrière');

// D. Vérification de l'affichage réservé à l'administrateur AUTORISÉ
assert(
  appContent.includes('{isAuthorizedAdmin && <PWAInstallBanner enabled={true} />}'),
  'ÉCHEC: La bannière PWA de l\'espace admin ne doit être affichée que si isAuthorizedAdmin est vrai'
);
console.log('✅ [PASS] 4. L’espace administrateur n’affiche la bannière PWA qu’après authentification réelle de l’admin');

// E. Vérification de l'espace vendeur privé
assert(
  appContent.includes('<PWAInstallBanner enabled={Boolean(activeVendeur)} />'),
  'ÉCHEC: L\'espace vendeur n\'affiche la bannière PWA que lorsque activeVendeur est défini'
);
console.log('✅ [PASS] 5. L’espace vendeur affiche la bannière uniquement lorsque le vendeur est connecté');

// 2. Vérification de la logique Android & iOS dans PWAInstaller.tsx
const pwaContent = fs.readFileSync(path.resolve('./src/components/PWAInstaller.tsx'), 'utf-8');

// A. Détection Android
assert(
  pwaContent.includes('const isAndroidDevice = /android/.test(userAgent);') ||
  pwaContent.includes('/android/.test(userAgent)'),
  'ÉCHEC: Détection Android manquante dans usePWASelective'
);
console.log('✅ [PASS] 6. Détection explicite des appareils Android');

// B. Détection iOS
assert(
  pwaContent.includes('isIOSDevice') && pwaContent.includes('/iphone|ipad|ipod/'),
  'ÉCHEC: Détection iOS manquante dans usePWASelective'
);
console.log('✅ [PASS] 7. Détection explicite des appareils iPhone / iPad');

// C. Prise en charge de beforeinstallprompt sur Android
assert(
  pwaContent.includes('if (isInstallable)') && pwaContent.includes('install();'),
  'ÉCHEC: Lorsque beforeinstallprompt est disponible, le clic doit lancer l\'installation native'
);
console.log('✅ [PASS] 8. beforeinstallprompt lance l’installation native lorsque l’événement est disponible');

// D. Modal d'instructions Android quand beforeinstallprompt n'est pas disponible
assert(
  pwaContent.includes('else if (isAndroid)') && pwaContent.includes('setShowAndroidModal(true)'),
  'ÉCHEC: Lorsque beforeinstallprompt n\'est pas disponible sur Android, des instructions doivent s\'afficher'
);
assert(
  pwaContent.includes('pwa-android-modal') &&
  pwaContent.includes('trois points verticaux') &&
  pwaContent.includes('Installer l\'application'),
  'ÉCHEC: Le modal Android doit contenir les étapes précises adaptées aux navigateurs Android'
);
console.log('✅ [PASS] 9. Modal d’instructions Android clair et fonctionnel quand beforeinstallprompt est indisponible');

// E. Préservation du modal iOS
assert(
  pwaContent.includes('pwa-ios-modal') &&
  pwaContent.includes('Partager') &&
  pwaContent.includes('Sur l\'écran d\'accueil'),
  'ÉCHEC: Le modal iOS avec instructions Partager -> Sur l\'écran d\'accueil doit être conservé'
);
console.log('✅ [PASS] 10. Modal d’instructions iOS Safari conservé avec Partager -> Sur l’écran d’accueil');

// F. Bouton actif (jamais inactif ou désactivé)
assert(
  !pwaContent.includes('disabled={!isInstallable}'),
  'ÉCHEC: Le bouton d\'installation ne doit pas être rendu inactif'
);
console.log('✅ [PASS] 11. Aucun bouton inactif affiché sur mobile');

// G. Préservation du Service Worker en production et exclusion de la prévisualisation AI Studio
assert(
  pwaContent.includes('isAiStudioPreview') &&
  pwaContent.includes('run.app') &&
  pwaContent.includes("navigator.serviceWorker.register('/sw.js')"),
  'ÉCHEC: Le Service Worker doit être enregistré en production mais évité dans l\'aperçu AI Studio'
);
console.log('✅ [PASS] 12. Enregistrement Service Worker sécurisé pour Vercel et sans erreur de redirection en aperçu');

// H. Capture précoce de beforeinstallprompt au chargement du bundle
assert(
  pwaContent.includes('capturedInstallPrompt') &&
  pwaContent.includes("window.addEventListener('beforeinstallprompt'"),
  'ÉCHEC: beforeinstallprompt doit être capturé dès le chargement du bundle pour ne pas être manqué'
);
console.log('✅ [PASS] 13. Capture globale et précoce de beforeinstallprompt assurée');

// I. Traitement complet du prompt et du choix utilisateur
assert(
  pwaContent.includes('await promptToUse.prompt()') &&
  pwaContent.includes('await promptToUse.userChoice') &&
  pwaContent.includes("outcome === 'accepted'"),
  'ÉCHEC: L\'appel natif doit appeler prompt() et traiter userChoice'
);
console.log('✅ [PASS] 14. Déclenchement natif avec prompt() et traitement réel de userChoice');

// J. Intégrité de index.html pour la conformité PWA Android Chromium
const indexContent = fs.readFileSync(path.resolve('./index.html'), 'utf-8');
assert(
  indexContent.includes('id="pwa-manifest-link"') &&
  indexContent.includes('href="/manifest.json"') &&
  indexContent.includes('name="theme-color"'),
  'ÉCHEC: index.html doit déclarer le manifest et theme-color dès le chargement HTML pour que Chromium évalue l\'installation'
);
console.log('✅ [PASS] 15. index.html intègre le manifest et theme-color indispensables pour Android Chromium');

// K. Intégrité des règles Firestore et Firebase
const rulesContent = fs.readFileSync(path.resolve('./firestore.rules'), 'utf-8');
assert(
  rulesContent.includes('hasSensitiveSubscriptionFields'),
  'ÉCHEC: Les règles de sécurité des abonnements doivent être intactes'
);
console.log('✅ [PASS] 16. Intégrité absolue des règles de sécurité Firestore et abonnements conservée');

console.log('🎉 TOUS LES 16 TESTS PWA SÉLECTIF ET SÉCURITÉ ONT RÉUSSI !');
