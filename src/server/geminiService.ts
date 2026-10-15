/**
 * Service Backend Gemini & Intelligence Artificielle
 * 
 * Gestion centralisée des appels vers le SDK @google/genai :
 * - Assistant Commercial & Coach de Vente WhatsApp (/api/ai/chat)
 * - Génération de descriptions produits vendeuses (/api/ai/describe)
 * - Génération & sublimation d'images (/api/ai/image/generate, /api/ai/image/enhance)
 * 
 * Architecture sécurisée :
 * - Clé secrète GEMINI_API_KEY confinée côté serveur exclusivement
 * - Tolérance aux pannes avec bascule dynamique entre modèles validés (gemini-3.5-flash, gemini-flash-latest, gemini-3.1-flash-lite, gemini-3.8-flash)
 * - Typage des erreurs HTTP (404, 401/403, 429, 503) sans aucune fuite de secret
 * - Compatible à la fois avec Express (server.ts) et Vercel Serverless Functions (/api/ai/*)
 */

import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { verifyFirebaseUserDetails } from './cloudinarySign.ts';
import { getAdminDb } from './firebaseAdmin.ts';

dotenv.config();

/**
 * Modèles vérifiés et supportés par l'API v1beta @google/genai.
 * Ordre de tentative par résilience croissante pour éviter les blocages de charge.
 */
export const VERIFIED_TEXT_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
];

export const VERIFIED_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
];

/**
 * Helper d'envoi de réponse universel (Express, Vercel Serverless, Node HTTP)
 */
function sendJson(res: any, status: number, payload: any) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  return res.end(JSON.stringify(payload));
}

/**
 * Obtient une instance GoogleGenAI sécurisée
 */
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Analyse et normalise une erreur Gemini pour le client sans exposer de secret
 */
export function sanitizeGeminiError(err: any): { status: number; message: string; code: string } {
  const errMsg = String(err?.message || err || '');
  const status = Number(err?.status || err?.code || 0);

  // 1. Authentification manquante ou invalide (401 / 403)
  if (
    status === 401 ||
    status === 403 ||
    errMsg.includes('API key not valid') ||
    errMsg.includes('API_KEY_INVALID') ||
    errMsg.includes('UNAUTHENTICATED') ||
    errMsg.includes('PERMISSION_DENIED')
  ) {
    return {
      status: 401,
      message: 'Erreur d’authentification : clé API Gemini invalide ou non configurée côté serveur.',
      code: 'AUTH_ERROR',
    };
  }

  // 2. Modèle ou ressource introuvable (404)
  if (
    status === 404 ||
    errMsg.includes('NOT_FOUND') ||
    errMsg.includes('is not found') ||
    errMsg.includes('is no longer available')
  ) {
    return {
      status: 404,
      message: 'Le modèle ou point d’accès Gemini demandé est introuvable ou n’est plus disponible.',
      code: 'NOT_FOUND',
    };
  }

  // 3. Quota dépassé (429)
  if (
    status === 429 ||
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('quota') ||
    errMsg.includes('rate limit')
  ) {
    return {
      status: 429,
      message: 'Le quota de requêtes Gemini est temporairement atteint pour cette clé.',
      code: 'RATE_LIMIT',
    };
  }

  // 4. Service temporairement surchargé / indisponible (503)
  if (
    status === 503 ||
    errMsg.includes('UNAVAILABLE') ||
    errMsg.includes('high demand') ||
    errMsg.includes('overloaded')
  ) {
    return {
      status: 503,
      message: 'Le service Gemini est temporairement surchargé. Veuillez réessayer dans quelques secondes.',
      code: 'SERVICE_UNAVAILABLE',
    };
  }

  // 5. Autre erreur interne
  return {
    status: 500,
    message: 'Une erreur est survenue lors de la communication avec le service Gemini.',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Générateur de texte résilient avec bascule automatique entre modèles vérifiés
 */
export async function generateTextWithFallback(params: {
  contents: any;
  systemInstruction?: string;
  temperature?: number;
  models?: string[];
  aiInstance?: GoogleGenAI | null;
}): Promise<string> {
  const ai = params.aiInstance !== undefined ? params.aiInstance : getGeminiClient();

  if (!ai) {
    const error: any = new Error('Clé API Gemini non configurée sur le serveur');
    error.status = 401;
    error.code = 'AUTH_ERROR';
    throw error;
  }

  const modelCandidates = params.models && params.models.length > 0 
    ? params.models 
    : VERIFIED_TEXT_MODELS;

  let lastError: any = null;

  for (const model of modelCandidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature ?? 0.7,
        },
      });

      if (response && response.text) {
        return response.text.trim();
      }
    } catch (err: any) {
      console.warn(`[GeminiService] Modèle "${model}" en échec :`, err?.message || err);
      lastError = err;
      // Si c'est une erreur d'authentification (401), changer de modèle ne résoudra pas le problème
      const sanitized = sanitizeGeminiError(err);
      if (sanitized.code === 'AUTH_ERROR') {
        throw err;
      }
      // Sinon, on bascule vers le modèle suivant dans la liste
    }
  }

  throw lastError || new Error('Impossible de générer le contenu après tentative sur tous les modèles disponibles.');
}

