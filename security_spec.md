# Spécifications de Sécurité & Tests de Pénétration (Red Team Audit)

Ce document décrit les règles et invariants de sécurité garantissant l'étanchéité absolue de l'architecture multi-utilisateurs (multi-tenant) de l'application SmarTech Solution.

---

## 1. Invariants de Données (Data Invariants)

Pour empêcher tout accès croisé ou toute fuite de données entre comptes (tenants) distincts, les invariants de sécurité suivants doivent être appliqués au niveau serveur par Firestore :

1. **Isolation par Tenant (`ownerId`)** : Aucun utilisateur ne peut lire ou écrire un enregistrement (Produit, Client, Vente, Facture, Catégorie, Note, Approvisionnement) appartenant à un autre espace de travail (déterminé par la valeur `ownerId` dans son profil utilisateur).
2. **Identité Authentifiée Inviolable** : Tout document utilisateur `/users/{userId}` doit correspondre strictement à `request.auth.uid`. Un utilisateur ne peut pas s'auto-promouvoir `role: "admin"` de l'application globale, ni s'auto-débannir (`status: "active"`), ni falsifier l'identifiant de son tenant (`ownerId`).
3. **Accès Paramètres Fermé** : Les paramètres `/settings/{settingId}` ne sont lisibles et modifiables que par le tenant propriétaire dont la clé de document correspond exactement à l'identifiant du tenant `ownerId`.
4. **Co-Appartenance de Compte** : Les administrateurs d'un espace de travail ne peuvent lister ou modifier que les comptes utilisateurs `/users/{userId}` appartenant à leur propre tenant (`ownerId`).

---

## 2. Les Charges Utiles Malveillantes (The "Dirty Dozen" Payloads)

Voici les 12 scénarios d'attaque conçus pour tenter de violer l'identité, l'intégrité et l'isolation des tenants, qui doivent être systématiquement bloqués avec un statut `PERMISSION_DENIED` par les règles Firestore :

### Charge 1 : Création de Produit d'un autre Espace
Un utilisateur `user_tenant_A` tente d'ajouter un produit dans l'espace de `tenant_B`.
```json
// Collection: /products
// Authentification: UID = "user_tenant_A"
{
  "name": "Coca Cola",
  "category": "produit",
  "buyPrice": 1.200,
  "sellPrice": 2.500,
  "stock": 100,
  "ownerId": "tenant_B" // TENTATIVE D'INJECTION
}
```

### Charge 2 : Lecture Arbitraire de Produits d'autrui
Un utilisateur `user_tenant_A` tente d'accéder au produit `prod_tenant_B_123` appartenant au tenant B.
```
// Chemin: /products/prod_tenant_B_123
// Authentification: UID = "user_tenant_A" (dont le profil est rattaché à tenant_A)
// Résultat Attendu: PERMISSION_DENIED
```

### Charge 3 : Auto-Promotion au rôle "admin" de l'application
Un utilisateur standard du tenant A tente de modifier son propre profil utilisateur pour devenir `role: "admin"`.
```json
// Chemin: /users/user_tenant_A
// Authentification: UID = "user_tenant_A"
{
  "uid": "user_tenant_A",
  "email": "collaborateur@tenant-a.com",
  "role": "admin", // TENTATIVE D'AUTO-PROMOTION
  "status": "active",
  "ownerId": "tenant_A"
}
```

### Charge 4 : Auto-Débannissement d'un Compte Banni
Un utilisateur banni tente de réactiver son compte utilisateur en modifiant son statut.
```json
// Chemin: /users/user_banni
// Authentification: UID = "user_banni"
{
  "uid": "user_banni",
  "email": "banned@company.com",
  "role": "user",
  "status": "active", // TENTATIVE D'AUTO-DÉBANNISSEMENT
  "ownerId": "tenant_A"
}
```

### Charge 5 : Modification des Paramètres d'un autre Magasin
Un utilisateur du tenant A tente d'altérer les coordonnées ou les règles de TVA du magasin du tenant B.
```json
// Chemin: /settings/tenant_B
// Authentification: UID = "user_tenant_A"
{
  "storeName": "Boutique Piratée",
  "currency": "USD",
  "tva": 0
}
```

### Charge 6 : Lecture des Comptes d'un autre Tenant
Un administrateur du tenant A tente de récupérer la liste complète des profils utilisateurs du tenant B.
```
// Requête: query(collection(db, 'users'), where('ownerId', '==', 'tenant_B'))
// Authentification: UID = "admin_tenant_A"
// Résultat Attendu: PERMISSION_DENIED
```

### Charge 7 : Vol d'un Client (Détournement d'Identité)
Un utilisateur tente de lire la liste des clients du tenant B pour récupérer leurs coordonnées de contact privées et leurs dettes.
```
// Requête: query(collection(db, 'clients'), where('ownerId', '==', 'tenant_B'))
// Authentification: UID = "user_tenant_A"
// Résultat Attendu: PERMISSION_DENIED
```

### Charge 8 : Injection de Vente Falsifiée
Tenter d'injecter une vente enregistrée sous le compte du tenant B.
```json
// Collection: /sales
// Authentification: UID = "user_tenant_A"
{
  "date": "2026-06-24T01:50:00Z",
  "total": 500.000,
  "paid": 500.000,
  "ownerId": "tenant_B" // FAUX TENANT
}
```

### Charge 9 : Altération Arbitraire d'une Facture
Un attaquant tente de modifier directement une facture validée du tenant B pour effacer son historique de dette.
```json
// Chemin: /invoices/fac_tenant_B_999
// Authentification: UID = "user_tenant_A"
{
  "total": 0.000, // TENTATIVE D'ANNULATION
  "paid": 500.000,
  "debt": 0.000
}
```

### Charge 10 : Écriture sur Compteur Invalide
Un utilisateur tente d'incrémenter ou de modifier les compteurs de facturation du tenant B.
```json
// Chemin: /counters/invoices_tenant_B
// Authentification: UID = "user_tenant_A"
{
  "current": 9999
}
```

### Charge 11 : Espionnage des Mémos Privés
Un utilisateur du tenant A tente de lire les mémos ou notes stratégiques de la direction du tenant B.
```
// Chemin: /notes/note_tenant_B_001
// Authentification: UID = "user_tenant_A"
// Résultat Attendu: PERMISSION_DENIED
```

### Charge 12 : Création de Profil Utilisateur usurpé
Tenter de s'enregistrer avec un UID différent de celui authentifié par Firebase Auth.
```json
// Chemin: /users/user_usurpe
// Authentification: UID = "attaquant_real_123"
{
  "uid": "user_usurpe", // USURPATION UID
  "email": "victim@company.com",
  "role": "admin",
  "status": "active",
  "ownerId": "tenant_B"
}
```

---

## 3. Spécification des Tests (Test Runner Setup)

Pour s'assurer que notre configuration de sécurité est infaillible, nous allons configurer et déployer les règles Firestore (`firestore.rules`) et s'assurer que le linter valide sa syntaxe. La validation et la compilation du projet confirment la conformité des configurations.
