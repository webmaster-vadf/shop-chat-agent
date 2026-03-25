# Guide des logs pour l'intention "activation_compte"

Ce document explique tous les logs qui seront affichés lors du traitement de l'intention `activation_compte`.

## Flux complet des logs

### 1. Activation du mode VADF (chat.jsx:217-237)

```
════════════════════════════════════════════════════════
🎯 [CHAT] VADF MODE ACTIVATED
📝 [CHAT] User message: Activer votre compte professionnel
════════════════════════════════════════════════════════
✅ [CHAT] VADF Manager loaded
🔍 [CHAT] Intent detection result: activation_compte
✅ [CHAT] VADF-specific intent detected: activation_compte
════════════════════════════════════════════════════════
```

**Signification :**
- Le mode VADF est activé car `promptType === 'vadfAssistant'`
- Le gestionnaire VADF est chargé avec succès
- L'intention détectée est `activation_compte`

---

### 2. Détection d'intention (vadf-response-manager.js:32-121)

```
════════════════════════════════════════════════════════
🔍 [VADF INTENT] Starting intent detection
📝 [VADF INTENT] Original message: Activer votre compte professionnel
📝 [VADF INTENT] Lowercase message: activer votre compte professionnel
════════════════════════════════════════════════════════
🔎 [VADF INTENT] Step 1: Checking product keywords
⚪ [VADF INTENT] No product keywords found
🔎 [VADF INTENT] Step 2: Checking specific VADF intents
✅ [VADF INTENT] Specific intent matched!
   - Intent: "activation_compte"
   - Keyword: "activer"
════════════════════════════════════════════════════════
```

**Signification :**
- Le message est converti en minuscules pour la recherche
- **Step 1 :** Vérifie si le message contient des mots-clés produit → Non
- **Step 2 :** Vérifie les intentions VADF spécifiques → Match trouvé !
- Le keyword `"activer"` correspond à l'intention `activation_compte`

---

### 3. Vérification du compte (chat.jsx:242-271)

#### Cas A : Message sans email (ex: "Activer votre compte professionnel")

```
👤 [CHAT] Account-related intent detected: activation_compte
📝 [CHAT] User message: Activer votre compte professionnel
📧 [CHAT] Email extraction attempt - Match found: false
📧 [CHAT] Extracted email: none
⚠️ [CHAT] No email found in message, skipping account check
⚠️ [CHAT] Will use default VADF response without account override
⚪ [CHAT] Account status is neither active nor inactive: null
```

**Signification :**
- L'intention nécessite une vérification de compte
- Aucun email trouvé dans le message (regex ne match pas)
- **La vérification de compte est SKIPPÉE**
- Pas de statut de compte (null)

#### Cas B : Message avec email (ex: "Je veux activer jean.dupont@example.com")

```
👤 [CHAT] Account-related intent detected: activation_compte
📝 [CHAT] User message: Je veux activer jean.dupont@example.com
📧 [CHAT] Email extraction attempt - Match found: true
📧 [CHAT] Extracted email: jean.dupont@example.com
✅ [CHAT] Email found, calling checkVadfCustomerAccount with: { email: 'jean.dupont@example.com' }
✅ [CHAT] Account check completed
✅ [CHAT] Account check result: {
  "status": "not_found",
  "message": "Compte introuvable. Redirection vers la page d'inscription.",
  "redirectToSignup": true
}
⚪ [CHAT] Account status is neither active nor inactive: not_found
```

**Signification :**
- Email trouvé dans le message
- Vérification de compte effectuée via API Shopify
- Résultat : compte introuvable
- Un message spécifique sera retourné

---

### 4. Enrichissement du contexte (chat.jsx:275-287)

#### Cas A : Sans vérification de compte

```
📝 [CHAT] Using base context (no account check result to enrich)
```

#### Cas B : Avec vérification de compte

```
🔄 [CHAT] Enriching context with account check result
📝 [CHAT] Enriched context: {
  "isFirstMessage": false,
  "email": "jean.dupont@example.com",
  "statut_pro": "not_found"
}
```

---

### 5. Génération de la réponse VADF (chat.jsx:289-312)

```
🎯 [CHAT] Calling vadfManager.getResponse with: {
  "intent": "activation_compte",
  "context": {}
}
📤 [CHAT] Generated VADF response:
   - Type: activation_compte
   - Text preview: Merci d'écrire à support@vadf.fr en indiquant le nom de votre entreprise...
   - Full text length: 183
```

**Signification :**
- Le gestionnaire VADF sélectionne la meilleure réponse selon le contexte
- Réponse par défaut (première sans conditions) est sélectionnée

---

### 6. Vérification de l'override (chat.jsx:301-312)

#### Cas A : Pas d'override (message sans email)

```
🔍 [CHAT] Checking if account message should override VADF response
   - accountCheckResult exists: false
   - accountCheckResult.message exists: false
✅ [CHAT] NO OVERRIDE: Using VADF response as-is
```

**Signification :**
- Pas de résultat de vérification de compte
- **La réponse VADF est utilisée telle quelle**

#### Cas B : Override (message avec email)

