// Vérification et gestion du compte client VADF
// Utilisation : await checkVadfCustomerAccount({ email }) ou { accountName }
import prisma from "../db.server";

/**
 * Vérifie le statut d'un compte client VADF
 * @param {Object} params - { email?: string, accountName?: string }
 * @returns {Promise<{status: string, message: string, canResetPassword?: boolean, redirectToSignup?: boolean}>}
 */
export async function checkVadfCustomerAccount({ email, accountName }) {
  // 1. Recherche par email ou nom de compte
  let user = null;
  if (email) {
    user = await prisma.session.findFirst({ where: { email } });
  } else if (accountName) {
    user = await prisma.session.findFirst({ where: { shop: accountName } });
  }
  if (!user) {
    return {
      status: "not_found",
      message: "Compte introuvable. Redirection vers la page d'inscription.",
      redirectToSignup: true
    };
  }
  // 2. Vérification professionnel (B2B)
  // On considère qu'un professionnel a accountOwner=true OU un champ scope contenant 'B2B' OU un email d'entreprise (améliorable)
  const isPro = user.accountOwner === true || (user.scope && user.scope.includes('B2B'));
  if (!isPro) {
    // Escalade automatique (ticket support fictif)
    // Ici, on pourrait créer une entrée en base ou envoyer un email à contact@vadf.fr
    return {
      status: "not_pro",
      message: "VADF travaille exclusivement avec les professionnels. Créez un compte entreprise pour accéder à nos services.",
      escalade: true,
      contact: "contact@vadf.fr"
    };
  }
  // 3. Vérification activation
  if (user.emailVerified === true || user.isOnline === true) {
    return {
      status: "active",
      message: "Compte actif. Vous pouvez demander une réinitialisation du mot de passe si besoin.",
      canResetPassword: true
    };
  }
  // 4. Compte enregistré mais inactif
  if (user.emailVerified === false || user.isOnline === false) {
    return {
      status: "inactive",
      message: "Votre compte est enregistré mais non activé. Veuillez contacter l’adresse web@vadf.fr afin de renvoyer manuellement l’email d’activation."
    };
  }
  // 5. Cas inscription pro déjà faite (exemple : champ accountOwner ou scope)
  if (user.accountOwner === true) {
    return {
      status: "pro_pending",
      message: "Veuillez contacter l’adresse contact@vadf.fr afin de relancer la demande relative à l’ouverture d’un compte professionnel."
    };
  }
  // Fallback
  return {
    status: "unknown",
    message: "Statut du compte inconnu. Contactez contact@vadf.fr."
  };
}
