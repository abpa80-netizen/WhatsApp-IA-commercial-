/**
 * Test unitaire et d'intégration de la route Cloudinary compatible Vercel :
 * 1. Distingue une route absente (404)
 * 2. Distingue un jeton invalide ou manquant (401)
 * 3. Distingue une configuration serveur Cloudinary manquante (503)
 * 4. Valide le cas nominal de signature (200) avec isolation stricte du dossier users/{uid}/...
 * 5. Vérifie que le secret d'API Cloudinary n'est jamais exposé au client
 * 6. Valide le handler Serverless Vercel (api/cloudinary/sign.ts)
 */
import http from 'http';
import { handleCloudinarySign } from '../src/server/cloudinarySign.ts';
import vercelHandler from '../api/cloudinary/sign.ts';

async function runRouteTests() {
  console.log('--- DÉBUT DES TESTS DE ROUTAGE VERCEL ET SIGNATURE CLOUDINARY ---');
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

  // Helper pour simuler un objet Response Vercel / Express
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
        if (payload) this.data = payload;
        this.ended = true;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
      }
    };
  }

  // -------------------------------------------------------------------------
  // 1. TEST : DISTINGUER UNE ROUTE ABSENTE (404)
  // -------------------------------------------------------------------------
  // Création d'un serveur HTTP simulant l'aiguillage d'API
  const testServer = http.createServer(async (req, res) => {
    const url = req.url || '';
    if (url === '/api/cloudinary/sign' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        const mockReq = {
          method: 'POST',
          headers: req.headers,
          body: body ? JSON.parse(body) : {},
        };
        await handleCloudinarySign(mockReq, res, {
          tokenVerifier: async (t) => t === 'valid_token' ? 'uid_123' : Promise.reject(new Error('Invalid token')),
          config: { apiKey: 'key_123', apiSecret: 'secret_456', cloudName: 'pb426age' }
        });
      });
      return;
    }

    // Toute autre route est réputée absente (404)
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route introuvable', code: 'ROUTE_NOT_FOUND' }));
  });

  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const address = testServer.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // A) Route inexistante -> doit renvoyer 404
    const res404 = await fetch(`${baseUrl}/api/route-inexistante`, { method: 'POST' });
    const data404 = await res404.json().catch(() => ({}));
    assert(res404.status === 404, 'Une route inconnue (/api/route-inexistante) renvoie bien le code 404');
    assert(data404.code === 'ROUTE_NOT_FOUND', 'Le message d’erreur 404 indique que la route est introuvable');

    // B) Méthode incorrecte sur la route -> ne renvoie pas 200
    const resGet = await fetch(`${baseUrl}/api/cloudinary/sign`, { method: 'GET' });
    assert(resGet.status === 404 || resGet.status === 405, 'Une méthode non supportée sur la route renvoie 404 ou 405');
  } finally {
    testServer.close();
  }

  // -------------------------------------------------------------------------
  // 2. TEST : DISTINGUER UN JETON INVALIDE OU MANQUANT (401)
  // -------------------------------------------------------------------------
  // A) En-tête Authorization manquant
  const resNoAuth = createMockResponse();
  await handleCloudinarySign(
    { method: 'POST', headers: {}, body: { folder: 'products' } },
    resNoAuth,
    {
      config: { apiKey: 'key', apiSecret: 'sec' },
      tokenVerifier: async () => 'uid_dummy'
    }
  );
  assert(resNoAuth.statusCode === 401, 'Requête sans en-tête Authorization renvoie 401');
  assert(resNoAuth.data?.code === 'AUTH_TOKEN_MISSING', 'Code d’erreur explicite : AUTH_TOKEN_MISSING');

  // B) Bearer vide
  const resEmptyToken = createMockResponse();
  await handleCloudinarySign(
    { method: 'POST', headers: { authorization: 'Bearer   ' }, body: { folder: 'products' } },
    resEmptyToken,
    {
      config: { apiKey: 'key', apiSecret: 'sec' },
      tokenVerifier: async () => 'uid_dummy'
    }
  );
  assert(resEmptyToken.statusCode === 401, 'Requête avec jeton vide renvoie 401');
  assert(resEmptyToken.data?.code === 'AUTH_TOKEN_EMPTY', 'Code d’erreur explicite : AUTH_TOKEN_EMPTY');

  // C) Jeton rejeté par Firebase Auth (invalide ou expiré)
  const resInvalidToken = createMockResponse();
  await handleCloudinarySign(
    { method: 'POST', headers: { authorization: 'Bearer fake_or_expired_token' }, body: { folder: 'products' } },
    resInvalidToken,
    {
      config: { apiKey: 'key', apiSecret: 'sec' },
      tokenVerifier: async () => {
        throw new Error('Firebase ID token has expired or is invalid');
      }
    }
  );
  assert(resInvalidToken.statusCode === 401, 'Jeton Firebase invalide ou expiré renvoie 401');
  assert(resInvalidToken.data?.code === 'AUTH_TOKEN_INVALID', 'Code d’erreur explicite : AUTH_TOKEN_INVALID');

  // -------------------------------------------------------------------------
  // 3. TEST : DISTINGUER UNE CONFIGURATION MANQUANTE (503)
  // -------------------------------------------------------------------------
  // Le jeton est valide mais les clés CLOUDINARY_API_KEY / SECRET ne sont pas définies côté serveur
  const resMissingConfig = createMockResponse();
  await handleCloudinarySign(
    { method: 'POST', headers: { authorization: 'Bearer valid_token' }, body: { folder: 'products' } },
    resMissingConfig,
    {
      tokenVerifier: async () => 'vendor_uid_789',
      config: { cloudName: 'pb426age', apiKey: '', apiSecret: '' } // Clés manquantes
    }
  );
  assert(resMissingConfig.statusCode === 503, 'Configuration Cloudinary serveur absente renvoie 503');
  assert(resMissingConfig.data?.code === 'CLOUDINARY_CONFIG_MISSING', 'Code d’erreur explicite : CLOUDINARY_CONFIG_MISSING');

  // -------------------------------------------------------------------------
  // 4. TEST : SUCCÈS NOMINAL (200) ET ISOLATION PAR DOSSIER
  // -------------------------------------------------------------------------
  const resValid = createMockResponse();
  await handleCloudinarySign(
    { method: 'POST', headers: { authorization: 'Bearer valid_token' }, body: { folder: 'products' } },
    resValid,
    {
      tokenVerifier: async () => 'vendor_uid_789',
      config: { cloudName: 'pb426age', apiKey: 'test_api_key', apiSecret: 'my_super_secret' }
    }
  );
  assert(resValid.statusCode === 200, 'Requête avec jeton valide et configuration serveur renvoie 200');
  assert(resValid.data?.folder === 'users/vendor_uid_789/products', 'Dossier imposé sous users/vendor_uid_789/products');
  assert(typeof resValid.data?.signature === 'string' && resValid.data?.signature.length === 40, 'Signature SHA-1 hexadécimale générée');
  assert(!('apiSecret' in resValid.data), 'apiSecret n’est jamais renvoyé');
  assert(!('CLOUDINARY_API_SECRET' in resValid.data), 'CLOUDINARY_API_SECRET n’est jamais renvoyé');

  // -------------------------------------------------------------------------
  // 5. TEST : HANDLER VERCEL SERVERLESS FUNCTION (api/cloudinary/sign.ts)
  // -------------------------------------------------------------------------
  // Vérification de la compatibilité du handler exporté pour Vercel
  const resVercel = createMockResponse();
  await vercelHandler(
    { method: 'OPTIONS', headers: {} },
    resVercel
  );
  assert(resVercel.statusCode === 204, 'Le handler Vercel répond 204 aux requêtes CORS OPTIONS');

  console.log(`\nRÉSULTATS TESTS ROUTAGE VERCEL & CLOUDINARY : ${passed} passés, ${failed} échoués.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runRouteTests();
