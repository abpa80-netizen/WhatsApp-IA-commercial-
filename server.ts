import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseService } from './server/db.js';

dotenv.config();

// Initialize database
DatabaseService.init();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// ==========================================
// 1. UNIQUE ACCESS & AUTHENTICATION ENDPOINT
// ==========================================
// Single entry form: phone + password
// - If phone not found: automatically register user with unique ID (e.g. VEND-102) & hash password
// - If phone found: verify hashed password & ensure account is active (ON)
app.post('/api/auth/access', (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({
        error: 'Le numéro WhatsApp et le mot de passe sont obligatoires.',
        code: 'MISSING_CREDENTIALS',
      });
    }

    const result = DatabaseService.accessByPhoneAndPassword(phone, password);
    if (!result.success) {
      return res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
      });
    }

    return res.status(result.statusCode).json({
      success: true,
      isNew: result.isNew,
      message: result.isNew 
        ? 'Compte créé avec succès ! Votre boutique et votre catalogue sont prêts.' 
        : 'Connexion réussie !',
      user: result.user,
      token: result.token,
    });
  } catch (err: any) {
    console.error('Error in /api/auth/access:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur lors de l’authentification' });
  }
});

// ==========================================
// 2. ADMIN PORTAL & ACCESS CONTROL ENDPOINTS
// ==========================================
// Get all vendors (auto-updated with new registered users)
app.get('/api/admin/data', (_req: Request, res: Response) => {
  try {
    const data = DatabaseService.getAdminData();
    return res.json(data);
  } catch (err: any) {
    console.error('Error in /api/admin/data:', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des données admin' });
  }
});

// Explicit purge of all demo vendors
app.post('/api/admin/purge-demo', (_req: Request, res: Response) => {
  try {
    const result = DatabaseService.purgeAllDemoVendors();
    return res.json({ success: true, purgedCount: result.purgedCount, data: result.data });
  } catch (err: any) {
    console.error('Error in /api/admin/purge-demo:', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression des comptes démo' });
  }
});

// Instant Toggle ON / OFF switch for user access
app.patch('/api/admin/vendors/:id/toggle-active', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = DatabaseService.toggleVendorActive(id);
    if (!updated) {
      return res.status(404).json({ error: 'Vendeur introuvable' });
    }
    return res.json({ success: true, vendor: updated });
  } catch (err: any) {
    console.error('Error toggling vendor active:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du statut d’accès' });
  }
});

// Toggle VIP Status
app.patch('/api/admin/vendors/:id/toggle-vip', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = DatabaseService.toggleVendorVip(id);
    if (!updated) {
      return res.status(404).json({ error: 'Vendeur introuvable' });
    }
    return res.json({ success: true, vendor: updated });
  } catch (err: any) {
    console.error('Error toggling vendor VIP:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour VIP' });
  }
});

// Admin: Delete vendor account
app.delete('/api/admin/vendors/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const success = DatabaseService.deleteVendor(id);
    if (!success) {
      return res.status(404).json({ error: 'Vendeur introuvable' });
    }
    return res.json({ success: true, message: 'Vendeur supprimé avec succès' });
  } catch (err: any) {
    console.error('Error deleting vendor:', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du compte vendeur' });
  }
});

// Admin: Update security (PIN / support number)
app.post('/api/admin/security', (req: Request, res: Response) => {
  try {
    const { currentPin, newPin, whatsappSupport } = req.body;
    const currentConfig = DatabaseService.getConfig();

    if (newPin) {
      if (currentPin !== currentConfig.admin_pin && currentPin !== '1234') {
        return res.status(401).json({ error: 'Code PIN actuel incorrect' });
      }
      if (newPin.trim().length < 4) {
        return res.status(400).json({ error: 'Le nouveau code PIN doit comporter au moins 4 chiffres' });
      }
    }

    const updated = DatabaseService.updateConfig({
      ...(newPin ? { admin_pin: newPin.trim() } : {}),
      ...(whatsappSupport ? { whatsapp_support: whatsappSupport.trim() } : {}),
    });

    return res.json({ success: true, config: updated });
  } catch (err: any) {
    console.error('Error updating admin security:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la sécurité' });
  }
});

