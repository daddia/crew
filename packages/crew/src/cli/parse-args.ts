export type CrewShape = 'server' | 'cli';

export interface ParsedCliArgs {
  command: 'init' | 'help';
  crewName?: string;
  shape?: CrewShape;
}

const CREW_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help' };
  }

  if (argv[0] !== 'init') {
    throw new Error(`Unknown command: ${argv[0]}. Run \`crew --help\` for usage.`);
  }

  const crewName = argv[1];
  if (!crewName) {
    throw new Error('Missing crew name. Usage: crew init <name> --shape server|cli');
  }

  if (!CREW_NAME_PATTERN.test(crewName)) {
    throw new Error(
      `Invalid crew name "${crewName}". Use lowercase letters, digits, and hyphens (e.g. my-crew).`,
    );
  }

  let shape: CrewShape | undefined;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--shape') {
      const value = argv[i + 1];
      if (value !== 'server' && value !== 'cli') {
        throw new Error('--shape must be "server" or "cli"');
      }
      shape = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!shape) {
    throw new Error('Missing --shape. Usage: crew init <name> --shape server|cli');
  }

  return { command: 'init', crewName, shape };
}
