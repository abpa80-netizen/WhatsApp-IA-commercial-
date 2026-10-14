/**
 * Firebase Admin SDK Initialization Module
 * 
 * Provides trusted server-side access to Firestore without client SDK hacks
 * or security rule circumvention.
 * 
 * Credentials must be provided via private server-side environment variables:
 * - FIREBASE_SERVICE_ACCOUNT_KEY (JSON string of Google Service Account key)
 *   OR
 * - FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (+ optional FIREBASE_PROJECT_ID)
 * 
 * NEVER expose service account keys to the client, the git repository, or public files.
 */

import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let adminDbInstance: Firestore | null = null;
let initAttempted = false;
let initError: string | null = null;

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.projectId) return cfg.projectId;
    }
  } catch {
    // ignore
  }
  return 'gen-lang-client-0250853217';
}

function getFirestoreDatabaseId(): string {
  if (process.env.FIREBASE_DATABASE_ID) {
    return process.env.FIREBASE_DATABASE_ID;
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.firestoreDatabaseId) return cfg.firestoreDatabaseId;
    }
  } catch {
    // ignore
  }
  return 'ai-studio-whatsappcommerci-1b7e18c2-9951-431d-9625-32bdcef0db27';
}

export function isFirebaseAdminConfigured(): boolean {
  if (getApps().length > 0) return true;
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export function getAdminDb(): Firestore {
  if (adminDbInstance) {
    return adminDbInstance;
  }

  if (initAttempted && initError) {
    throw new Error(initError ?? undefined);
  }

  initAttempted = true;

  try {
    if (!getApps().length) {
      const projectId = getFirebaseProjectId();

      // 1. Full JSON string in FIREBASE_SERVICE_ACCOUNT_KEY
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        try {
          const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
          initializeApp({
            credential: cert(creds),
            projectId: creds.project_id || projectId,
          });
        } catch (parseErr: any) {
          throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY JSON invalide: ${parseErr.message}`);
        }
      }
      // 2. Separate client email + private key
      else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
          projectId,
        });
      }
      // 3. Google Application Default Credentials (e.g. Cloud Run / GCP runtime)
      else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({
          credential: applicationDefault(),
          projectId,
        });
      } else {
        initError = 'Configuration Firebase Admin manquante : la variable d’environnement privée FIREBASE_SERVICE_ACCOUNT_KEY (ou FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) n’est pas définie sur le serveur.';
        throw new Error(initError ?? undefined);
      }
    }

    const app = getApp();
    const databaseId = getFirestoreDatabaseId();
    // Initialize Firestore for custom database ID
    adminDbInstance = getFirestore(app, databaseId);
    return adminDbInstance;
  } catch (err: any) {
    initError = err?.message || 'Échec d’initialisation de Firebase Admin SDK.';
    throw new Error(initError ?? undefined);
  }
}
