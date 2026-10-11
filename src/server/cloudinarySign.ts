import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Helper pour compatibilité ESM __dirname
const getDirname = () => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

/**
 * Vérifie de façon cryptographique et sécurisée le jeton Firebase ID côté serveur
 * via l'API officielle Google Identity Toolkit.
 * @returns uid de l'utilisateur authentifié (qui ne peut pas être falsifié par le client)
 */
export async function verifyFirebaseIdToken(token: string): Promise<string> {
  let firebaseApiKey = '';

  // 1. Recherche dans firebase-applet-config.json
  const possiblePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(getDirname(), '../../firebase-applet-config.json'),
    path.resolve(getDirname(), '../firebase-applet-config.json'),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (cfg.apiKey) {
          firebaseApiKey = cfg.apiKey;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  // 2. Recherche dans les variables d'environnement
  if (!firebaseApiKey) {
    firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';
  }

  if (!firebaseApiKey) {
    throw new Error('Configuration Firebase serveur manquante (clé API introuvable).');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );

  if (!response.ok) {
    const errorData: any = await response.json().catch(() => ({}));
    const message = errorData?.error?.message || 'Token verification failed';
    throw new Error(message);
  }

  const data: any = await response.json();
  const uid = data?.users?.[0]?.localId;
  if (!uid) {
    throw new Error('Utilisateur non identifié pour ce jeton.');
  }

  return uid;
}

/**
 * Génère la signature Cloudinary standard SHA-1 sur les paramètres autorisés.
 * Spécification Cloudinary : tri alphabétique des clés, concaténation k=v&... et ajout de apiSecret
 */
export function generateCloudinarySignature(params: Record<string, any>, apiSecret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

/**
 * Valide et impose l'arborescence autorisée isolée par UID.
 */
export function buildAuthorizedFolder(verifiedUid: string, requestedFolder: any): { valid: boolean; folder?: string; error?: string } {
  const cleanFolder = String(requestedFolder || 'products').trim().toLowerCase();
  if (cleanFolder !== 'products' && cleanFolder !== 'logos') {
    return {
      valid: false,
      error: 'Dossier de destination non autorisé. Seuls "products" et "logos" sont acceptés.'
    };
  }
  return {
    valid: true,
    folder: `users/${verifiedUid}/${cleanFolder}`
  };
}

/**
 * Envoie une réponse JSON compatible Express, Vercel Serverless Function ou Node HTTP standard.
 */
function sendJson(res: any, status: number, payload: any) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export interface CloudinarySignOptions {
  tokenVerifier?: (token: string) => Promise<string>;
  config?: {
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
  };
}

/**
 * Gestionnaire universel de la route POST /api/cloudinary/sign
 * Utilisable directement dans Express (server.ts) et comme Vercel Serverless Function (api/cloudinary/sign.ts).
 */
export async function handleCloudinarySign(req: any, res: any, options?: CloudinarySignOptions) {
  // 0. Configuration CORS et headers de sécurité
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function' && typeof res.end === 'function') {
      return res.status(204).end();
    }
    res.statusCode = 204;
    return res.end();
  }

  if (req.method && req.method !== 'POST') {
    return sendJson(res, 405, {
      error: 'Méthode non autorisée. Seule la méthode POST est acceptée.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  try {
    // 1. Extraction et vérification de l'en-tête Authorization
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization;

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, {
        error: 'Jeton d’authentification manquant dans l’en-tête Authorization.',
        code: 'AUTH_TOKEN_MISSING'
      });
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    if (!idToken) {
      return sendJson(res, 401, {
        error: 'Jeton d’authentification vide.',
        code: 'AUTH_TOKEN_EMPTY'
      });
    }

    // 2. Vérification cryptographique côté serveur du jeton Firebase ID (l'UID n'est jamais cru sur parole)
    let verifiedUid: string;
    const verifier = options?.tokenVerifier || verifyFirebaseIdToken;
    try {
      verifiedUid = await verifier(idToken);
    } catch (authErr: any) {
      return sendJson(res, 401, {
        error: 'Jeton d’authentification Firebase invalide ou expiré.',
        code: 'AUTH_TOKEN_INVALID'
      });
    }

    // 3. Vérification de la présence des clés serveur Cloudinary (503 si non configuré)
    const cloudName = options?.config?.cloudName || process.env.CLOUDINARY_CLOUD_NAME || 'pb426age';
    const apiKey = options?.config?.apiKey || process.env.CLOUDINARY_API_KEY;
    const apiSecret = options?.config?.apiSecret || process.env.CLOUDINARY_API_SECRET;

    if (!apiKey || !apiSecret) {
      return sendJson(res, 503, {
        error: 'Configuration Cloudinary serveur incomplète : CLOUDINARY_API_KEY ou CLOUDINARY_API_SECRET non défini.',
        code: 'CLOUDINARY_CONFIG_MISSING'
      });
    }

    // 4. Extraction du corps de la requête (support Express et Vercel Serverless)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    // 5. Validation stricte du dossier et imposition du chemin isolé par UID
    const folderValidation = buildAuthorizedFolder(verifiedUid, body?.folder);
    if (!folderValidation.valid || !folderValidation.folder) {
      return sendJson(res, 400, {
        error: folderValidation.error || 'Dossier non autorisé.',
        code: 'INVALID_FOLDER'
      });
    }

    const targetFolder = folderValidation.folder;
    const timestamp = Math.floor(Date.now() / 1000);

    // 6. Calcul de la signature SHA-1 avec le secret serveur
    const paramsToSign = {
      folder: targetFolder,
      timestamp: timestamp,
    };

    const signature = generateCloudinarySignature(paramsToSign, apiSecret);

    // 7. Réponse sécurisée : LE SECRET N'EST JAMAIS RENVOYÉ AU NAVIGATEUR
    return sendJson(res, 200, {
      signature,
      timestamp,
      apiKey,
      cloudName,
      folder: targetFolder,
    });
  } catch (error: any) {
    console.error('Erreur lors de la signature Cloudinary:', error?.message);
    return sendJson(res, 500, {
      error: 'Erreur interne du serveur lors de la signature Cloudinary.',
      code: 'INTERNAL_ERROR'
    });
  }
}
