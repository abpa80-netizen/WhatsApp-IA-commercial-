import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDocFromServer,
  collection,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  deleteDoc,
  limit
} from 'firebase/firestore';
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom database ID (CRITICAL: Required for AI Studio multi-database)
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Firebase Cloud Storage
export const storage = getStorage(app);

// Google Auth Provider (Auxiliary identity mechanism)
export const googleProvider = new GoogleAuthProvider();

// Standard phone-to-email mapper for WhatsApp + Password Firebase Auth
// Enforces standard secure hashing & verification through Firebase Auth with ZERO passwords in Firestore!
export function phoneToAuthEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@wa.wca.app`;
}

// ----------------------------------------------------
// Standard Firestore Error Handling (AI Studio Skill)
// ----------------------------------------------------
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ----------------------------------------------------
// Validate connection to Firestore on startup
// ----------------------------------------------------
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'settings', 'global'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or connection issue. Verify Firebase configuration.');
    }
    return false;
  }
}

// Test connection in background
if (typeof window !== 'undefined') {
  testFirestoreConnection().catch(() => {});
}

// ----------------------------------------------------
// Firebase Storage Helper: Direct cloud uploads scoped by vendor UID
// ----------------------------------------------------
export async function uploadFileToFirebaseStorage(
  fileOrBlob: File | Blob, 
  folder = 'products',
  vendorUid?: string,
  fileName?: string
): Promise<string> {
  const uid = vendorUid || auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Authentification requise : vous devez être connecté pour téléverser une image.');
  }

  try {
    const rawName = fileName || (fileOrBlob instanceof File ? fileOrBlob.name : 'image.jpg');
    const cleanFileName = rawName.replace(/[^a-zA-Z0-9.-]/g, '_');
    // UID-scoped path: users/{uid}/{folder}/{timestamp}_{cleanFileName}
    const path = `users/${uid}/${folder}/${Date.now()}_${cleanFileName}`;
    const storageRef = ref(storage, path);
    
    const snapshot = await uploadBytes(storageRef, fileOrBlob, {
      contentType: fileOrBlob.type || 'image/jpeg',
      customMetadata: {
        vendorId: uid,
        uploadedAt: new Date().toISOString(),
      }
    });
    
    const downloadUrl = await getDownloadURL(snapshot.ref);
    return downloadUrl;
  } catch (err: any) {
    console.error('Firebase Storage upload error:', err);
    const code = err?.code || '';
    if (code === 'storage/unauthorized') {
      throw new Error('Autorisation refusée par Firebase Storage : vérifiez vos règles de sécurité Storage.');
    }
    if (code === 'storage/bucket-not-found') {
      throw new Error('Bucket Firebase Storage introuvable : vérifiez la configuration du projet Firebase.');
    }
    throw new Error(`Échec du téléversement vers Firebase Storage (${err?.message || 'erreur inconnue'}).`);
  }
}

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  deleteDoc,
  limit
};
export type { FirebaseUser };
