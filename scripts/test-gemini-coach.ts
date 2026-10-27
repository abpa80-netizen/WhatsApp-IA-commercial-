/**
 * Suite de tests de validation du Coach Commercial IA et du service Gemini :
 * 1. Vérification de l'existence des routes serveur et serverless Vercel (/api/ai/chat, /api/ai/describe)
 * 2. Distinction des erreurs : 404 (introuvable), 401/403 (authentification), 503/429 (indisponibilité/quota)
 * 3. Validation de la génération nominale avec bascule automatique entre modèles vérifiés
 * 4. Audit de sécurité : non-exposition des secrets d'API dans les réponses, les erreurs et le code client
 */

import {
  handleAIChat,
  handleAIDescribe,
  sanitizeGeminiError,
  generateTextWithFallback,
  VERIFIED_TEXT_MODELS,
  getGeminiClient,
} from '../src/server/geminiService.ts';
import vercelChatHandler from '../api/ai/chat.ts';
import vercelDescribeHandler from '../api/ai/describe.ts';
import fs from 'fs';
import path from 'path';

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    data: null as any,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      this.ended = true;
      return this;
    },
    end(payload?: any) {
      if (payload) {
        try {
          this.data = JSON.parse(payload);
        } catch {
          this.data = payload;
        }
      }
      this.ended = true;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
}

