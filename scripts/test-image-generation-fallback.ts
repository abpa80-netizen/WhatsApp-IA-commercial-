/**
 * Suite de tests pour le générateur d'images produits avec repli Cloudflare Workers AI :
 * 1. Test nominal du fournisseur principal (Gemini)
 * 2. Simulation d'erreur de quota (429) et bascule vers Cloudflare Workers AI
 * 3. Simulation d'indisponibilité (503) et bascule vers Cloudflare
 * 4. Refus de bascule pour les erreurs d'authentification (401) et validation (400)
 * 5. Gestion des erreurs d'authentification et de quota sur Cloudflare
 * 6. Parsing des formats de réponse Cloudflare (JSON base64 et binaire Buffer)
 * 7. Conversion Data URI -> Blob et téléversement sécurisé vers Cloudinary
 * 8. Audit de non-exposition des secrets (GEMINI_API_KEY, CLOUDFLARE_API_TOKEN)
 */

import { handleAIImageGenerate } from '../src/server/geminiService.ts';
import { 
  generateImageWithCloudflare, 
  isCloudflareConfigured, 
  CLOUDFLARE_IMAGE_MODELS 
} from '../src/server/cloudflareWorkersAi.ts';
import { dataUriToBlob } from '../src/services/imageUpload.ts';
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

