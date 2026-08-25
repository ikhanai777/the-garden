export const NAME_PREFIXES = [
  'crawler',
  'indexer',
  'patcher',
  'sweeper',
  'archiver',
  'linter',
  'compactor',
  'migrator',
  'watcher',
  'synth',
  'router',
  'auditor',
  'grafter',
  'reaper',
]

export const TOOL_NAMES = [
  'read_file',
  'write_file',
  'grep',
  'list_dir',
  'run_tests',
  'exec_shell',
  'http_fetch',
  'search_index',
  'apply_patch',
  'query_db',
  'embed_chunk',
  'diff_files',
  'spawn_subtask',
  'check_types',
]

export const FILE_PATHS = [
  'src/auth/session.ts',
  'src/auth/token.ts',
  'src/db/migrations/0042_add_index.sql',
  'src/api/routes/agents.ts',
  'src/lib/queue/worker.ts',
  'src/lib/queue/consumer.ts',
  'src/ui/components/Tide.tsx',
  'src/ui/components/FleetRail.tsx',
  'config/prod.env.yaml',
  'infra/terraform/vpc.tf',
  'scripts/backfill_embeddings.py',
  'docs/runbooks/incident-042.md',
  '/etc/hosts',
  '/etc/nginx/nginx.conf',
  'package.json',
  'tsconfig.json',
]

export const REASONING_SUMMARIES = [
  'Weighing whether to retry the fetch or fall back to cache.',
  'Comparing schema diff against last known-good migration.',
  'Deciding scope for the write: single file or directory.',
  'Checking rate limits before issuing the next batch call.',
  'Evaluating whether the failing test is flaky or a regression.',
  'Planning subtask decomposition for the crawl frontier.',
  'Reconciling conflicting edits from two prior tool calls.',
]

export const APPROVAL_ACTIONS = [
  {
    action: 'Write to a file outside the current project root.',
    artifact: 'write_file(/etc/hosts)',
    scope: 'Grants filesystem write access to /etc for this session.',
  },
  {
    action: 'Run a shell command that modifies production configuration.',
    artifact: "exec_shell('kubectl apply -f infra/prod/deploy.yaml')",
    scope: 'Grants cluster-admin exec access for this session.',
  },
  {
    action: 'Push a commit directly to the default branch.',
    artifact: 'git push origin main',
    scope: 'Grants write access to the main branch, bypassing review.',
  },
  {
    action: 'Send an outbound request to an endpoint not on the allowlist.',
    artifact: "http_fetch('https://billing.internal/api/refund')",
    scope: 'Grants network egress to billing.internal for this session.',
  },
  {
    action: 'Delete a table partition as part of the migration.',
    artifact: 'DROP PARTITION events_2024_q1',
    scope: 'Grants destructive write access to the events table.',
  },
]

export const ERROR_MESSAGES = [
  'Write denied — no access to this path. Grant scope or edit the path.',
  'Request timed out after 30s. The upstream host may be unreachable.',
  'Test suite failed: 3 of 214 assertions did not pass.',
  'Type check failed: incompatible types at line 88.',
  'Rate limited by upstream API. Retry after backoff.',
]

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
