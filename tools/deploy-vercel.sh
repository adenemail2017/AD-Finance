#!/usr/bin/env bash
#
# AD-Finance → Vercel
#
# Mengunggah aplikasi ke Vercel. AD-Finance adalah PWA statis tanpa build step,
# jadi yang diunggah hanya berkas aplikasi (lihat .vercelignore).
#
# Contoh:
#   bash tools/deploy-vercel.sh                 # preview deployment
#   bash tools/deploy-vercel.sh --prod          # produksi
#   VERCEL_TOKEN=xxx bash tools/deploy-vercel.sh --prod --project ad-finance
#   bash tools/deploy-vercel.sh --prod --domain finance.contoh.com
#
set -euo pipefail

PROD=0
TOKEN="${VERCEL_TOKEN:-}"
PROJECT="${VERCEL_PROJECT:-ad-finance}"
SCOPE="${VERCEL_SCOPE:-}"
DOMAIN=""
DRY_RUN=0

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --prod) PROD=1; shift ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --scope|--team) SCOPE="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opsi tidak dikenal: $1" >&2; usage; exit 1 ;;
  esac
done

cd "$(cd "$(dirname "$0")/.." && pwd)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" = "1" ]; then printf '  \033[2m→ %s\033[0m\n' "$*"; else "$@"; fi
}

command -v node >/dev/null || die "Node.js belum terpasang."
[ -f vercel.json ] || die "vercel.json tidak ditemukan — jalankan dari dalam folder proyek."

# 1. verifikasi dulu, jangan pernah deploy tanpa lolos tes
if [ "$DRY_RUN" = "0" ]; then
  say "1/4  Menjalankan pemeriksaan lokal (check + tes)"
  if node tools/check.mjs >/dev/null 2>&1; then
    ok "integrity check lolos"
  else
    die "check gagal — perbaiki dulu (node tools/check.mjs) sebelum deploy."
  fi
  if node --test tests/ >/dev/null 2>&1; then
    ok "unit test lolos"
  else
    die "unit test gagal — deploy dibatalkan."
  fi
else
  say "1/4  (dry-run) melewati pemeriksaan"
fi

# 2. token
say "2/4  Menyiapkan kredensial"
if [ -z "$TOKEN" ]; then
  cat <<'MSG'

  Butuh token Vercel (sekali saja):
    1. buka https://vercel.com/account/tokens → Create Token (scope: Full Account)
    2. jalankan ulang dengan salah satu cara:
         VERCEL_TOKEN=xxxxxxxx bash tools/deploy-vercel.sh --prod
         bash tools/deploy-vercel.sh --prod --token=xxxxxxxx
    3. (opsional) simpan permanen:
         echo 'export VERCEL_TOKEN=xxxxxxxx' >> ~/.zshrc   # atau ~/.bashrc

MSG
  die "VERCEL_TOKEN belum diisi."
fi
ok "token tersedia (${#TOKEN} karakter)"

SCOPE_ARGS=()
[ -n "$SCOPE" ] && SCOPE_ARGS=(--scope "$SCOPE")

# 3. link proyek (nama proyek di Vercel = ad-finance)
say "3/4  Menautkan proyek “$PROJECT”"
if [ "$DRY_RUN" = "0" ]; then
  npx --yes vercel@latest link --yes --project "$PROJECT" --token="$TOKEN" "${SCOPE_ARGS[@]}" >/dev/null 2>&1 \
    && ok "proyek tertaut" \
    || { echo "  ! link otomatis gagal (mungkin proyek belum ada). Percobaan pertama akan membuatnya."; }
  [ -f .vercel/project.json ] && ok "konfigurasi tersimpan di .vercel/project.json (tidak ikut di-commit)"
else
  ok "(dry-run) vercel link --project $PROJECT"
fi

# 4. deploy
say "4/4  Deploy ke Vercel"
TARGET_ARGS=()
[ "$PROD" = "1" ] && TARGET_ARGS=(--prod)
if [ "$DRY_RUN" = "1" ]; then
  printf '  \033[2m→ npx vercel@latest deploy --yes %s --token=***\033[0m\n' "${TARGET_ARGS[*]:-}"
else
  URL="$(npx --yes vercel@latest deploy --yes "${TARGET_ARGS[@]:-}" "${SCOPE_ARGS[@]:-}" --token="$TOKEN" 2>&1 | tail -n 1)"
  printf '  \033[32m✓\033[0m %s\n' "$URL"
  if [ -n "$DOMAIN" ]; then
    npx --yes vercel@latest domains add "$DOMAIN" "$PROJECT" --token="$TOKEN" "${SCOPE_ARGS[@]:-}" || \
      echo "  ! tambahkan domain manual di dashboard: Settings → Domains"
  fi
fi

cat <<NEXT

Selesai. Yang perlu diingat setelah deploy:

  • Buka URL-nya di HP → menu browser → "Add to Home Screen" untuk memeriksa manifest,
    ikon, dan mode standalone.
  • Uji mode pesawat setelah sekali dibuka: aplikasi harus tetap hidup dari cache SW.
  • Setiap kali mengubah berkas di src/, naikkan VERSION di sw.js
    (mis. adfinance-v2.0.1) supaya pengguna lama menerima pembaruan.
  • Vercel akan otomatis deploy ulang setiap kali Anda push ke branch produksi.

NEXT
