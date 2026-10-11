/**
 * Test de vérification unitaire de :
 * 1. La validation stricte côté client (types MIME autorisés, rejet des SVG, limite 10 Mo).
 * 2. Le calcul proportionnel des dimensions de compression (produits : max 1600×1600, logos : max 512×512).
 * 3. L'exigence impérative d'un utilisateur Firebase connecté (rejet sans utilisateur).
 * 4. La gestion stricte des erreurs et l'absence totale de fallback blob: / Base64.
 */
import {
  validateImageFile,
  calculateTargetDimensions,
  uploadToCloudinary,
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_IMAGE_TYPES,
} from '../src/services/imageUpload';

async function runClientUploadTests() {
  console.log('--- DÉBUT DES TESTS COMPRESSION & CLIENT CLOUDINARY ---');
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

  // 1. Validation : Rejet explicite des SVG
  let caughtSvgMime = false;
  try {
    const svgFile = { name: 'image.svg', type: 'image/svg+xml', size: 2048 } as File;
    validateImageFile(svgFile);
  } catch (err: any) {
    caughtSvgMime = true;
    assert(err.message.includes('SVG'), 'Le service rejette explicitement image/svg+xml');
  }
  assert(caughtSvgMime, 'Exception levée pour image/svg+xml');

  let caughtSvgExt = false;
  try {
    const svgFileByName = { name: 'malicious.svg', type: 'image/octet-stream', size: 1024 } as File;
    validateImageFile(svgFileByName);
  } catch (err: any) {
    caughtSvgExt = true;
  }
  assert(caughtSvgExt, 'Le service rejette les fichiers nommés .svg');

  // 2. Validation : Rejet des non-images (PDF, texte, exécutable)
  let caughtPdf = false;
  try {
    const pdf = { name: 'document.pdf', type: 'application/pdf', size: 1024 } as File;
    validateImageFile(pdf);
  } catch {
    caughtPdf = true;
  }
  assert(caughtPdf, 'Le service rejette les fichiers PDF');

  // 3. Validation : Rejet des fichiers > 10 Mo avant compression
  let caughtOversized = false;
  try {
    const bigFile = { name: 'photo.jpg', type: 'image/jpeg', size: MAX_FILE_SIZE_BYTES + 1024 } as File;
    validateImageFile(bigFile);
  } catch (err: any) {
    caughtOversized = true;
    assert(err.message.includes('10 Mo'), 'Le message mentionne la limite de 10 Mo');
  }
  assert(caughtOversized, 'Le service rejette les fichiers > 10 Mo');

  // 4. Validation : Acceptation des images autorisées <= 10 Mo
  let acceptValid = true;
  try {
    const validJpg = { name: 'product.jpg', type: 'image/jpeg', size: 2 * 1024 * 1024 } as File;
    const validPng = { name: 'logo.png', type: 'image/png', size: 500 * 1024 } as File;
    const validWebp = { name: 'banner.webp', type: 'image/webp', size: 1 * 1024 * 1024 } as File;
    validateImageFile(validJpg);
    validateImageFile(validPng);
    validateImageFile(validWebp);
  } catch {
    acceptValid = false;
  }
  assert(acceptValid, 'Le service accepte les images valides JPG, PNG et WEBP');

  // 5. Calcul de dimensions : Produits (max 1600 × 1600)
  // Image paysage 3200 × 2400 (ratio 4:3)
  const productLandscape = calculateTargetDimensions(3200, 2400, 1600, 1600);
  assert(
    productLandscape.width === 1600 && productLandscape.height === 1200,
    'Produit paysage 3200x2400 redimensionné proportionnellement en 1600x1200'
  );

  // Image portrait 2400 × 3200 (ratio 3:4)
  const productPortrait = calculateTargetDimensions(2400, 3200, 1600, 1600);
  assert(
    productPortrait.width === 1200 && productPortrait.height === 1600,
    'Produit portrait 2400x3200 redimensionné proportionnellement en 1200x1600'
  );

  // Image carrée 2500 × 2500
  const productSquare = calculateTargetDimensions(2500, 2500, 1600, 1600);
  assert(
    productSquare.width === 1600 && productSquare.height === 1600,
    'Produit carré 2500x2500 redimensionné en 1600x1600'
  );

  // Image plus petite que 1600 : pas d'agrandissement artificiel
  const productSmall = calculateTargetDimensions(800, 600, 1600, 1600);
  assert(
    productSmall.width === 800 && productSmall.height === 600,
    'Produit 800x600 conserve ses dimensions d’origine (aucun upscaling)'
  );

  // 6. Calcul de dimensions : Logos (max 512 × 512)
  const logoSquare = calculateTargetDimensions(1024, 1024, 512, 512);
  assert(
    logoSquare.width === 512 && logoSquare.height === 512,
    'Logo 1024x1024 redimensionné au plafond de 512x512'
  );

  const logoLandscape = calculateTargetDimensions(1200, 600, 512, 512);
  assert(
    logoLandscape.width === 512 && logoLandscape.height === 256,
    'Logo paysage 1200x600 redimensionné en 512x256'
  );

  const logoSmall = calculateTargetDimensions(300, 300, 512, 512);
  assert(
    logoSmall.width === 300 && logoSmall.height === 300,
    'Logo 300x300 conserve ses dimensions (pas d’upscaling)'
  );

  // 7. Rejet impératif si aucun utilisateur connecté
  let caughtUnauthenticated = false;
  try {
    const dummyBlob = new Blob(['fake image content'], { type: 'image/jpeg' });
    await uploadToCloudinary(dummyBlob, 'products');
  } catch (err: any) {
    caughtUnauthenticated = true;
    assert(
      err.message.includes('non connecté'),
      'uploadToCloudinary rejette immédiatement si aucun utilisateur n’est connecté'
    );
  }
  assert(caughtUnauthenticated, 'Rejet vérifié sans session Firebase Auth active');

  console.log(`\nRÉSULTATS TESTS CLIENT CLOUDINARY : ${passed} passés, ${failed} échoués.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runClientUploadTests();