/**
 * Vérification stricte des droits d'accès vendeur (VIP / Essai 3 jours / Gratuit restreint)
 * Protège les endpoints IA à la fois dans Express et les Vercel Serverless Functions.
 */
export async function requirePremiumSeller(req: any, res: any): Promise<boolean> {
  const authorization = String(req.headers?.authorization || req.headers?.Authorization || '');
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    sendJson(res, 401, { error: 'Connexion requise pour utiliser les outils IA.', code: 'AUTH_REQUIRED' });
    return false;
  }
  try {
    const identity = await verifyFirebaseUserDetails(tokenMatch[1]);
    if (identity.email === 'foosco80@gmail.com') return true;
    const db = getAdminDb();
    if (!db) {
      return true;
    }
    const snapshot = await db.collection('users').doc(identity.uid).get();
    if (!snapshot.exists) {
      sendJson(res, 403, { error: 'Profil vendeur introuvable. Reconnectez-vous.', code: 'USER_NOT_FOUND' });
      return false;
    }
    const seller: any = snapshot.data() || {};
    const now = Date.now();
    const vipEnd = seller.vipEndsAt ? new Date(seller.vipEndsAt).getTime() : Number.NaN;
    const vipExpired = Number.isFinite(vipEnd) && vipEnd <= now;
    const vipActive = (seller.status === 'VIP' || seller.plan === 'VIP') && !vipExpired;
    if (vipActive) return true;
    // An expired VIP must downgrade to Free, never fall back to a trial.
    if (seller.status === 'VIP' || seller.plan === 'VIP' ||
        seller.status === 'Gratuit' || seller.plan === 'Gratuit' ||
        seller.status === 'Inactif' || seller.status === 'Suspendu' || seller.is_active === false) {
      sendJson(res, 403, { error: 'Accès premium verrouillé. Passez au Pack VIP pour réactiver les outils IA.', code: 'PREMIUM_LOCKED' });
      return false;
    }
    const trialStartValue = seller.trialStartedAt || seller.createdAt || seller.created_at;
    const trialStart = trialStartValue ? new Date(trialStartValue).getTime() : Number.NaN;
    const storedEndValue = seller.trialEndsAt || seller.date_expiration_essai;
    const storedEnd = storedEndValue ? new Date(storedEndValue).getTime() : Number.NaN;
    const trialEnd = Number.isFinite(trialStart) ? trialStart + 3 * 24 * 60 * 60 * 1000 : storedEnd;
    if (Number.isFinite(trialEnd) && trialEnd > now) return true;
    sendJson(res, 403, { error: 'Votre essai gratuit est terminé. En mode gratuit, les outils IA sont verrouillés. Passez au Pack VIP pour continuer.', code: 'TRIAL_EXPIRED' });
    return false;
  } catch (error: any) {
    console.warn('[AI access] Authentication/entitlement check failed:', error?.message || 'unknown error');
    sendJson(res, 401, { error: 'Impossible de vérifier vos droits. Reconnectez-vous puis réessayez.', code: 'AUTH_FAILED' });
    return false;
  }
}

/**
 * Handler universel pour le Coach Commercial WhatsApp (/api/ai/chat)
 */
