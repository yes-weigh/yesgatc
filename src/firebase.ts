import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4",
  authDomain: "yesgatc.firebaseapp.com",
  projectId: "yesgatc",
  storageBucket: "yesgatc.firebasestorage.app",
  messagingSenderId: "56759346990",
  appId: "1:56759346990:web:db16c479912c3d213cbcbf",
  measurementId: "G-F1V2FD7M24"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/** Primary bucket (Firebase SDK default for this project). */
export const storage = getStorage(app);

/** Legacy default bucket — older uploads/URLs may still reference this. */
export const legacyStorage = getStorage(app, 'gs://yesgatc.appspot.com');

// Secondary app for admin creating new users without losing their own session
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);
