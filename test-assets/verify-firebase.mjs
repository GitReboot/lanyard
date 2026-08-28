import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, serverTimestamp } from "firebase/firestore";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});

try {
  const cred = await signInAnonymously(getAuth(app));
  console.log("PASS  anonymous auth      uid=" + cred.user.uid.slice(0, 12) + "...");

  const db = getFirestore(app);
  const ref = collection(db, "users", cred.user.uid, "contacts");
  const doc = await addDoc(ref, { name: "__verify__", createdAt: serverTimestamp() });
  console.log("PASS  firestore write     doc=" + doc.id);

  const snap = await getDocs(ref);
  console.log("PASS  firestore read      docs=" + snap.size);

  await deleteDoc(doc);
  console.log("PASS  cleanup             test doc removed");
  process.exit(0);
} catch (e) {
  console.log("FAIL  " + (e.code || "") + " " + e.message);
  if (String(e.code).includes("admin-restricted-operation") || String(e.code).includes("operation-not-allowed"))
    console.log("      -> Anonymous sign-in is not enabled. Firebase console > Authentication > Sign-in method > Anonymous > Enable");
  if (String(e.code).includes("permission-denied"))
    console.log("      -> Firestore rules are blocking writes. Create the DB in *test mode*, or relax rules.");
  if (String(e.code).includes("unavailable") || String(e.message).includes("NOT_FOUND"))
    console.log("      -> Firestore database may not exist yet. Firebase console > Firestore Database > Create database");
  process.exit(1);
}