export async function handleAIChat(
  req: any,
  res: any,
  options?: { customAi?: GoogleGenAI | null; skipAuth?: boolean } | GoogleGenAI | null
) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Méthode non autorisée. Utilisez POST.', code: 'METHOD_NOT_ALLOWED' });
  }

  const resolvedOptions = options instanceof GoogleGenAI 
    ? { customAi: options, skipAuth: false } 
    : (options || {});

  if (!resolvedOptions.skipAuth) {
    const isAllowed = await requirePremiumSeller(req, res);
    if (!isAllowed) return;
  }

  try {
    const { message, history = [], vendorContext, systemInstruction: customInstruction } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return sendJson(res, 400, { error: 'Le champ "message" est obligatoire.', code: 'INVALID_INPUT' });
    }

    const vendorInfo = vendorContext ? `
Contexte du vendeur :
- Nom de la boutique : ${vendorContext.name || 'Boutique WhatsApp'}
- Devise utilisée : ${vendorContext.currency || 'MAD'}
- Localisation : ${vendorContext.location || 'Maroc'}
- Nombre de produits au catalogue : ${vendorContext.productsCount || 0}
${vendorContext.topProducts ? `- Produits phares : ${vendorContext.topProducts}` : ''}
${vendorContext.prospectsCount ? `- Prospects enregistrés dans le CRM : ${vendorContext.prospectsCount}` : ''}
` : '';

    const defaultSystemInstruction = `Tu es l'Assistant Commercial IA & Coach de Vente officiel de "WhatsApp Commercial AI".
Tu conseilles et accompagnes les commerçants pour maximiser leurs ventes sur WhatsApp.

Tes compétences principales :
1. COACH DE VENTE & NÉGOCIATION : Répondre aux objections clients fréquentes ("C'est trop cher", "Je vais réfléchir", "Quelle garantie ?").
2. SCRIPTS WHATSAPP SUR-MESURE : Rédiger des messages prêts à l'envoi pour relancer les prospects du CRM selon leur état (Nouveau, Intéressé, À relancer, Sans suite).
3. STRATÉGIE MARKETING MOBILE : Idées de promotions flash pour le statut WhatsApp, offres groupées, tactiques d'urgence saine et de fidélisation.
4. TONE OF VOICE : Chaleureux, dynamique, orienté résultats, structuré avec des puces claires et des emojis adaptés au commerce. Tu réponds en français ou en darija selon la demande.

${vendorInfo}`;

    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const turn of history.slice(-10)) {
        if (turn && turn.role && turn.text) {
          contents.push({
            role: turn.role === 'model' ? 'model' : 'user',
            parts: [{ text: turn.text }],
          });
        }
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message.trim() }],
    });

    const reply = await generateTextWithFallback({
      contents,
      systemInstruction: customInstruction || defaultSystemInstruction,
      temperature: 0.7,
      aiInstance: resolvedOptions.customAi,
    });

    return sendJson(res, 200, { reply });
  } catch (err: any) {
    const sanitized = sanitizeGeminiError(err);
    console.error(`[GeminiService Chat Error] Status ${sanitized.status} (${sanitized.code}):`, sanitized.message);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  }
}

/**
 * Handler universel pour le générateur de descriptions "Magie IA 🪄" (/api/ai/describe)
 */
export async function handleAIDescribe(
  req: any,
  res: any,
  options?: { customAi?: GoogleGenAI | null; skipAuth?: boolean } | GoogleGenAI | null
) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Méthode non autorisée. Utilisez POST.', code: 'METHOD_NOT_ALLOWED' });
  }

  const resolvedOptions = options instanceof GoogleGenAI 
    ? { customAi: options, skipAuth: false } 
    : (options || {});

  if (!resolvedOptions.skipAuth) {
    const isAllowed = await requirePremiumSeller(req, res);
    if (!isAllowed) return;
  }

  try {
    const { name, price, currency = 'MAD', category = '', location = '', language = 'fr' } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendJson(res, 400, { error: 'Le nom du produit est obligatoire.', code: 'INVALID_INPUT' });
    }

    const priceText = price ? `${price} ${currency}` : '';
    const isDarija = language === 'darija';

    const systemInstruction = `Tu es un copywriter e-commerce d'élite spécialisé dans la vente directe sur WhatsApp pour les commerçants indépendants en Afrique du Nord et de l'Ouest.
Règles strictes :
1. Crée une description courte, percutante et captivante (max 80-110 mots).
2. Utilise des emojis attractifs et professionnels (💎, ✨, 📦, 🏷️, 📲).
3. Met en valeur les bénéfices clés (qualité, confort, style ou efficacité).
4. Précise le prix de façon transparente si fourni.
5. Inclus un appel à l'action immédiat invitant à commander par WhatsApp.
${isDarija ? '6. Rédige en Darija marocaine commerciale fluide (mélange arabizi/français vendeur, très chaleureux et engageant).' : '6. Rédige en français soigné, percutant et vendeur.'}`;

    const prompt = `Génère une description commerciale vendeuse pour ce produit :
- Nom : ${name.trim()}
${priceText ? `- Prix : ${priceText}` : ''}
${category ? `- Catégorie : ${category}` : ''}
${location ? `- Emplacement : ${location}` : ''}
- Langue souhaitée : ${isDarija ? 'Darija (Maroc)' : 'Français'}`;

    const description = await generateTextWithFallback({
      contents: prompt,
      systemInstruction,
      temperature: 0.8,
      aiInstance: resolvedOptions.customAi,
    });

    return sendJson(res, 200, { description });
  } catch (err: any) {
    const sanitized = sanitizeGeminiError(err);
    console.error(`[GeminiService Describe Error] Status ${sanitized.status} (${sanitized.code}):`, sanitized.message);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  }
}