```
🔍 [CHAT] Checking if account message should override VADF response
   - accountCheckResult exists: true
   - accountCheckResult.message exists: true
⚠️ [CHAT] OVERRIDE: Using account check message instead of VADF response
   - Original VADF text: Merci d'écrire à support@vadf.fr...
   - Override text: Compte introuvable. Redirection vers la page d'inscription.
```

**Signification :**
- Un résultat de vérification de compte existe avec un message
- **Le message du compte remplace la réponse VADF**

---

### 7. Envoi de la réponse finale (chat.jsx:320-333)

```
════════════════════════════════════════════════════════
📡 [CHAT] SENDING FINAL RESPONSE TO CLIENT
   - Event type: vadf_response
   - Intent: activation_compte
   - Response type: activation_compte
   - Response text: Merci d'écrire à support@vadf.fr en indiquant le nom de votre entreprise...
════════════════════════════════════════════════════════
```

**Signification :**
- Envoi de l'événement SSE `vadf_response` au frontend
- Le client reçoit la réponse finale

---

## Scénarios de test

### Scénario 1 : "Activer votre compte professionnel" (sans email)

**Logs attendus :**
1. ✅ VADF mode activé
2. ✅ Intention détectée : `activation_compte`
3. ⚠️ Aucun email trouvé
4. ⚠️ Vérification de compte skippée
5. ✅ Réponse VADF par défaut sélectionnée
6. ✅ Pas d'override
7. 📡 Envoi : "Merci d'écrire à support@vadf.fr..."

**Réponse attendue :**
```
Merci d'écrire à support@vadf.fr en indiquant le nom de votre entreprise,
ainsi que l'adresse e-mail ou le numéro de téléphone associé à votre compte.
Cela nous permettra de vérifier si votre compte est bien enregistré en tant
que client professionnel sur notre site.
```

---

### Scénario 2 : "Je veux activer mon compte avec jean.dupont@example.com"

**Logs attendus :**
1. ✅ VADF mode activé
2. ✅ Intention détectée : `activation_compte`
3. ✅ Email trouvé : `jean.dupont@example.com`
4. ✅ Vérification de compte effectuée
5. ✅ Résultat : `not_found`
6. ✅ Réponse VADF générée
7. ⚠️ Override avec message du compte
8. 📡 Envoi : "Compte introuvable. Redirection vers la page d'inscription."

**Réponse attendue :**
```
Compte introuvable. Redirection vers la page d'inscription.
```

---

## Comment utiliser ces logs pour déboguer

### 1. Vérifier que l'intention est bien détectée

Cherchez :
```
✅ [VADF INTENT] Specific intent matched!
   - Intent: "activation_compte"
```

Si vous voyez `⚠️ [VADF INTENT] No intent detected anywhere`, vérifiez que le message contient un des keywords de `activation_compte`.

---

### 2. Vérifier l'extraction d'email

Cherchez :
```
📧 [CHAT] Email extraction attempt - Match found: true/false
📧 [CHAT] Extracted email: xxx@xxx.com / none
```

Si l'email n'est pas extrait alors qu'il est présent, vérifiez le regex : `/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/`

---

### 3. Vérifier si la vérification de compte est effectuée

Cherchez :
```
✅ [CHAT] Email found, calling checkVadfCustomerAccount with: { email: '...' }
```
OU
```
⚠️ [CHAT] No email found in message, skipping account check
```

---

### 4. Vérifier la réponse sélectionnée

Cherchez :
```
📤 [CHAT] Generated VADF response:
   - Type: activation_compte
   - Text preview: ...
```

---

### 5. Vérifier si l'override est appliqué

Cherchez :
```
✅ [CHAT] NO OVERRIDE: Using VADF response as-is
```
OU
```
⚠️ [CHAT] OVERRIDE: Using account check message instead of VADF response
```

---

## Résumé des modifications apportées

1. **chat.jsx (lignes 217-237)** : Logs d'activation VADF et détection d'intention
2. **chat.jsx (lignes 242-271)** : Logs de vérification de compte avec email extraction
3. **chat.jsx (lignes 275-287)** : Logs d'enrichissement du contexte
4. **chat.jsx (lignes 289-312)** : Logs de génération de réponse et vérification d'override
5. **chat.jsx (lignes 320-333)** : Logs d'envoi de la réponse finale
6. **vadf-response-manager.js (lignes 36-121)** : Logs détaillés de détection d'intention

---

## Fichiers modifiés

- ✅ `/app/routes/chat.jsx` : Logique principale avec logs complets
- ✅ `/app/services/vadf-response-manager.js` : Détection d'intention avec logs
- ✅ `/test-activation-intent.js` : Script de test autonome
- ✅ `/LOGS-ACTIVATION-COMPTE.md` : Ce document

---

## Commandes utiles

### Tester localement
```bash
node test-activation-intent.js
```

### Visualiser les logs en temps réel
```bash
npm run dev | grep "VADF\|CHAT"
```

### Filtrer uniquement les logs d'activation
```bash
npm run dev | grep "activation_compte"
```

### Filtrer uniquement les logs d'email
```bash
npm run dev | grep "📧"
```
