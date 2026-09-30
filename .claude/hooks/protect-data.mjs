// .claude/hooks/protect-data.mjs: keeps agents out of the competition datasets and secrets.
// PreToolUse on Bash and the file tools. The deny rules in settings.json cover Read and Edit; this
// also catches shell commands (cat, head, grep, cp, ...) and searches pointed at the dataset folders.

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { tool_name: tool, tool_input: args = {} } = JSON.parse(input);

const text = (
  tool === 'Bash'
    ? [args.command]
    : [args.file_path, args.path, args.pattern, args.glob]
)
  .filter(Boolean)
  .join('\n');

// data/seed and datathon/data, anywhere in a path or command.
const DATASETS = /(^|[^\w.-])(data\/seed|datathon\/data)(\/|\b)/;
// A .env file (.env, .env.local, apps/backend/.env) but not .env.example or process.env.
const ENV_FILE = /(^|[\s'"=:/<>|;&(])\.env(\.(?!example\b)[\w-]+)?(?=$|[\s'"|;&)<>/])/m;

if (DATASETS.test(text)) {
  decide(
    'deny',
    'data/seed and datathon/data hold the competition datasets, which agents must not read, search or copy. ' +
      'Use specs/data/datasets.md for columns and the test-fixtures skill for data.',
  );
} else if (ENV_FILE.test(text)) {
  decide(
    'ask',
    'This touches a .env file, which may hold secrets. Agents normally use .env.example and the config schema.',
  );
}

function decide(permissionDecision, permissionDecisionReason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
    }),
  );
  process.exit(0);
}