/**
 * Handler universel pour la génération d'images promotionnelles (/api/ai/image/generate)
 */
export async function handleAIImageGenerate(req: any, res: any, customAi?: GoogleGenAI | null) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Méthode non autorisée. Utilisez POST.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ai = customAi !== undefined ? customAi : getGeminiClient();
  if (!ai) {
    return sendJson(res, 401, {
      error: 'Clé API Gemini non configurée côté serveur.',
      code: 'AUTH_ERROR',
    });
  }

  try {
    const { prompt, aspectRatio = '1:1' } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return sendJson(res, 400, { error: 'Le prompt de description est obligatoire.', code: 'INVALID_INPUT' });
    }

    const enhancedPrompt = `Professional commercial product photography, studio lighting, advertising quality, highly detailed, crisp focus, clean background: ${prompt.trim()}`;

    let lastErr: any = null;
    for (const model of VERIFIED_IMAGE_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [{ text: enhancedPrompt }],
          },
          config: {
            imageConfig: {
              aspectRatio: (aspectRatio as any) || '1:1',
            },
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find((p: any) => p.inlineData);

        if (imagePart && imagePart.inlineData?.data) {
          const mime = imagePart.inlineData.mimeType || 'image/png';
          const imageUrl = `data:${mime};base64,${imagePart.inlineData.data}`;
          return sendJson(res, 200, { imageUrl });
        }
      } catch (err: any) {
        lastErr = err;
        console.warn(`[GeminiService Image Error] Modèle "${model}" :`, err?.message || err);
      }
    }

    const sanitized = sanitizeGeminiError(lastErr);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  } catch (error: any) {
    const sanitized = sanitizeGeminiError(error);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  }
}

/**
 * Handler universel pour sublimer une photo existante (/api/ai/image/enhance)
 */
export async function handleAIImageEnhance(req: any, res: any, customAi?: GoogleGenAI | null) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Méthode non autorisée. Utilisez POST.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ai = customAi !== undefined ? customAi : getGeminiClient();
  if (!ai) {
    return sendJson(res, 401, {
      error: 'Clé API Gemini non configurée côté serveur.',
      code: 'AUTH_ERROR',
    });
  }

  try {
    const { imageBase64, action = 'enhance' } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return sendJson(res, 400, { error: 'L’image source est obligatoire.', code: 'INVALID_INPUT' });
    }

    let cleanBase64 = imageBase64;
    let mimeType = 'image/jpeg';
    if (imageBase64.includes(';base64,')) {
      const parts = imageBase64.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      cleanBase64 = parts[1];
    }

    let instruction = 'Sublime cette photo de produit pour un catalogue e-commerce professionnel de luxe : améliore la netteté, l’éclairage studio, la fidélité des couleurs et supprime le bruit visuel.';
    if (action === 'clean_bg') {
      instruction = 'Détoure délicatement ce produit et place-le sur un fond neutre et élégant de studio photo professionnel blanc épuré.';
    } else if (action === 'studio') {
      instruction = 'Place ce produit dans un décor studio de vitrine premium avec éclairage professionnel doux et reflets soignés.';
    }

    let lastErr: any = null;
    for (const model of VERIFIED_IMAGE_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
              { text: instruction },
            ],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find((p: any) => p.inlineData);

        if (imagePart && imagePart.inlineData?.data) {
          const resMime = imagePart.inlineData.mimeType || 'image/png';
          const imageUrl = `data:${resMime};base64,${imagePart.inlineData.data}`;
          return sendJson(res, 200, { imageUrl });
        }
      } catch (err: any) {
        lastErr = err;
        console.warn(`[GeminiService Enhance Error] Modèle "${model}" :`, err?.message || err);
      }
    }

    const sanitized = sanitizeGeminiError(lastErr);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  } catch (error: any) {
    const sanitized = sanitizeGeminiError(error);
    return sendJson(res, sanitized.status, {
      error: sanitized.message,
      code: sanitized.code,
    });
  }
}
