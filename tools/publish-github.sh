#!/usr/bin/env bash
#
# AD-Finance → GitHub
#
# Mempublikasikan folder proyek ini ke repositori GitHub dalam satu perintah:
# membuat repo git bila belum ada, membuatkan repositori GitHub (opsional),
# commit, lalu push. Aman dijalankan berulang kali.
#
# Contoh:
#   bash tools/publish-github.sh https://github.com/username/ad-finance.git
#   GH_TOKEN=ghp_xxx bash tools/publish-github.sh --create ad-finance --public
#   GH_TOKEN=ghp_xxx bash tools/publish-github.sh --create ad-finance -m "feat: UI v2"
#   bash tools/publish-github.sh --dry-run https://github.com/username/ad-finance.git
#
set -euo pipefail

REPO_URL=""
BRANCH="main"
MESSAGE=""
CREATE_NAME=""
VISIBILITY="private"
REMOTE_NAME="origin"
DRY_RUN=0
DESCRIPTION="AD-Finance — PWA keuangan pribadi offline-first (transaksi, rekening koran, laporan, analitik)."

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    -m|--message) MESSAGE="${2:-}"; shift 2 ;;
    --create) CREATE_NAME="${2:-}"; shift 2 ;;
    --public) VISIBILITY="public"; shift ;;
    --private) VISIBILITY="private"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "Opsi tidak dikenal: $1" >&2; usage; exit 1 ;;
    *) if [ -z "$REPO_URL" ]; then REPO_URL="$1"; else echo "Argumen berlebih: $1" >&2; exit 1; fi; shift ;;
  esac
done

# --- selalu bekerja dari akar proyek ---------------------------------------
cd "$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(basename "$PWD")"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" = "1" ]; then printf '  \033[2m→ %s\033[0m\n' "$*"; else "$@"; fi
}

command -v git >/dev/null || die "git belum terpasang."

if [ -d .github/workflows ] && [ -n "${GH_TOKEN:-}" ]; then
  warn 'repo ini berisi .github/workflows/* — token Anda WAJIB punya scope "workflow".'
  warn 'Kalau tidak, GitHub menolak push dengan pesan "refusing to allow a Personal'
  warn 'Access Token to create or update workflow".'
  warn 'Token classic: centang "repo" + "workflow".'
fi


# --- 1. buatkan repositori GitHub bila diminta ----------------------------
if [ -n "$CREATE_NAME" ]; then
  say "1/5  Membuat repositori GitHub “$CREATE_NAME”"
  if [ "$DRY_RUN" = "1" ]; then
    ok "(dry-run) POST /user/repos {name: $CREATE_NAME, private: $([ "$VISIBILITY" = private ] && echo true || echo false)}"
  else
    [ -n "${GH_TOKEN:-}" ] || die "Buat repo butuh GH_TOKEN. Buat token di https://github.com/settings/tokens (scope: repo) lalu jalankan: GH_TOKEN=... bash tools/publish-github.sh --create $CREATE_NAME"
    LOGIN="$(curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
      https://api.github.com/user | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).login))')"
    [ -n "$LOGIN" ] || die "Tidak bisa membaca akun GitHub dari token tersebut."
    PAYLOAD="$(node -e 'const [n,v,d]=process.argv.slice(1);console.log(JSON.stringify({name:n,description:d,private:v==="private",has_issues:true,has_wiki:false,auto_init:false}))' "$CREATE_NAME" "$VISIBILITY" "$DESCRIPTION")"
    RESPONSE="$(curl -sS -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
      -X POST https://api.github.com/user/repos -d "$PAYLOAD")"
    if printf '%s' "$RESPONSE" | grep -q '"full_name"'; then
      ok "repositori dibuat: $(printf '%s' "$RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).full_name))')"
    elif printf '%s' "$RESPONSE" | grep -qi 'already exists'; then
      warn "repositori sudah ada — melanjutkan dengan repo yang ada."
    else
      printf '%s\n' "$RESPONSE" >&2
      die "Gagal membuat repositori (lihat pesan di atas)."
    fi
    REPO_URL="${REPO_URL:-https://github.com/$LOGIN/$CREATE_NAME.git}"
  fi
fi

