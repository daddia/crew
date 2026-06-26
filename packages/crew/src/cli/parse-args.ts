export type CrewShape = 'server' | 'cli';

export type EvalReporter = 'text' | 'junit';

export interface ParsedCliArgs {
  command: 'init' | 'eval' | 'run' | 'help';
  crewName?: string;
  shape?: CrewShape;
  evalFiles?: string[];
  evalCrew?: string;
  baseUrl?: string;
  strict?: boolean;
  reporter?: EvalReporter;
  output?: string;
  fixture?: string;
  runCrew?: string;
  fixtureMode?: 'mock' | 'live';
}

const CREW_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

function parseInitArgs(argv: string[]): ParsedCliArgs {
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

function parseEvalArgs(argv: string[]): ParsedCliArgs {
  const evalFiles: string[] = [];
  let evalCrew: string | undefined;
  let baseUrl: string | undefined;
  let strict = false;
  let reporter: EvalReporter = 'text';
  let output: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === '--crew') {
      evalCrew = argv[i + 1];
      if (!evalCrew) {
        throw new Error('--crew requires a crew name');
      }
      i += 1;
      continue;
    }
    if (arg === '--base-url') {
      baseUrl = argv[i + 1];
      if (!baseUrl) {
        throw new Error('--base-url requires a URL');
      }
      i += 1;
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--reporter') {
      const value = argv[i + 1];
      if (value !== 'text' && value !== 'junit') {
        throw new Error('--reporter must be "text" or "junit"');
      }
      reporter = value;
      i += 1;
      continue;
    }
    if (arg === '--output') {
      output = argv[i + 1];
      if (!output) {
        throw new Error('--output requires a file path');
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    evalFiles.push(arg);
  }

  return {
    command: 'eval',
    evalFiles: evalFiles.length > 0 ? evalFiles : undefined,
    evalCrew,
    baseUrl,
    strict,
    reporter,
    output,
  };
}

function parseRunArgs(argv: string[]): ParsedCliArgs {
  let fixture: string | undefined;
  let runCrew: string | undefined;
  let fixtureMode: 'mock' | 'live' | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === '--fixture') {
      fixture = argv[i + 1];
      if (!fixture) {
        throw new Error('--fixture requires an issue key (e.g. CREW-123)');
      }
      i += 1;
      continue;
    }
    if (arg === '--crew') {
      runCrew = argv[i + 1];
      if (!runCrew) {
        throw new Error('--crew requires a crew name');
      }
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      const value = argv[i + 1];
      if (value !== 'mock' && value !== 'live') {
        throw new Error('--mode must be "mock" or "live"');
      }
      fixtureMode = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!fixture) {
      fixture = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!fixture) {
    throw new Error('Missing fixture issue key. Usage: crew run --fixture CREW-123');
  }

  return { command: 'run', fixture, runCrew, fixtureMode };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help' };
  }

  if (argv[0] === 'init') {
    return parseInitArgs(argv);
  }

  if (argv[0] === 'eval') {
    return parseEvalArgs(argv);
  }

  if (argv[0] === 'run') {
    return parseRunArgs(argv);
  }

  throw new Error(`Unknown command: ${argv[0]}. Run \`crew --help\` for usage.`);
}
