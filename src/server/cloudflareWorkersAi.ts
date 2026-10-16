/**
 * Module Fournisseur Alternatif de Génération d'Images : Cloudflare Workers AI
 * 
 * Modèles supportés :
 * - '@cf/black-forest-labs/flux-1-schnell' (Modèle principal haute fidélité FLUX.1)
 * - '@cf/bytedance/stable-diffusion-xl-lightning' (Repli rapide SDXL Lightning)
 * - '@cf/stabilityai/stable-diffusion-xl-base-1.0' (Repli standard SDXL)
 * 
 * Spécifications et Limites du Quota Gratuit Cloudflare Workers AI :
 * 1. Allocation gratuite : 10 000 "Neurons" par jour (réinitialisation quotidienne à 00:00 UTC).
 * 2. Consommation :
 *    - FLUX.1 Schnell : ~2 000 Neurons par génération (~5 images gratuites par jour).
 *    - SDXL Lightning : ~1 000 à 1 500 Neurons par génération (~7 à 10 images gratuites par jour).
 * 3. Prérequis de compte :
 *    - Compte Cloudflare gratuit (aucun moyen de paiement ni carte bancaire requis).
 *    - Token d'API Cloudflare avec permission "Workers AI: Read / Run".
 *    - ID de compte Cloudflare (Account ID).
 * 4. Plafond dur : Dès que le quota de 10 000 Neurons est atteint, Cloudflare renvoie HTTP 429 sans frais.
 */

import dotenv from 'dotenv';

dotenv.config();

export const CLOUDFLARE_IMAGE_MODELS = [
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/bytedance/stable-diffusion-xl-lightning',
  '@cf/stabilityai/stable-diffusion-xl-base-1.0',
];

export interface CloudflareImageConfig {
  accountId?: string;
  apiToken?: string;
  fetchFn?: typeof fetch;
}

/**
 * Vérifie si les identifiants Cloudflare Workers AI sont configurés dans l'environnement serveur
 */
export function isCloudflareConfigured(config?: CloudflareImageConfig): boolean {
  const accountId = config?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = config?.apiToken || process.env.CLOUDFLARE_API_TOKEN || '';
  return Boolean(accountId.trim() && apiToken.trim());
}

/**
 * Génère une image via l'API REST officielle Cloudflare Workers AI
 */
export async function generateImageWithCloudflare(
  prompt: string,
  options?: {
    model?: string;
    config?: CloudflareImageConfig;
  }
): Promise<{ imageUrl: string; model: string; provider: 'cloudflare' }> {
  const accountId = (options?.config?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (options?.config?.apiToken || process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const fetchClient = options?.config?.fetchFn || fetch;

  if (!accountId || !apiToken) {
    const err: any = new Error(
      'Fournisseur alternatif Cloudflare non configuré (CLOUDFLARE_ACCOUNT_ID ou CLOUDFLARE_API_TOKEN manquant côté serveur).'
    );
    err.status = 503;
    err.code = 'CLOUDFLARE_NOT_CONFIGURED';
    throw err;
  }

  const modelToUse = options?.model || CLOUDFLARE_IMAGE_MODELS[0];
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelToUse}`;

  let response: Response;
  try {
    response = await fetchClient(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
      }),
    });
  } catch (netErr: any) {
    const err: any = new Error('Erreur réseau lors de la communication avec Cloudflare Workers AI.');
    err.status = 503;
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  if (!response.ok) {
    // Analyse propre du statut sans fuite de token
    if (response.status === 401 || response.status === 403) {
      const err: any = new Error('Authentification Cloudflare invalide ou non autorisée.');
      err.status = 401;
      err.code = 'AUTH_ERROR';
      throw err;
    }

    if (response.status === 429) {
      const err: any = new Error(
        'Le quota gratuit Cloudflare Workers AI (10 000 Neurons/jour) est atteint pour aujourd’hui.'
      );
      err.status = 429;
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }

    const errBody = await response.text().catch(() => '');
    const isOverloaded = response.status === 503 || errBody.includes('capacity') || errBody.includes('unavailable');
    const err: any = new Error(
      isOverloaded
        ? 'Service Cloudflare Workers AI temporairement surchargé. Réessayez dans un instant.'
        : `Erreur du fournisseur alternatif Cloudflare (${response.status}).`
    );
    err.status = isOverloaded ? 503 : 502;
    err.code = isOverloaded ? 'SERVICE_UNAVAILABLE' : 'PROVIDER_ERROR';
    throw err;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // 1. Format JSON avec image en Base64 (comme retourné par flux-1-schnell)
  if (contentType.includes('application/json')) {
    const json = await response.json();
    const base64Data = json?.result?.image || json?.image;
    if (base64Data && typeof base64Data === 'string') {
      const dataUri = base64Data.startsWith('data:')
        ? base64Data
        : `data:image/png;base64,${base64Data}`;
      return { imageUrl: dataUri, model: modelToUse, provider: 'cloudflare' };
    }
    throw new Error('Réponse JSON Cloudflare sans image valide.');
  }

  // 2. Format binaire direct (image/png ou octet-stream)
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 0) {
    const buffer = Buffer.from(arrayBuffer);
    const mime = contentType.includes('image/') ? contentType.split(';')[0] : 'image/png';
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    return { imageUrl: dataUri, model: modelToUse, provider: 'cloudflare' };
  }

  throw new Error('Image vide reçue de Cloudflare Workers AI.');
}
