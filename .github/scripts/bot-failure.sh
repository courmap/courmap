#!/usr/bin/env bash
# Opens (or comments on) a bot-failure issue when this job also failed on the previous run, so a
# broken bot never fails silently (docs/SPEC.md, "Guardrails"). Usage: bot-failure.sh <job name>
set -euo pipefail
job="$1"
workflow="${GITHUB_WORKFLOW:-bots}"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# The latest completed run of this workflow before this one, and that run's result for this job.
previous=$(gh run list --workflow "$workflow" --status completed --limit 20 --json databaseId \
  --jq "[.[] | select(.databaseId != $GITHUB_RUN_ID)] | .[].databaseId" | while read -r id; do
    conclusion=$(gh run view "$id" --json jobs --jq ".jobs[] | select(.name == \"$job\") | .conclusion")
    if [ -n "$conclusion" ] && [ "$conclusion" != "skipped" ]; then echo "$conclusion"; break; fi
  done)
if [ "$previous" != "failure" ]; then
  echo "First failure of $job (previous: ${previous:-none}); no issue yet."
  exit 0
fi

title="Bot failure: $workflow / $job"
existing=$(gh issue list --state open --label bot-failure --json number,title --jq ".[] | select(.title == \"$title\") | .number" | head -1)
body="The $job job of the $workflow workflow failed twice in a row. Latest run: $run_url"
if [ -n "$existing" ]; then
  gh issue comment "$existing" --body "$body"
else
  gh label create bot-failure --color b60205 --force >/dev/null
  gh issue create --title "$title" --label bot-failure --body "$body"
fi
