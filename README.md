# Cartrust CRM — démarrage local

Ce dépôt contient l’API Express/MySQL. L’interface React/Vite est disponible dans [CRM_TRUST_FRONT](https://github.com/BryanParisot/CRM_TRUST_FRONT). Cloner les deux dépôts côte à côte. Node.js et Docker Desktop sont nécessaires.

## Premier lancement

1. Démarrer Docker Desktop, puis dans `CRM_BACK_END` : `docker compose up -d --wait`.
2. Installer les dépendances : `PUPPETEER_SKIP_DOWNLOAD=true npm install`.
3. Copier `.env.example` vers `.env` et remplacer `JWT_SECRET` par une valeur aléatoire.
4. Créer les tables et le compte : `ADMIN_PASSWORD='choisir-un-mot-de-passe-local' npm run db:init`.
5. Lancer l’API : `npm start`.
6. Dans un autre terminal, dans `CRM_TRUST_FRONT` : `npm ci`, puis `npm run dev -- --host 127.0.0.1`.

Ouvrir http://localhost:5173. Compte local : `admin@cartrust.local`, avec le mot de passe choisi à l’étape 4.

## Lancements suivants

Dans `CRM_BACK_END` : `docker compose up -d --wait`. Lancer ensuite `npm start` dans le backend et `npm run dev -- --host 127.0.0.1` dans le frontend.

La base est conservée dans le volume Docker `crm_crm_mysql` (projet Compose `crm`, volume `crm_mysql`). Ce nom conserve le volume utilisé par le Compose initial placé dans le dossier parent. `docker compose stop` l’arrête sans effacer les données. Le script `db:init` conserve les tables et comptes existants.

À l’étape 3, l’acompte vaut 450 € par défaut. « Modifier l’acompte » permet de sauvegarder un montant propre au dossier (jusqu’à deux décimales), également affiché dans le portail client. Pour une base existante, `npm run db:init` dans le backend ajoute le champ sans supprimer les données. Les véhicules du portail sont présentés par leur nom et le lien de l’annonce.

## État de la reprise

L’espace minimal `/client-link/:token/documents` permet de télécharger les CGV signées et la facture. Il est accessible depuis le portail client. À l’étape 3, Youtrust peut générer automatiquement la demande depuis le modèle configuré et rapatrier le PDF signé. Le mode manuel reste disponible si l’intégration est désactivée. La facture PDF est importée par l’administrateur. La facture est bloquée côté serveur jusqu’à confirmation de réception du paiement ; retirer la confirmation bloque à nouveau le téléchargement. Les PDF sont stockés dans MySQL et limités à 10 Mo chacun.

Le modèle commun ne constitue pas une copie signée. La génération des factures et leur envoi par email ne sont pas encore branchés. Vérification des règles d’accès et de paiement : avec l’API démarrée, lancer `npm run test:documents` dans le backend (les données temporaires sont nettoyées).

Le schéma a été reconstitué à partir des requêtes du code, sans anciennes données. Les identifiants de la configuration Docker sont réservés au développement local. La recherche de véhicules est manuelle : valider les informations de l’étape 1, puis ajouter une URL et un nom facultatif uniquement à l’étape 2, puis copier le lien personnalisé pour le partager au client. Le client retient ou refuse chaque annonce ; ses choix sont enregistrés immédiatement, sans limite de trois véhicules. Les propositions et réponses se rafraîchissent toutes les cinq secondes. Le scraping est déconnecté de l’API et du parcours. Les paiements et les documents restent à examiner avant toute mise en production.

## Navigation de l’espace client

Les pages client partagent une navigation fixe avec « Mon dossier », « Étape en cours » et « Mes documents ». La page `/client-link/:token/overview` présente les coordonnées, les critères de recherche et les six étapes du dossier, avec sa position actuelle. Les informations sont en lecture seule et se rafraîchissent toutes les cinq secondes. Depuis les documents, « Étape en cours » permet de reprendre directement le parcours. À l’étape 6, ce lien ouvre la page de livraison, sans revenir en boucle aux téléchargements.

Le lien personnalisé d’entrée continue d’ouvrir l’étape actuelle ; à l’étape 1, il ouvre la vue du dossier ; à l’étape 6, il ouvre la livraison. Vérification des données accessibles avec chaque lien : `npm run test:portal` dans le backend (API démarrée ; dossiers de test nettoyés).

## Parcours client en trois étapes

Pour vérifier la configuration Youtrust sans créer d’invitation, lancer `npm run youtrust:check` dans `CRM_BACK_END`. Configurer `API_YOUTRUST_KEY`, `YOUTRUST_ENVIRONMENT=sandbox` et `YOUTRUST_TEMPLATE_ID` dans `.env`. La commande vérifie l’accès au modèle et son activation, sans afficher la clé. Le modèle doit être dans le même environnement que la clé et accessible à son espace de travail. Activer ensuite `YOUTRUST_ENABLED=true` pour utiliser l’intégration.

À l’étape CRM 3, le lien client ouvre successivement : signature des CGV, justificatifs (CNI recto/verso, permis et domicile), puis acompte. Les étapes suivantes sont verrouillées jusqu’à confirmation de la signature (automatique via Youtrust, ou administrative en mode manuel) et dépôt des quatre fichiers. Les justificatifs sont privés et téléchargeables uniquement par l’administrateur propriétaire. La déclaration de virement ne confirme pas le paiement et ne libère pas la facture.

À l’étape CRM 4, le même lien client ouvre le suivi des contrôles. Seuls les véhicules retenus sont affichés, avec leur nom, leur lien et les points de contrôle enregistrés par l’administrateur. Les statuts se rafraîchissent toutes les cinq secondes. Une checklist vide reste « À préparer » ; les nouvelles checklists standard commencent avec tous les points en attente. Le client consulte les contrôles sans les modifier et garde accès à ses CGV et sa facture. Une page de paiement déjà ouverte passe automatiquement aux contrôles lorsque le dossier avance à l’étape 4.

À l’étape CRM 5, « Solde & documents » permet de renseigner le prix total de la prestation Cartrust. Le prix du véhicule n’entre pas dans ce récapitulatif. Le montant de l’acompte effectivement confirmé à l’étape 3 est conservé dans `deposit_paid_amount`, puis déduit côté serveur pour calculer le solde, en centimes. Un acompte non confirmé ne se déduit pas ; sa révocation recalcule le solde. Les montants ne peuvent plus être modifiés après confirmation du paiement final sans retirer cette confirmation.

Le lien client ouvre `/client-link/:token/settlement` à l’étape 5, y compris depuis une checklist déjà ouverte. Le client retrouve le prix, l’acompte et le solde, puis peut déclarer son virement. Cette déclaration ne confirme aucun encaissement : la réception du solde est confirmée manuellement par l’administrateur. Les trois documents PDF (contrat de vente, certificat d’immatriculation et rapport CEBIA) peuvent être ajoutés dans l’onglet et téléchargés par le client à partir de l’étape 5, également dans « Mes documents ». Aucune facture n’est générée automatiquement.

Pour une base existante, lancer `npm run db:init` dans le backend, puis redémarrer l’API. Le script ajoute `client_settlements` et conserve le montant des acomptes déjà confirmés à partir du montant enregistré dans le dossier. Vérification du calcul, des droits, des confirmations et des documents : `npm run test:settlement` (API démarrée ; dossiers temporaires nettoyés).

À l’étape CRM 6, « Livraison » permet de saisir manuellement la date et l’adresse de remise du véhicule. L’adresse proposée est « Avricourt » ; elle reste modifiable pour chaque dossier. La date et l’adresse sont enregistrées dans `client_deliveries`, sans récapitulatif du véhicule ni données d’exemple. Le statut « Planifiée » indique qu’un rendez-vous a été renseigné, sans déclarer le véhicule livré.

Le lien client ouvre `/client-link/:token/delivery` à cette étape. Les informations se rafraîchissent toutes les cinq secondes, restent accessibles depuis « Étape en cours » et ne sont pas publiées avant l’étape 6. Les dates sont conservées au format calendrier, sans conversion de fuseau horaire. Pour une base existante, lancer `npm run db:init` puis redémarrer l’API. Vérifications : `npm run test:delivery` (API démarrée ; dossiers temporaires nettoyés).

## Test de signature Youtrust

Configurer `YOUTRUST_ENABLED=true`, `YOUTRUST_ENVIRONMENT=sandbox`, `API_YOUTRUST_KEY`, `YOUTRUST_TEMPLATE_ID` et `YOUTRUST_SIGNER_LABEL=client`. Le modèle doit être actif en sandbox, avec un seul document signable et un seul signataire modifiable dont le libellé correspond exactement à `YOUTRUST_SIGNER_LABEL`.

Le passage du dossier à l’étape 3 prépare automatiquement l’invitation à partir du nom complet, de l’email et du téléphone du client. Un dossier déjà à l’étape 3 dispose du bouton « Créer le lien de signature ». Les champs `first_name` et `last_name` du dossier sont transmis directement, sans découper un nom complet. Ils sont obligatoires pour une création. Les anciens noms restent affichés, mais leurs deux champs doivent être complétés dans « Modifier Client » avant une signature. Les numéros français `06…` et `07…` sont normalisés en `+33…`. Pour le test, utiliser ses propres coordonnées complètes.

Le lien est affiché dans le portail client, avec `delivery_mode=none` : le CRM ne demande pas d’envoi d’invitation par email. Le code d’authentification reste géré par Youtrust lors de la signature. En local, le backend vérifie les invitations en attente au plus une fois par minute. Lorsque Youtrust indique `done`, il récupère le PDF, le conserve sans modification et confirme la signature dans une même transaction. L’étape des justificatifs se débloque ensuite. La confirmation du paiement reste manuelle.

Le suivi persistant évite de recréer l’invitation après une erreur d’activation ou un double clic. Une création dont la réponse est incertaine nécessite une vérification dans Youtrust avant de relancer. Les signatures manuelles existantes sont conservées.

Pour une notification immédiate, exposer le backend en HTTPS, créer dans Youtrust un webhook vers `/api/webhooks/youtrust` et configurer son secret dans `YOUTRUST_WEBHOOK_SECRET`. S’abonner aux événements `signature_request.done`, `signature_request.declined`, `signature_request.expired` et `signature_request.canceled`. Le serveur vérifie le HMAC du corps brut, la date et l’environnement, puis relit l’état auprès de l’API avant d’importer le PDF. La vérification périodique permet de tester sans tunnel en local.

Tests : `npm run test:youtrust` simule l’API et nettoie ses dossiers de test ; `npm run test:documents` nécessite le backend démarré. Aucun de ces tests ne crée d’invitation réelle. La signature réelle sandbox doit être effectuée par le testeur sur Youtrust.

Documentation : https://developers.youtrust.com/docs/use-templates-to-create-signature-requests ; https://developers.youtrust.com/docs/manage-signature-link-delivery ; https://developers.youtrust.com/docs/use-webhooks-in-your-app .
