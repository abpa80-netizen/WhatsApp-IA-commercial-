import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import { handleCloudinarySign, verifyFirebaseIdToken, verifyFirebaseUserDetails, generateCloudinarySignature } from './src/server/cloudinarySign.ts';
import { getAdminDb } from './src/server/firebaseAdmin.ts';

export { verifyFirebaseIdToken, generateCloudinarySignature, handleCloudinarySign };

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Note: Old JSON file-based database endpoints (/api/auth/access, /api/admin/*, /api/vendors/*, /api/system/config)
// have been removed to prepare for Firebase Auth & Firestore integration.

// Premium API guard: client-side locks are UX only; enforce entitlements on every AI endpoint.
async function requirePremiumSeller(req: Request, res: Response): Promise<boolean> {
  const authorization = String(req.headers.authorization || '');
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    res.status(401).json({ error: 'Connexion requise pour utiliser les outils IA.' });
    return false;
  }

  try {
    const identity = await verifyFirebaseUserDetails(tokenMatch[1]);
    if (identity.email === 'foosco80@gmail.com') return true;

    const snapshot = await getAdminDb().collection('users').doc(identity.uid).get();
    if (!snapshot.exists) {
      res.status(403).json({ error: 'Profil vendeur introuvable. Reconnectez-vous.' });
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
      res.status(403).json({ error: 'Accès premium verrouillé. Passez au Pack VIP pour réactiver les outils IA.' });
      return false;
    }

    const trialStartValue = seller.trialStartedAt || seller.createdAt || seller.created_at;
    const trialStart = trialStartValue ? new Date(trialStartValue).getTime() : Number.NaN;
    const storedEndValue = seller.trialEndsAt || seller.date_expiration_essai;
    const storedEnd = storedEndValue ? new Date(storedEndValue).getTime() : Number.NaN;
    const trialEnd = Number.isFinite(trialStart) ? trialStart + 3 * 24 * 60 * 60 * 1000 : storedEnd;
    if (Number.isFinite(trialEnd) && trialEnd > now) return true;

    res.status(403).json({ error: 'Votre essai gratuit est terminé. En mode gratuit, les outils IA sont verrouillés. Passez au Pack VIP pour continuer.' });
    return false;
  } catch (error: any) {
    console.warn('[AI access] Authentication/entitlement check failed:', error?.message || 'unknown error');
    res.status(401).json({ error: 'Impossible de vérifier vos droits. Reconnectez-vous puis réessayez.' });
    return false;
  }
}

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Resilient text generator across Gemini models with auto-retry
async function generateTextWithFallback(params: {
  contents: any;
  systemInstruction?: string;
  temperature?: number;
}): Promise<string> {
  const models = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature ?? 0.7,
        },
      });
      if (response.text) {
        return response.text.trim();
      }
    } catch (err: any) {
      console.warn(`Model ${model} attempt failed:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError || new Error('Impossible de générer le contenu');
}

// 1. PRODUCT DESCRIPTION GENERATOR ("Magie IA 🪄")
app.post('/api/ai/describe', async (req: Request, res: Response) => {
  try {
    if (!(await requirePremiumSeller(req, res))) return;
    const { name, price, currency = 'MAD', category = '', location = '', language = 'fr' } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Le nom du produit est obligatoire.' });
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
- Nom : ${name}
${priceText ? `- Prix : ${priceText}` : ''}
${category ? `- Catégorie : ${category}` : ''}
${location ? `- Emplacement : ${location}` : ''}
- Langue souhaitée : ${isDarija ? 'Darija (Maroc)' : 'Français'}`;

    const description = await generateTextWithFallback({
      contents: prompt,
      systemInstruction,
      temperature: 0.8,
    });

    return res.json({ description });
  } catch (error: any) {
    console.error('Error generating description:', error);
    return res.status(500).json({ 
      error: error?.message || 'Erreur lors de la génération de la description' 
    });
  }
});

// 2. ASSISTANT COMMERCIAL & COACH DE VENTE IA (CHATBOT GEMINI)
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    if (!(await requirePremiumSeller(req, res))) return;
    const { message, history = [], vendorContext, systemInstruction: customInstruction } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Le message est obligatoire.' });
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

    // Map conversation history
    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const turn of history.slice(-10)) {
        if (turn.role && turn.text) {
          contents.push({
            role: turn.role === 'model' ? 'model' : 'user',
            parts: [{ text: turn.text }],
          });
        }
      }
    }

    // Add current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const reply = await generateTextWithFallback({
      contents,
      systemInstruction: customInstruction || defaultSystemInstruction,
      temperature: 0.7,
    });

    return res.json({ reply });
  } catch (error: any) {
    console.error('Error in AI Chat:', error);
    return res.status(500).json({ 
      error: error?.message || 'Erreur lors du traitement de votre demande avec Gemini' 
    });
  }
});

// 3. GENERATION DE BANNIERE / PHOTO PROMO (gemini-3.1-flash-image)
app.post('/api/ai/image/generate', async (req: Request, res: Response) => {
  try {
    if (!(await requirePremiumSeller(req, res))) return;
    const { prompt, aspectRatio = '1:1' } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Le prompt de description est obligatoire.' });
    }

    const enhancedPrompt = `Professional commercial product photography, studio lighting, advertising quality, highly detailed, crisp focus, clean background: ${prompt}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image',
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
        return res.json({ imageUrl });
      }

      return res.status(502).json({ error: 'Le modèle n’a pas retourné d’image valide.' });
    } catch (apiErr: any) {
      console.warn('Gemini image generation warning:', apiErr?.message);
      
      // If quota exceeded or image model requires paid key
      if (apiErr?.message?.includes('quota') || apiErr?.message?.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          error: 'Le quota de génération d’images Imagen est atteint pour cette clé. Vous pouvez importer une photo manuellement.',
          code: 'QUOTA_EXCEEDED'
        });
      }

      return res.status(500).json({ 
        error: apiErr?.message || 'Erreur lors de la génération de l’image.' 
      });
    }
  } catch (error: any) {
    console.error('Error in image generation:', error);
    return res.status(500).json({ error: error?.message || 'Erreur interne du serveur' });
  }
});

// 4. SUBLIMER LA PHOTO EXISTANTE (gemini-3.1-flash-image)
app.post('/api/ai/image/enhance', async (req: Request, res: Response) => {
  try {
    if (!(await requirePremiumSeller(req, res))) return;
    const { imageBase64, action = 'enhance' } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'L’image source est obligatoire.' });
    }

    // Extract base64 and mime
    let cleanBase64 = imageBase64;
    let mimeType = 'image/jpeg';

    if (imageBase64.includes('data:') && imageBase64.includes(';base64,')) {
      const parts = imageBase64.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      cleanBase64 = parts[1];
    }

    let editPrompt = "Sublime cette photo de produit pour un e-commerce : éclairage de studio professionnel, améliore la netteté et la mise en valeur du produit principal, élimine les imperfections et optimise le contraste pour un rendu ultra vendeur.";
    if (action === 'clean_bg') {
      editPrompt = "Détoure et isole ce produit sur un fond de studio moderne, minimaliste et épuré avec une douce ombre portée naturelle.";
    } else if (action === 'studio') {
      editPrompt = "Transforme cette photo en un shooting publicitaire de luxe, éclairage doux, reflets soignés et ambiance haut de gamme.";
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              },
            },
            {
              text: editPrompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: '1:1',
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);

      if (imagePart && imagePart.inlineData?.data) {
        const mime = imagePart.inlineData.mimeType || 'image/png';
        const imageUrl = `data:${mime};base64,${imagePart.inlineData.data}`;
        return res.json({ imageUrl });
      }

      return res.status(502).json({ error: 'Le modèle n’a pas retourné d’image sublimée.' });
    } catch (apiErr: any) {
      console.warn('Gemini image enhancement warning:', apiErr?.message);

      if (apiErr?.message?.includes('quota') || apiErr?.message?.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          error: 'Quota Imagen atteint. La photo originale a été conservée.',
          code: 'QUOTA_EXCEEDED'
        });
      }

      return res.status(500).json({ 
        error: apiErr?.message || 'Erreur lors de l’amélioration de la photo.' 
      });
    }
  } catch (error: any) {
    console.error('Error in image enhance:', error);
    return res.status(500).json({ error: error?.message || 'Erreur interne du serveur' });
  }
});

// -------------------------------------------------------------------------
// 3. CLOUDINARY SECURE SIGNATURE ENDPOINT (FIREBASE AUTH VERIFICATION)
// -------------------------------------------------------------------------
// Route partagée avec la fonction Serverless Vercel (api/cloudinary/sign.ts)
app.post('/api/cloudinary/sign', async (req: Request, res: Response) => {
  await handleCloudinarySign(req, res);
});

// -------------------------------------------------------------------------
// 4. SUBSCRIPTION ENTITLEMENTS & EXPIRATION RECALCULATION ENDPOINT
// -------------------------------------------------------------------------
app.all('/api/admin/recalculate-entitlements', async (req: Request, res: Response) => {
  const { handleRecalculateEntitlements } = await import('./src/server/entitlementsService.ts');
  return handleRecalculateEntitlements(req, res);
});

// -------------------------------------------------------------------------
// 5. VIP STRUCTURED ORDERS CREATION ENDPOINT
// -------------------------------------------------------------------------
app.all('/api/orders/create', async (req: Request, res: Response) => {
  const { handleCreateOrder } = await import('./src/server/ordersService.ts');
  return handleCreateOrder(req, res);
});

// START SERVER WITH VITE (DEV) OR STATIC DIST (PROD)
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`WhatsApp Commercial AI backend running on http://0.0.0.0:${PORT}`);

    // In persistent server mode (Cloud Run / Node daemon), optionally run background verification if Firebase Admin is configured:
    try {
      const { isFirebaseAdminConfigured } = await import('./src/server/firebaseAdmin.ts');
      if (isFirebaseAdminConfigured()) {
        const intervalMs = Number(process.env.ENTITLEMENTS_INTERVAL_MS) || 60 * 60 * 1000;
        setTimeout(async () => {
          try {
            const { recalculateAllEntitlementsServer } = await import('./src/server/entitlementsService.ts');
            console.log('[Entitlements Engine] Running initial subscription expiration sync...');
            const s = await recalculateAllEntitlementsServer();
            console.log(`[Entitlements Engine] Initial sync: ${s.updatedPublicStores} stores updated (${s.fullCatalogCount} full, ${s.restrictedCount} restricted).`);
          } catch (err) {
            console.warn('[Entitlements Engine] Initial sync error:', err);
          }
        }, 15000);

        setInterval(async () => {
          try {
            const { recalculateAllEntitlementsServer } = await import('./src/server/entitlementsService.ts');
            console.log('[Entitlements Engine] Running scheduled subscription expiration sync...');
            const s = await recalculateAllEntitlementsServer();
            console.log(`[Entitlements Engine] Scheduled sync: ${s.updatedPublicStores} stores updated (${s.fullCatalogCount} full, ${s.restrictedCount} restricted).`);
          } catch (err) {
            console.warn('[Entitlements Engine] Scheduled sync error:', err);
          }
        }, intervalMs);
      } else {
        console.log('[Entitlements Engine] Firebase Admin credentials not set. On Vercel, automated checks run via Vercel Cron; on client, via Admin Portal.');
      }
    } catch {
      // ignore
    }
  });
}

export { app };
export default app;

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
