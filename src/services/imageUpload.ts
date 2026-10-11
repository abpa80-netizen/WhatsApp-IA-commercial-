/**
 * Service de traitement, compression et téléversement d'images pour WhatsApp Commercial AI
 * 
 * Stratégie Cloudinary signée :
 * 1. Validation stricte côté client (types MIME autorisés, rejet des SVG, taille < 10 Mo).
 * 2. Compression dans le navigateur avant envoi :
 *    - Produits : maximum 1600×1600 px, qualité 82 %, WebP si compatible sinon JPEG.
 *    - Logos : maximum 512×512 px, qualité 85 %, WebP si compatible sinon JPEG.
 * 3. Récupération du jeton Firebase ID de l'utilisateur connecté via Firebase Auth.
 * 4. Obtention de la signature cryptographique auprès de POST /api/cloudinary/sign (dossier imposé par UID).
 * 5. Téléversement direct du Blob compressé vers l'API Cloudinary (cloud 'pb426age').
 * 6. Retour strict de la 'secure_url' Cloudinary (aucun fallback éphémère blob:, Base64 ou Firebase Storage).
 */
import { auth } from '../firebase';

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo max

/**
 * Valide un fichier image avant traitement :
 * - Rejette les fichiers non-images
 * - Rejette explicitement les fichiers SVG (sécurité et non-pertinence pour la compression matricielle)
 * - Rejette les fichiers de plus de 10 Mo
 */
export function validateImageFile(file: File): void {
  if (!file) {
    throw new Error('Aucun fichier sélectionné.');
  }

  const fileName = (file.name || '').toLowerCase();
  const fileType = (file.type || '').toLowerCase();

  // 1. Rejet explicite des fichiers SVG
  if (fileType === 'image/svg+xml' || fileName.endsWith('.svg')) {
    throw new Error('Les fichiers SVG ne sont pas autorisés.');
  }

  // 2. Vérification du type image
  const isAcceptedType =
    ACCEPTED_IMAGE_TYPES.includes(fileType) ||
    (fileType.startsWith('image/') && !fileType.includes('svg'));

  if (!isAcceptedType) {
    throw new Error('Format non pris en charge. Veuillez choisir une image JPG, PNG, WEBP ou GIF.');
  }

  // 3. Taille maximale avant compression : 10 Mo
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`L’image est trop volumineuse (${sizeInMb} Mo). La taille maximale autorisée est de 10 Mo.`);
  }
}

/**
 * Calcule les dimensions cibles proportionnelles en préservant le ratio d'aspect
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Détecte si le navigateur prend en charge l'export WebP via canvas
 */
export function isWebPSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    if (canvas.getContext && canvas.getContext('2d')) {
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Redimensionne et compresse une image dans le navigateur via l'API Canvas
 * Utilise WebP si supporté par le navigateur, sinon JPEG.
 */
export async function compressImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.82
): Promise<Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return file;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Impossible de lire le fichier image sélectionné.'));
    };

    reader.onload = (e) => {
      const img = new Image();

      img.onerror = () => {
        reject(new Error('Format d’image invalide ou corrompu.'));
      };

      img.onload = () => {
        try {
          const { width, height } = calculateTargetDimensions(
            img.width,
            img.height,
            maxWidth,
            maxHeight
          );

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Contexte Canvas 2D indisponible dans ce navigateur.'));
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          const outputMime = isWebPSupported() ? 'image/webp' : 'image/jpeg';
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Échec de la compression de l’image.'));
              }
            },
            outputMime,
            quality
          );
        } catch (err: any) {
          reject(new Error(`Erreur lors de la compression de l’image : ${err?.message || err}`));
        }
      };

      img.src = e.target?.result as string;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Téléverse un Blob compressé vers Cloudinary après avoir obtenu la signature
 * sécurisée auprès de notre backend.
 * N'utilise AUCUN fallback blob:, Base64 ou Firebase Storage.
 */
