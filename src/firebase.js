// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAxjPtvDmpz705uSZyjEZsHLZ-PJTrGC2I",
  authDomain: "tuckii-bookmark.firebaseapp.com",
  projectId: "tuckii-bookmark",
  storageBucket: "tuckii-bookmark.firebasestorage.app",
  messagingSenderId: "896731196164",
  appId: "1:896731196164:web:f60f96787d4d5c1b6f7e51"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export default app;
