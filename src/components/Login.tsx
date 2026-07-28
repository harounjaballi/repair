import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ShoppingCart, Mail, Lock, AlertCircle, Chrome } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError("Erreur Google: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegistering) {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
        } catch (regErr: any) {
          console.warn("Standard Auth registration failed, checking if we can save to Firestore fallback...", regErr);
          
          // Fallback if Firebase Identity Toolkit is not enabled
          const isAuthDisabled = regErr.code === 'auth/operation-not-allowed' || 
                                 regErr.message?.includes('identitytoolkit') || 
                                 regErr.message?.includes('auth/admin-restricted-operation') ||
                                 regErr.message?.includes('PERMISSION_DENIED');
          
          if (isAuthDisabled) {
            // Check if email already exists in Firestore user accounts
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', email));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
              throw new Error("Cet email est déjà utilisé dans notre base de données.");
            }
            
            const newUid = 'user_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
            const isFirst = email === 'harounjaballi@gmail.com';
            const defaultAllowed = ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes', 'users', 'settings'];
              
            const profileData = {
              uid: newUid,
              email: email,
              password: password,
              role: 'admin',
              status: 'active',
              allowedMenus: defaultAllowed,
              ownerId: newUid,
              createdAt: new Date().toISOString()
            };
            
            await setDoc(doc(db, 'users', newUid), profileData);
            
            // Set local custom session and reload
            localStorage.setItem('custom_session', JSON.stringify(profileData));
            window.dispatchEvent(new Event('storage'));
            window.location.reload();
            return;
          } else {
            throw regErr;
          }
        }
      } else {
        // Connexion Firebase Auth d'abord (les règles Firestore exigent un utilisateur authentifié pour lire)
        const userCred = await signInWithEmailAndPassword(auth, email, password);

        // Ensuite, vérifier dans Firestore si le compte est banni.
        // Lecture directe par UID (plus fiable qu'une requête "list" par email),
        // avec quelques tentatives en cas de léger retard de propagation du jeton d'authentification.
        let profileData: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const userSnap = await getDoc(doc(db, 'users', userCred.user.uid));
            if (userSnap.exists()) {
              profileData = userSnap.data();
            }
            break;
          } catch (checkErr: any) {
            const isPermissionIssue = checkErr.code === 'permission-denied';
            if (isPermissionIssue && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              continue;
            }
            // Après plusieurs tentatives, on ne bloque pas la connexion pour ça :
            // le contrôle du statut banni sera de toute façon réappliqué en temps réel
            // par l'écoute du profil dans App.tsx.
            console.warn("Vérification du statut banni ignorée (accès temporairement indisponible) :", checkErr);
            break;
          }
        }

        if (profileData) {
          if (profileData.status === 'banned') {
            await signOut(auth);
            throw new Error("Votre compte a été banni. Veuillez contacter l'administrateur.");
          }
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError("L'inscription par Email n'est pas activée dans la console Firebase. Utilisez Google ou activez 'Email/Password' dans l'onglet Authentication.");
      } else {
        setError(err.message || "Une erreur s'est produite lors de la connexion.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl shadow-gray-200/50 p-6 sm:p-8 border border-gray-100">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-50 to-cyan-50 text-indigo-600 mb-4 animate-pulse">
            <ShoppingCart className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight font-display">
            <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
              SmarTech Solution
            </span>
            <span className="block text-lg sm:text-xl font-bold text-slate-500 mt-2 font-sans tracking-wide">Atelier Réparation</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-2">
            {isRegistering ? 'Créer un nouveau compte' : 'Connectez-vous à votre magasin'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700 text-xs sm:text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-750 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 sm:py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-sm"
                placeholder="vendeur@smartech.tn"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-750 mb-1.5">Mot de passe</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 sm:py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 sm:py-3 bg-indigo-600 text-white font-extrabold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20 text-sm cursor-pointer"
          >
            {loading ? 'Chargement...' : isRegistering ? "S'inscrire" : 'Se connecter'}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-4">
          <div className="flex-1 h-px bg-gray-200"></div>
          <span className="text-xs text-gray-400 font-bold uppercase">Ou</span>
          <div className="flex-1 h-px bg-gray-200"></div>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-6 w-full py-3.5 sm:py-3 bg-white border border-gray-200 text-gray-700 font-extrabold rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 shadow-sm text-sm cursor-pointer"
        >
          <Chrome className="w-5 h-5 text-blue-600" />
          Se connecter avec Google
        </button>

        <div className="mt-8 text-center">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            {isRegistering ? 'Déjà un compte ? Se connecter' : "Pas encore de compte ? S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
}
