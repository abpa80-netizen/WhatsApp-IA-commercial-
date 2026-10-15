#!/bin/bash
set -e

# Script de synchronisation vers le dépôt GitHub distant : abpa80-netizen/WhatsApp-IA-commercial-
# Permet de pousser le commit contenant la correction Gemini (api/ai/*, vercel.json, geminiService.ts)
# afin que Vercel déclenche le déploiement automatique en production.

REPO_URL="https://github.com/abpa80-netizen/WhatsApp-IA-commercial-.git"
TARGET_BRANCH="${TARGET_BRANCH:-main}"

if [ -n "$1" ]; then
  AUTH_REPO_URL="https://$1@github.com/abpa80-netizen/WhatsApp-IA-commercial-.git"
  echo ">>> Authentification GitHub détectée via token."
  cd /tmp/github-repo
  git push "$AUTH_REPO_URL" fix/gemini-vercel-routes:"$TARGET_BRANCH"
  echo ">>> Succès ! La branche $TARGET_BRANCH a été mise à jour sur GitHub."
  echo ">>> Vercel va automatiquement déployer le nouveau commit."
else
  echo "=========================================================================="
  echo "Instructions pour publier les fichiers sur GitHub & Vercel :"
  echo "=========================================================================="
  echo "Option A (Depuis votre machine ou terminal avec git connecté à votre compte) :"
  echo "  1. Récupérez le patch créé :"
  echo "     git apply 0001-Fix-Gemini-404-on-Vercel.patch"
  echo "  2. Committez et poussez vers main :"
  echo "     git add ."
  echo "     git commit -m 'Fix Gemini 404 on Vercel: add serverless handlers in api/ai and vercel.json rewrites'"
  echo "     git push origin main"
  echo ""
  echo "Option B (En exécutant ce script avec votre GitHub Personal Access Token) :"
  echo "  ./scripts/push-to-github.sh <VOTRE_GITHUB_TOKEN>"
  echo "=========================================================================="
fi