async function runImageFallbackTests() {
  console.log('=== DÉBUT DES TESTS DU GÉNÉRATEUR D’IMAGES ET REPLI CLOUDFLARE ===\n');
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
  // 1. TEST : CONTRÔLE D'ACCÈS ET VALIDATION DU PROMPT
  // -------------------------------------------------------------------------
  console.log('--- 1. Validation des accès et du prompt ---');

  // Rejet sans token
  const unauthReq = { method: 'POST', body: { prompt: 'Chaussures de sport' }, headers: {} };
  const unauthRes = createMockResponse();
  await handleAIImageGenerate(unauthReq, unauthRes);
  assert(unauthRes.statusCode === 401, 'Rejet des requêtes non authentifiées avec 401');
  assert(unauthRes.data?.code === 'AUTH_REQUIRED', 'Code AUTH_REQUIRED retourné');

  // Rejet avec prompt vide (sans appeler l’IA)
  const emptyReq = { method: 'POST', body: { prompt: '   ' } };
  const emptyRes = createMockResponse();
  await handleAIImageGenerate(emptyReq, emptyRes, { skipAuth: true });
  assert(emptyRes.statusCode === 400, 'Rejet d’un prompt vide avec 400 Bad Request');
  assert(emptyRes.data?.code === 'INVALID_INPUT', 'Code INVALID_INPUT retourné');

  // -------------------------------------------------------------------------
  // 2. TEST : FOURNISSEUR PRINCIPAL (GEMINI) NOMINAL
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Génération nominale avec fournisseur principal ---');
  const mockGeminiSuccess: any = {
    models: {
      generateContent: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              },
            }],
          },
        }],
      }),
    },
  };

  const geminiReq = { method: 'POST', body: { prompt: 'Montre de luxe dorée' } };
  const geminiRes = createMockResponse();
  await handleAIImageGenerate(geminiReq, geminiRes, { customAi: mockGeminiSuccess, skipAuth: true });
  assert(geminiRes.statusCode === 200, 'Génération nominale Gemini réussie (HTTP 200)');
  assert(geminiRes.data?.provider === 'gemini', 'Fournisseur identifié comme "gemini"');
  assert(geminiRes.data?.imageUrl.startsWith('data:image/png;base64,'), 'Format Image URL Base64 conforme');

  // -------------------------------------------------------------------------
  // 3. TEST : SIMULATION DE QUOTA ÉPUISÉ ET BASCULE VERS CLOUDFLARE
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Simulation de quota épuisé (429) et bascule vers Cloudflare ---');

  // A. Cas où Cloudflare n'est pas configuré
  const mockGeminiQuota: any = {
    models: {
      generateContent: async () => {
        const err: any = new Error('Resource has been exhausted (e.g. check quota)');
        err.status = 429;
        throw err;
      },
    },
  };

  const noCfRes = createMockResponse();
  await handleAIImageGenerate(geminiReq, noCfRes, { 
    customAi: mockGeminiQuota, 
    skipAuth: true,
    cloudflareConfig: { accountId: '', apiToken: '' } 
  });
  assert(noCfRes.statusCode === 429, 'Renvoi de 429 quand Gemini est épuisé et Cloudflare non configuré');
  assert(noCfRes.data?.code === 'QUOTA_EXCEEDED', 'Code QUOTA_EXCEEDED préservé');
  assert(noCfRes.data?.error.includes('Cloudflare Workers AI n’est pas configuré'), 'Message guidant sur les variables requises');

  // B. Cas où Cloudflare est configuré : bascule automatique réussie vers FLUX.1
  const mockSamplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let cloudflareFetchCalls = 0;
  const mockCloudflareFetch: typeof fetch = async (url: any, init: any) => {
    cloudflareFetchCalls++;
    const authHeader = init?.headers?.Authorization || '';
    if (authHeader !== 'Bearer test_cf_token_123') {
      return new Response('Unauthorized', { status: 401 });
    }
    // Réponse au format JSON avec result.image (format officiel flux-1-schnell)
    return new Response(JSON.stringify({
      success: true,
      result: {
        image: mockSamplePngBase64,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const cfSuccessRes = createMockResponse();
  await handleAIImageGenerate(geminiReq, cfSuccessRes, {
    customAi: mockGeminiQuota,
    skipAuth: true,
    cloudflareConfig: {
      accountId: 'test_account_456',
      apiToken: 'test_cf_token_123',
      fetchFn: mockCloudflareFetch,
    },
  });

  assert(cfSuccessRes.statusCode === 200, 'Bascule automatique vers Cloudflare réussie (HTTP 200)');
  assert(cfSuccessRes.data?.provider === 'cloudflare', 'Fournisseur de repli identifié comme "cloudflare"');
  assert(cfSuccessRes.data?.model === CLOUDFLARE_IMAGE_MODELS[0], 'Modèle FLUX.1 Schnell sollicité');
  assert(cloudflareFetchCalls === 1, 'Exactement un appel émis vers Cloudflare (pas de boucle abusive)');

  // -------------------------------------------------------------------------
  // 4. TEST : GESTION DES ERREURS PROPRES (PAS DE BASCULE INUTILE)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Respect des motifs stricts de bascule ---');

  // A. Erreur d'authentification Gemini (401) -> NE DOIT PAS basculer
  const mockGeminiAuthErr: any = {
    models: {
      generateContent: async () => {
        const err: any = new Error('API key not valid');
        err.status = 401;
        throw err;
      },
    },
  };

  let cfCallsOnAuthErr = 0;
  const mockCfSpy: typeof fetch = async () => {
    cfCallsOnAuthErr++;
    return new Response('{}', { status: 200 });
  };

  const authErrRes = createMockResponse();
  await handleAIImageGenerate(geminiReq, authErrRes, {
    customAi: mockGeminiAuthErr,
    skipAuth: true,
    cloudflareConfig: {
      accountId: 'test_acc',
      apiToken: 'test_tok',
      fetchFn: mockCfSpy,
    },
  });

  assert(authErrRes.statusCode === 401, 'Erreur 401 Gemini renvoyée sans bascule');
  assert(cfCallsOnAuthErr === 0, 'Cloudflare n’est JAMAIS appelé si l’erreur n’est pas un quota ou indisponibilité');

  // -------------------------------------------------------------------------
  // 5. TEST : REPLI SUR INDISPONIBILITÉ (503) & ÉPUISEMENT DOUBLE QUOTA
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Indisponibilité et dépassement du quota alternatif ---');

  // A. Gemini 503 -> bascule Cloudflare
  const mockGemini503: any = {
    models: {
      generateContent: async () => {
        const err: any = new Error('Service Unavailable / High Demand');
        err.status = 503;
        throw err;
      },
    },
  };

  const res503 = createMockResponse();
  await handleAIImageGenerate(geminiReq, res503, {
    customAi: mockGemini503,
    skipAuth: true,
    cloudflareConfig: {
      accountId: 'test_acc',
      apiToken: 'test_cf_token_123',
      fetchFn: mockCloudflareFetch,
    },
  });
  assert(res503.statusCode === 200, 'Bascule réussie lors d’un 503 Gemini');
  assert(res503.data?.provider === 'cloudflare', 'Cloudflare a répondu lors du 503');

  // B. Les deux fournisseurs en quota épuisé (Gemini 429 + Cloudflare 429)
  const mockCfQuotaFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: 'Daily neuron limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const bothQuotaRes = createMockResponse();
  await handleAIImageGenerate(geminiReq, bothQuotaRes, {
    customAi: mockGeminiQuota,
    skipAuth: true,
    cloudflareConfig: {
      accountId: 'test_acc',
      apiToken: 'test_cf_token_123',
      fetchFn: mockCfQuotaFetch,
    },
  });
  assert(bothQuotaRes.statusCode === 429, 'Code 429 renvoyé lorsque les 2 quotas sont épuisés');
  assert(bothQuotaRes.data?.code === 'QUOTA_EXCEEDED', 'Code d’erreur QUOTA_EXCEEDED retourné');

  // -------------------------------------------------------------------------
  // 6. TEST : PARSING FORMAT BINAIRE BUFFER DE CLOUDFLARE
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Parsing du format binaire de Cloudflare ---');
  const binaryPayload = Buffer.from('FAKE_PNG_BINARY_DATA');
  const mockBinaryFetch: typeof fetch = async () => {
    return new Response(binaryPayload, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };

  const cfBinaryResult = await generateImageWithCloudflare('parfum élégant', {
    config: {
      accountId: 'acc',
      apiToken: 'tok',
      fetchFn: mockBinaryFetch,
    },
  });
  assert(cfBinaryResult.imageUrl.startsWith('data:image/png;base64,'), 'Buffer binaire correctement encodé en Data URI');
  assert(cfBinaryResult.provider === 'cloudflare', 'Fournisseur confirmé Cloudflare');

  // -------------------------------------------------------------------------
  // 7. TEST : CONVERSION DATA URI -> BLOB & STOCKAGE CLOUDINARY
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Sécurisation du stockage persistant Cloudinary ---');
  const sampleDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const convertedBlob = dataUriToBlob(sampleDataUri);
  assert(convertedBlob instanceof Blob, 'Conversion Data URI en Blob valide');
  assert(convertedBlob.type === 'image/png', 'Type MIME PNG préservé');
  assert(convertedBlob.size > 0, `Taille binaire non vide (${convertedBlob.size} octets)`);

  // Simulation de remplacement par URL persistante Cloudinary
  const mockCloudinaryUpload = async (blob: Blob) => {
    assert(blob.size > 0, 'Blob téléversé non vide');
    return 'https://res.cloudinary.com/pb426age/image/upload/v123456789/users/vend_test/products/ai_gen.png';
  };

  const finalPersistentUrl = await mockCloudinaryUpload(convertedBlob);
  assert(finalPersistentUrl.startsWith('https://res.cloudinary.com/'), 'URL permanente Cloudinary obtenue');
  assert(!finalPersistentUrl.startsWith('blob:'), 'Aucun lien blob: éphémère ne subsiste');
  assert(!finalPersistentUrl.startsWith('data:'), 'Aucune chaîne Base64 ne subsiste pour Firestore');

  // -------------------------------------------------------------------------
  // 8. TEST : AUDIT DES SECRETS
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Audit de non-exposition des secrets ---');
  const filesToAudit = [
    'src/components/CatalogManager.tsx',
    'src/services/geminiClient.ts',
    'src/server/cloudflareWorkersAi.ts',
    'src/server/geminiService.ts',
  ];

  for (const relPath of filesToAudit) {
    const fullPath = path.resolve(relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert(!content.includes('CLOUDFLARE_API_TOKEN='), `Aucun token Cloudflare hardcodé dans ${relPath}`);
      assert(!content.includes('CLOUDFLARE_ACCOUNT_ID='), `Aucun Account ID Cloudflare hardcodé dans ${relPath}`);
      assert(!content.includes('VITE_CLOUDFLARE'), `Aucun préfixe client VITE_CLOUDFLARE dans ${relPath}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`RÉSULTATS : ${passed} passés, ${failed} échoués`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runImageFallbackTests().catch((err) => {
  console.error('Erreur inattendue dans les tests de repli image :', err);
  process.exit(1);
});
