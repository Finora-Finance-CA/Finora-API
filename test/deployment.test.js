// Checks render.yaml and package.json say what the README's Deployment section says
// (US-34), so a later edit can't quietly start running migrations or the seed on
// deploy, or change the Node version on one side only.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const renderYaml = read('render.yaml');
const packageJson = JSON.parse(read('package.json'));

// The value of a top-level `key: value` line in the service, comments removed.
function setting(key) {
  const match = new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm').exec(renderYaml);
  return match?.[1].replace(/\s+#.*$/, '').trim();
}

// Each `- key: NAME` entry under envVars, with the lines that follow it.
function envVar(name) {
  const match = new RegExp(`- key: ${name}\\n((?:\\s+(?!- )\\S.*\\n?)*)`).exec(renderYaml.replace(/\r\n/g, '\n'));
  return match?.[1];
}

describe('render.yaml', () => {
  it('builds with production dependencies and starts with npm start', () => {
    expect(setting('buildCommand')).toBe('npm ci --omit=dev');
    expect(setting('startCommand')).toBe('npm start');
    expect(packageJson.scripts.start).toBe('node src/server.js');
  });

  it('never runs migrations or the seed', () => {
    const commands = renderYaml.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(commands.join('\n')).not.toMatch(/migrate|seed|preDeployCommand/i);
  });

  it('uses /health as the health check', () => {
    expect(setting('healthCheckPath')).toBe('/health');
  });

  it('runs in production, so the seed script refuses to run there', () => {
    expect(envVar('NODE_ENV')).toMatch(/value: production/);
  });

  it.each(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'CLIENT_ORIGIN'])(
    'asks for %s in the dashboard instead of storing a value',
    (name) => {
      const entry = envVar(name);
      expect(entry).toMatch(/sync: false/);
      expect(entry).not.toMatch(/value:/);
    }
  );

  it('leaves PORT for Render to set', () => {
    expect(envVar('PORT')).toBeUndefined();
  });
});

describe('Node version', () => {
  it('is 22 in .nvmrc and package.json engines', () => {
    expect(read('.nvmrc').trim()).toBe('22');
    expect(packageJson.engines.node).toBe('22.x');
  });
});