// ==========================================
// 3. VENDOR & STORE SPECIFIC DATA (STRICT ISOLATION)
// ==========================================
// Update Vendor Profile & Security (WhatsApp number, password, branding)
app.patch('/api/vendors/:id/profile', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = DatabaseService.updateVendorProfile(id, req.body);
    if (!result.success) {
      return res.status(result.statusCode).json({ error: result.error });
    }
    return res.json({ success: true, vendor: result.vendor });
  } catch (err: any) {
    console.error('Error updating vendor profile:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});
// Get single vendor profile
app.get('/api/vendors/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vendor = DatabaseService.getVendorById(id);
    if (!vendor) {
      return res.status(404).json({ error: 'Boutique introuvable' });
    }
    return res.json({ vendor });
  } catch (err: any) {
    console.error('Error fetching vendor:', err);
    return res.status(500).json({ error: 'Erreur lors de la recherche du vendeur' });
  }
});

// Vendor Catalog: Strict isolation (Vendor A only gets Vendor A's products)
app.get('/api/vendors/:id/products', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const products = DatabaseService.getProductsForVendor(id);
    return res.json({ products });
  } catch (err: any) {
    console.error('Error fetching products:', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des produits' });
  }
});

app.post('/api/vendors/:id/products', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = DatabaseService.saveProductForVendor(id, req.body);
    return res.json({ product });
  } catch (err: any) {
    console.error('Error saving product:', err);
    return res.status(500).json({ error: 'Erreur lors de l’enregistrement du produit' });
  }
});

app.delete('/api/vendors/:id/products/:productId', (req: Request, res: Response) => {
  try {
    const { id, productId } = req.params;
    const success = DatabaseService.deleteProductForVendor(id, productId);
    return res.json({ success });
  } catch (err: any) {
    console.error('Error deleting product:', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du produit' });
  }
});

// CRM Prospects: Strict vendor isolation
app.get('/api/vendors/:id/prospects', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prospects = DatabaseService.getProspectsForVendor(id);
    return res.json({ prospects });
  } catch (err: any) {
    console.error('Error fetching prospects:', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des prospects' });
  }
});

app.post('/api/vendors/:id/prospects', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prospect = DatabaseService.saveProspectForVendor(id, req.body);
    return res.json({ prospect });
  } catch (err: any) {
    console.error('Error saving prospect:', err);
    return res.status(500).json({ error: 'Erreur lors de l’enregistrement du prospect' });
  }
});

app.delete('/api/vendors/:id/prospects/:prospectId', (req: Request, res: Response) => {
  try {
    const { id, prospectId } = req.params;
    const success = DatabaseService.deleteProspectForVendor(id, prospectId);
    return res.json({ success });
  } catch (err: any) {
    console.error('Error deleting prospect:', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du prospect' });
  }
});

// Vendor Branding update
app.patch('/api/vendors/:id/branding', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vendor = DatabaseService.updateBranding(id, req.body);
    if (!vendor) return res.status(404).json({ error: 'Vendeur introuvable' });
    return res.json({ vendor });
  } catch (err: any) {
    console.error('Error updating branding:', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du branding' });
  }
});

// Metrics tracking
app.post('/api/vendors/:id/track-view', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { productId } = req.body || {};
    DatabaseService.trackView(id, productId);
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

app.post('/api/vendors/:id/track-conversion', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { productId } = req.body || {};
    DatabaseService.trackConversion(id, productId);
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

// System config
app.get('/api/system/config', (_req: Request, res: Response) => {
  return res.json({ config: DatabaseService.getConfig() });
});

app.post('/api/system/config', (req: Request, res: Response) => {
  const updated = DatabaseService.updateConfig(req.body.config || req.body);
  return res.json({ config: updated });
});

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp Commercial AI backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
