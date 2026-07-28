# SmarTech Repair — Gestion d'atelier de réparation smartphone

Application web complète (PWA) de gestion d'un atelier de réparation GSM, bâtie sur
**React 19 + TypeScript + Vite + Firebase (Auth + Firestore)**. Multi-tenant : chaque
compte administrateur dispose de son propre magasin isolé (`ownerId`), avec ses
utilisateurs, son stock, ses clients et ses réparations.

## Modules

- **Tableau de bord** — indicateurs temps réel : réparations en cours, prêtes à récupérer, en attente de pièces, impayées, plus les indicateurs commerciaux (CA, bénéfice, dépenses, stock).
- **Réparations (atelier)** — ordres de réparation numérotés (`REP-AAAA-0001`), fiche appareil (marque, modèle, IMEI, code de déverrouillage, accessoires, état), panne + diagnostic, technicien assigné, pièces utilisées **déduites automatiquement du stock**, devis / main d'œuvre / total / acompte / reste dû, changement de statut rapide, **historique de suivi horodaté**, garantie calculée à la livraison.
- **Vente (POS)** — comptoir de vente pièces & accessoires : scan code-barres, panier, remise, vente à crédit, ticket imprimable.
- **Pièces & Produits** — stock avec référence, modèles compatibles, prix d'achat/vente, seuil d'alerte, approvisionnement.
- **Clients** — fiches clients avec dettes et coordonnées.
- **Historique ventes / Factures** — consultation, impression, export Excel.
- **Utilisateurs** — rôles admin/utilisateur, permissions par menu, code PIN 4 chiffres par utilisateur.
- **Paramètres** — infos boutique, devise, TVA, garantie par défaut, code de sécurité.
- **Mode hors-ligne** — blocage des actions hors connexion + file de synchronisation.

## Statuts de réparation

`Reçu` → `Diagnostic` → `Attente pièce` → `En cours` → `Terminé` → `Livré`
(+ `Irréparable`, `Annulé`)

## Prérequis

- Node.js 18+
- Un projet Firebase (Authentication e-mail/mot de passe + Firestore)

## Installation

1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Configurer Firebase dans `firebase-applet-config.json` (projectId, apiKey,
   authDomain, `firestoreDatabaseId`, storageBucket…).
3. Déployer les règles de sécurité Firestore (`firestore.rules`) :
   ```bash
   firebase deploy --only firestore:rules
   ```
   > ⚠️ La base utilise une **base Firestore nommée** (`firestoreDatabaseId`), pas la
   > base par défaut. Vérifier que les règles sont déployées sur la bonne base.
4. Lancer en développement :
   ```bash
   npm run dev
   ```
5. Build de production :
   ```bash
   npm run build
   ```

## Collections Firestore

`users`, `products`, `clients`, `sales`, `invoices`, `repairs`, `categories`,
`counters` (séquences `invoices_<ownerId>` et `repairs_<ownerId>`), `settings`,
`notes`, `supplies`, `audit_logs`.

## Déploiement

Compatible Vercel (SPA rewrite dans `vercel.json`) ou tout hébergeur statique.
Penser à incrémenter `CACHE_NAME` dans `public/sw.js` à chaque déploiement.

## Rappels techniques

- Tester en navigation privée pour éviter le cache du service worker.
- L'accès à la rubrique **Statistique** (vue globale multi-magasins) est réservé au
  super-admin défini par `SUPER_ADMIN_EMAIL` dans `src/App.tsx`.