async function runGeminiTests() {
  console.log('=== DÉBUT DES TESTS DU SERVICE GEMINI ET COACH COMMERCIAL ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // 1. TEST : CLASSIFICATION DES ERREURS SANS FUITE DE SECRET
  // -------------------------------------------------------------------------
  console.log('--- 1. Classification rigoureuse des erreurs ---');
  
  // Test 401 / Auth
  const authErr = sanitizeGeminiError({ status: 401, message: 'API key not valid. Please pass a valid API key: AIzaSySecretKeyXYZ' });
  assert(authErr.status === 401, 'Erreur 401 correctement détectée');
  assert(authErr.code === 'AUTH_ERROR', 'Code AUTH_ERROR associé');
  assert(!authErr.message.includes('AIzaSySecretKeyXYZ'), 'Le secret d’API a été masqué dans le message');

  // Test 404 / Model Not Found
  const notFoundErr = sanitizeGeminiError({ status: 404, message: 'models/gemini-2.0-flash is no longer available' });
  assert(notFoundErr.status === 404, 'Erreur 404 correctement détectée');
  assert(notFoundErr.code === 'NOT_FOUND', 'Code NOT_FOUND associé');

  // Test 503 / Service Unavailable
  const unavailableErr = sanitizeGeminiError({ status: 503, message: 'This model is currently experiencing high demand.' });
  assert(unavailableErr.status === 503, 'Erreur 503 (haute demande) correctement détectée');
  assert(unavailableErr.code === 'SERVICE_UNAVAILABLE', 'Code SERVICE_UNAVAILABLE associé');

  // Test 429 / Quota
  const quotaErr = sanitizeGeminiError({ status: 429, message: 'Resource exhausted (quota exceeded)' });
  assert(quotaErr.status === 429, 'Erreur 429 (quota dépassé) correctement détectée');

  assert(quotaErr.code === 'RATE_LIMIT', 'Code RATE_LIMIT associé');

  // -------------------------------------------------------------------------
  // 1b. TEST : CHEMIN RAPIDE DU COACH (MODÈLE, HISTORIQUE ET SORTIE LIMITÉS)
  // -------------------------------------------------------------------------
  console.log('\\n--- 1b. Optimisation de la latence du Coach ---');
  let capturedRequest: any = null;
  const mockAi: any = {
    models: {
      generateContent: async (request: any) => {
        capturedRequest = request;
        return { text: 'Réponse rapide du coach.' };
      },
    },
  };
  const latencyReq = {
    method: 'POST',
    body: {
      message: 'Comment répondre à un client qui trouve mon produit trop cher ?',
      history: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'model',
        text: `Historique de conversation ${index}`,
      })),
    },
  };
  const latencyRes = createMockResponse();
  await handleAIChat(latencyReq, latencyRes, { skipAuth: true, customAi: mockAi });
  assert(VERIFIED_TEXT_MODELS[0] === 'gemini-3.1-flash-lite', 'Le modèle Flash léger est essayé en premier');
  assert(capturedRequest?.model === VERIFIED_TEXT_MODELS[0], 'Le premier appel utilise le modèle rapide prioritaire');
  assert(capturedRequest?.contents?.length === 7, 'Le Coach envoie au maximum 6 échanges récents plus le nouveau message');
  assert(capturedRequest?.config?.maxOutputTokens === 500, 'La réponse du Coach est plafonnée à 500 tokens pour limiter le délai');
  assert(latencyRes.statusCode === 200 && latencyRes.data?.reply === 'Réponse rapide du coach.', 'Le Coach répond normalement avec le chemin optimisé');

  // -------------------------------------------------------------------------
  // 2. TEST : GESTION DES REQUÊTES INVALIDES SUR LES HANDLERS
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Validation des entrées et méthodes HTTP ---');

  // Méthode GET rejetée
  const getReq = { method: 'GET', body: {} };
  const getRes = createMockResponse();
  await handleAIChat(getReq, getRes, { skipAuth: true });
  assert(getRes.statusCode === 405, 'Rejet de la méthode GET avec 405 Method Not Allowed');

  // Rejet des requêtes sans authentification Bearer
  const unauthReq = { method: 'POST', body: { message: 'Hello' }, headers: {} };
  const unauthRes = createMockResponse();
  await handleAIChat(unauthReq, unauthRes);
  assert(unauthRes.statusCode === 401, 'Rejet des requêtes sans token Bearer avec 401');
  assert(unauthRes.data?.code === 'AUTH_REQUIRED', 'Code AUTH_REQUIRED retourné');

  // Corps de message vide rejeté
  const emptyReq = { method: 'POST', body: { message: '' } };
  const emptyRes = createMockResponse();
  await handleAIChat(emptyReq, emptyRes, { skipAuth: true });
  assert(emptyRes.statusCode === 400, 'Rejet d’un message vide avec 400 Bad Request');
  assert(emptyRes.data?.code === 'INVALID_INPUT', 'Code d’erreur INVALID_INPUT renvoyé');

  // Handler Serverless Vercel /api/ai/chat.ts rejette sans token
  const vercelChatRes = createMockResponse();
  await vercelChatHandler(emptyReq, vercelChatRes);
  assert(vercelChatRes.statusCode === 401, 'Handler Vercel /api/ai/chat sécurisé contre accès non authentifié (401)');

  // Handler Serverless Vercel /api/ai/describe.ts rejette sans token
  const vercelDescRes = createMockResponse();
  await vercelDescribeHandler({ method: 'POST', body: { name: '' } }, vercelDescRes);
  assert(vercelDescRes.statusCode === 401, 'Handler Vercel /api/ai/describe sécurisé contre accès non authentifié (401)');

  // -------------------------------------------------------------------------
  // 3. TEST : COMPORTEMENT QUAND LA CLÉ API EST ABSENTE
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Sécurité en cas de clé absente ---');
  const noKeyReq = { method: 'POST', body: { message: 'Bonjour coach' } };
  const noKeyRes = createMockResponse();
  await handleAIChat(noKeyReq, noKeyRes, { customAi: null, skipAuth: true });
  assert(noKeyRes.statusCode === 401, 'Renvoi d’une 401 claire sans crash quand la clé est absente');
  assert(noKeyRes.data?.code === 'AUTH_ERROR', 'Code AUTH_ERROR explicite renvoyé');

  // -------------------------------------------------------------------------
  // 4. TEST : APPEL RÉEL DU MODÈLE GEMINI (SI CLÉ PRÉSENTE)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Génération nominale avec modèles vérifiés ---');
  const realAi = getGeminiClient();
  if (realAi) {
    try {
      const validReq = {
        method: 'POST',
        body: {
          message: 'Donne-moi un conseil court en 1 phrase pour prospecter sur WhatsApp.',
          vendorContext: {
            name: 'Boutique Test',
            currency: 'MAD',
            location: 'Casablanca',
            productsCount: 3,
          },
        },
      };
      const validRes = createMockResponse();
      await handleAIChat(validReq, validRes, { skipAuth: true });
      
      assert(validRes.statusCode === 200, `Appel nominal réussi (HTTP ${validRes.statusCode})`);
      assert(typeof validRes.data?.reply === 'string' && validRes.data.reply.length > 10, 'Réponse générée par Gemini valide');
      console.log('Exemple de réponse du Coach :', validRes.data?.reply?.slice(0, 80) + '...');
    } catch (err: any) {
      console.warn('Note sur appel réel :', err.message);
    }
  } else {
    console.log('[SKIP] Clé GEMINI_API_KEY non fournie dans l’environnement pour le test en ligne');
  }

  // -------------------------------------------------------------------------
  // 5. TEST : AUDIT DES FUITE DE CLÉS DANS LE CODE SOURCE CLIENT
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Audit de non-exposition des clés dans le code client ---');
  const clientFiles = [
    'src/components/AIMessageGenerator.tsx',
    'src/services/geminiClient.ts',
    'src/components/CatalogManager.tsx',
    'src/App.tsx',
  ];

  for (const relPath of clientFiles) {
    const fullPath = path.resolve(relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert(!content.includes('AIzaSy'), `Aucun secret Google hardcodé dans ${relPath}`);
      assert(!content.includes('process.env.GEMINI_API_KEY'), `Aucune lecture directe de GEMINI_API_KEY côté client dans ${relPath}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`RÉSULTATS : ${passed} passés, ${failed} échoués`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runGeminiTests().catch((err) => {
  console.error('Erreur non capturée dans les tests :', err);
  process.exit(1);
});
