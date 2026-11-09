#!/bin/sh
# Calls the Distr API with the personal access token that `npx @distr-sh/wizard login` saved, so the token
# never appears in a command line an agent shows. Usage: sh distr-api.sh <path> [curl options]
set -eu

case "${XDG_CONFIG_HOME:-}" in
/*) config_home=$XDG_CONFIG_HOME ;;
*) config_home=$HOME/.config ;;
esac
token_file=$config_home/distr/token

if [ ! -s "$token_file" ]; then
  echo "No Distr access token in $token_file. Ask the user to run npx @distr-sh/wizard login in their own terminal." >&2
  exit 3
fi

path=$1
shift
exec curl -sS --fail-with-body \
  -H "Authorization: AccessToken $(cat "$token_file")" \
  -H 'User-Agent: distr-skill/0.1.0' \
  "${DISTR_API_BASE:-https://app.distr.sh/api/v1}$path" "$@"