# --- 2. pastikan repo git ada (self-healing kalau .git tidak lengkap) ------
say "2/5  Menyiapkan repositori lokal"
if [ ! -d .git ] || [ ! -f .git/config ]; then
  run git init -q -b "$BRANCH"
  [ "$DRY_RUN" = "1" ] && warn "(dry-run) git init -b $BRANCH" || ok "repo git dibuat (branch $BRANCH)"
else
  ok "repo git sudah ada"
fi
git rev-parse --verify HEAD >/dev/null 2>&1 || true

# identitas commit — dipakai hanya bila belum diatur
git config user.name  >/dev/null 2>&1 || run git config user.name  "${GIT_AUTHOR_NAME:-AD-Finance Dev}"
git config user.email >/dev/null 2>&1 || run git config user.email "${GIT_AUTHOR_EMAIL:-ad-finance@users.noreply.github.com}"
[ "$DRY_RUN" = "1" ] || ok "identitas commit: $(git config user.name || echo '-') <$(git config user.email || echo '-')>"

# --- 3. commit ------------------------------------------------------------
say "3/5  Menyimpan perubahan"
if [ -n "$REPO_URL" ] && [ "$DRY_RUN" = "0" ]; then
  node -e '
    const fs = require("fs");
    const url = process.argv[1].replace(/\.git$/, "");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    if (pkg.repository?.url !== url) {
      pkg.repository = { type: "git", url };
      fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
      console.log("patched");
    }
  ' "$REPO_URL" | grep -q patched && ok "package.json: field repository → $REPO_URL" || true
fi
run git add -A
if git diff --cached --quiet 2>/dev/null; then
  ok "tidak ada perubahan baru untuk di-commit"
else
  if [ -z "$MESSAGE" ]; then
    MESSAGE="chore: sinkronisasi AD-Finance ($(date +%Y-%m-%d\ %H:%M))"
  fi
  run git commit -q -m "$MESSAGE"
  ok "commit dibuat: “$MESSAGE”"
fi
[ "$DRY_RUN" = "1" ] || git --no-pager log --oneline -3 | sed 's/^/     /'

# --- 4. remote + push -----------------------------------------------------
say "4/5  Menghubungkan ke GitHub"
if [ -n "$REPO_URL" ]; then
  if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
    run git remote set-url "$REMOTE_NAME" "$REPO_URL"
    ok "remote $REMOTE_NAME diperbarui → $REPO_URL"
  else
    run git remote add "$REMOTE_NAME" "$REPO_URL"
    ok "remote $REMOTE_NAME ditambahkan → $REPO_URL"
  fi
elif ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  die "Belum ada remote dan tidak ada URL repo. Contoh: bash tools/publish-github.sh https://github.com/username/ad-finance.git"
fi

PUSH_URL="$(git remote get-url "$REMOTE_NAME" 2>/dev/null || echo "$REPO_URL")"
if [ -n "${GH_TOKEN:-}" ] && [[ "$PUSH_URL" == https://* ]]; then
  # push memakai token tanpa menyimpannya di .git/config
  TOKEN_URL="https://x-access-token:${GH_TOKEN}@${PUSH_URL#https://}"
  run git push --quiet "$TOKEN_URL" "HEAD:refs/heads/$BRANCH"
  [ "$DRY_RUN" = "1" ] || { git branch --set-upstream-to="$REMOTE_NAME/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true; }
  ok "push dengan GH_TOKEN selesai (token tidak disimpan)"
else
  run git push --quiet -u "$REMOTE_NAME" "$BRANCH"
  ok "push ke $REMOTE_NAME/$BRANCH"
fi

# --- 5. langkah berikutnya ------------------------------------------------
say "5/5  Selesai"
if [ "$DRY_RUN" = "1" ]; then
  warn "Mode dry-run: tidak ada perubahan yang benar-benar dijalankan."
fi
cat <<NEXT

Lanjutkan ke Vercel (gratis, tanpa build step):

  A. Lewat dashboard — https://vercel.com/new
     • Import Git Repository → pilih repo AD-Finance
     • Framework Preset: Other · Build Command: (kosong) · Output Directory: (kosong/root)
     • Deploy

  B. Lewat terminal — satu perintah:

     bash tools/deploy-vercel.sh --prod

Setelah live: jalankan Lighthouse/PWA install dari HP, lalu naikkan VERSION di sw.js
setiap kali merilis perubahan agar pengguna lama menerima pembaruan.

NEXT