export async function uploadToCloudinary(
  blob: Blob,
  folder: 'products' | 'logos',
  originalFileName: string = 'image.webp'
): Promise<string> {
  // 1. Récupération du jeton Firebase ID de l'utilisateur connecté
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Utilisateur non connecté. Veuillez vous connecter pour téléverser une image.');
  }

  let idToken = '';
  try {
    idToken = await currentUser.getIdToken();
  } catch (tokenErr: any) {
    throw new Error(`Impossible d’obtenir le jeton d’authentification : ${tokenErr?.message || tokenErr}`);
  }

  if (!idToken) {
    throw new Error('Jeton d’authentification Firebase vide.');
  }

  // 2. Demande de signature au endpoint sécurisé du serveur
  let signResponse: Response;
  try {
    signResponse = await fetch('/api/cloudinary/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ folder }),
    });
  } catch (netErr: any) {
    throw new Error(`Erreur réseau lors de la demande de signature : ${netErr?.message || netErr}`);
  }

  if (!signResponse.ok) {
    const errorData = await signResponse.json().catch(() => ({}));
    const message = errorData?.error || `Erreur de signature serveur (${signResponse.status})`;
    throw new Error(message);
  }

  const signData = await signResponse.json();
  const { signature, timestamp, apiKey, cloudName, folder: targetFolder } = signData;

  if (!signature || !timestamp || !apiKey || !targetFolder) {
    throw new Error('Réponse de signature incomplète reçue du serveur.');
  }

  // 3. Téléversement direct du fichier compressé vers l'API Cloudinary du cloud pb426age
  const targetCloud = cloudName || 'pb426age';
  const uploadEndpoint = `https://api.cloudinary.com/v1_1/${targetCloud}/image/upload`;

  const formData = new FormData();
  formData.append('file', blob, originalFileName);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', targetFolder);

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(uploadEndpoint, {
      method: 'POST',
      body: formData,
    });
  } catch (uploadNetErr: any) {
    throw new Error(`Échec de la connexion à l’API Cloudinary : ${uploadNetErr?.message || uploadNetErr}`);
  }

  if (!uploadResponse.ok) {
    const errData = await uploadResponse.json().catch(() => ({}));
    const cloudErr = errData?.error?.message || `Erreur HTTP ${uploadResponse.status} reçue de Cloudinary`;
    throw new Error(`Échec du téléversement Cloudinary : ${cloudErr}`);
  }

  const uploadResult = await uploadResponse.json();
  if (!uploadResult?.secure_url || typeof uploadResult.secure_url !== 'string') {
    throw new Error('Réponse Cloudinary invalide : aucune secure_url reçue.');
  }

  return uploadResult.secure_url;
}

/**
 * Téléverse une image vers Cloudinary avec compression adaptée selon le dossier :
 * - Produits : maximum 1600×1600 px, qualité 82 %
 * - Logos : maximum 512×512 px, qualité 85 %
 */
export async function uploadImageToStorage(
  file: File,
  folder: 'products' | 'logos' = 'products',
  _vendorUid?: string
): Promise<string> {
  validateImageFile(file);

  const isLogo = folder === 'logos';
  const maxWidth = isLogo ? 512 : 1600;
  const maxHeight = isLogo ? 512 : 1600;
  const quality = isLogo ? 0.85 : 0.82;

  const compressedBlob = await compressImage(file, maxWidth, maxHeight, quality);
  const secureUrl = await uploadToCloudinary(compressedBlob, folder, file.name);

  return secureUrl;
}

/**
 * Fonction principale de traitement et téléversement appelée par l'interface.
 * Conserve la compatibilité des signatures d'appel tout en appliquant les contraintes requises :
 * - Produits : maximum 1600×1600 px, qualité 82 %
 * - Logos : maximum 512×512 px, qualité 85 %
 * Retourne uniquement la secure_url de Cloudinary.
 */
export async function processImageFile(
  file: File,
  _maxWidth = 1600,
  _maxHeight = 1600,
  _quality = 0.82,
  folder: 'products' | 'logos' = 'products',
  _vendorUid?: string
): Promise<string> {
  return uploadImageToStorage(file, folder, _vendorUid);
}

