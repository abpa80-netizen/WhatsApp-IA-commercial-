import { auth } from '../firebase';
import { generateProductDescription as generateLocalDescription } from './aiGenerator';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface VendorContext {
  name: string;
  currency: string;
  location: string;
  productsCount: number;
  topProducts?: string;
  prospectsCount?: number;
}

export const GeminiClient = {
  /**
   * Generates a high-converting product description using Gemini on the server.
   * Fallback to local rule-based generator if server is unreachable.
   */
  async generateDescription(params: {
    name: string;
    price?: number | string;
    currency?: string;
    category?: string;
    location?: string;
    language?: 'fr' | 'darija';
  }): Promise<string> {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/ai/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Erreur serveur (${res.status})`);
      }

      const data = await res.json();
      if (data.description) {
        return data.description;
      }
      throw new Error('Réponse vide du serveur');
    } catch (err: any) {
      if (/essai gratuit est terminé|accès premium verrouillé|outils IA sont verrouillés/i.test(String(err?.message || ''))) {
        throw err;
      }
      console.warn('API description failed, using local generator fallback:', err.message);
      // Seamless fallback
      return generateLocalDescription(
        params.name,
        params.category || 'Général',
        `${params.location || 'Boutique certifiée'} - ${params.price ? params.price + ' ' + (params.currency || 'MAD') : 'Meilleur prix garanti'}`
      );
    }
  },

  /**
   * Sends a message to the Gemini Sales Coach chatbot with conversation history.
   */
  async sendChat(params: {
    message: string;
    history: { role: 'user' | 'model'; text: string }[];
    vendorContext?: VendorContext;
  }): Promise<string> {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Erreur (${res.status})`);
      }

      const data = await res.json();
      return data.reply || 'Je suis à votre disposition pour booster vos ventes !';
    } catch (err: any) {
      console.error('Chat error:', err);
      throw err;
    }
  },

  /**
   * Generates an advertising/promo image from a text prompt.
   */
  async generateImage(prompt: string, aspectRatio: string = '1:1'): Promise<string> {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/ai/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ prompt, aspectRatio }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Erreur lors de la génération d’image');
    }

    if (!data.imageUrl) {
      throw new Error('Aucune image n’a été reçue');
    }

    return data.imageUrl;
  },

  /**
   * Enhances an existing product photo (studio lighting, clean background, high resolution).
   */
  async enhanceImage(imageBase64: string, action: 'enhance' | 'studio' | 'clean_bg' = 'enhance'): Promise<string> {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/ai/image/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ imageBase64, action }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Erreur lors de l’amélioration de la photo');
    }

    if (!data.imageUrl) {
      throw new Error('Aucune image améliorée n’a été reçue');
    }

    return data.imageUrl;
  },
};
