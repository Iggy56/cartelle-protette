import { expect, test } from 'claude-code/testing'

// La mod intera, con il motore finto sotto: nessun comando gira e nessun file si tocca.
// L'hook su tool.call sta al posto del motore e conta solo cosa la guardia lascia passare.
const CASA = '/Users/anna'
const PROGETTI = `${CASA}/Progetti`
const OPZIONI = { cartelle: ['~/Contratti', '~/Progetti/sito/app'], lavorare_dentro: true }

type Sessione = { root?: string; cwd?: string; file?: Record<string, string> }

const prepara = (on: any, { root = PROGETTI, cwd = PROGETTI, file = {} }: Sessione = {}) => {
  const passati: string[] = []
  const righe: string[] = []
  on('env.get', () => ({ value: CASA }))
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('fs.stat', (_: unknown, e: any) =>
    e.path in file ? { value: { kind: 'file', size: file[e.path]!.length, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' },
  )
  on('fs.read', (_: unknown, e: any) => (e.path in file ? { value: file[e.path] } : { deny: 'ENOENT' }))
  on('ui.log', (_: unknown, e: any) => {
    righe.push(e.text)
    return { value: undefined }
  })
  on('tool.call', (_: unknown, e: any) => {
    passati.push(e.command ?? e.file_path ?? e.notebook_path ?? String(e.tool))
    return { result: {} }
  })
  return { passati, righe }
}

test('il terminale: la scrittura si ferma, la lettura passa', { options: OPZIONI }, async ($, on) => {
  const { passati, righe } = prepara(on)
  await $.tool.call({ tool: 'Bash', command: 'git -C ~/Contratti status' })
  await $.tool.call({ tool: 'Bash', command: 'cd sito && touch app/x' })
  await $.tool.call({ tool: 'Bash', command: 'ls -la ~/Contratti' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(passati).toEqual(['ls -la ~/Contratti', 'git status'])
  expect(righe).toEqual([
    'ho fermato un comando che avrebbe scritto in ~/Contratti.',
    'ho fermato un comando che avrebbe scritto in ~/Progetti/sito/app.',
  ])
})

test('un Monitor che scrive si ferma, uno che guarda passa', { options: OPZIONI }, async ($, on) => {
  const { passati } = prepara(on)
  const monitor = (command: string) => $.tool.call({ tool: 'Monitor', command, description: 'prova', timeout_ms: 1000 })
  await monitor('cd ~/Contratti && npm run dev')
  await monitor('tail -f ~/Contratti/registro.txt')
  expect(passati).toEqual(['tail -f ~/Contratti/registro.txt'])
})

test('i file delle cartelle protette non si modificano, gli altri sì', { options: OPZIONI }, async ($, on) => {
  const { passati } = prepara(on)
  await $.tool.call({ tool: 'Write', file_path: `${CASA}/Contratti/nuovo.md`, content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: `${PROGETTI}/sito/app/a.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${CASA}/Contratti/a.ipynb`, new_source: 'x' })
  await $.tool.call({ tool: 'Write', file_path: `${PROGETTI}/sito/marketing/post.md`, content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: `${CASA}/ContrattiVecchi/a.md`, old_string: 'a', new_string: 'b' })
  expect(passati).toEqual([`${PROGETTI}/sito/marketing/post.md`, `${CASA}/ContrattiVecchi/a.md`])
})

test('le impostazioni della guardia le cambia solo la persona', { options: OPZIONI }, async ($, on) => {
  const impostazioni = `${CASA}/.claude/settings.json`
  const { passati } = prepara(on, { file: { [impostazioni]: '{ "enabledPlugins": { "cartelle-protette@cartelle-protette": true } }' } })
  const modifica = (old_string: string, new_string: string) =>
    $.tool.call({ tool: 'Edit', file_path: impostazioni, old_string, new_string })
  await modifica('"cartelle-protette@cartelle-protette": true', '"cartelle-protette@cartelle-protette": false')
  await $.tool.call({ tool: 'Write', file_path: impostazioni, content: '{}' })
  await $.tool.call({ tool: 'Bash', command: 'claude plugin uninstall cartelle-protette@cartelle-protette' })
  await $.tool.call({ tool: 'Write', file_path: `${CASA}/.claude/plugins/cache/cartelle-protette/hooks/register.ts`, content: '' })
  await modifica('"theme": "dark"', '"theme": "light"')
  expect(passati).toEqual([impostazioni])
})

test('un connettore che nomina una cartella protetta si ferma', { options: OPZIONI }, async ($, on) => {
  const { passati } = prepara(on)
  await $.tool.call({ tool: 'mcp__file__write_file', path: `${CASA}/Contratti/a.txt`, content: 'x' } as any)
  await $.tool.call({ tool: 'mcp__file__write_file', path: `${CASA}/Altro/a.txt`, content: 'x' } as any)
  expect(passati).toEqual(['mcp__file__write_file'])
})

test('aperta la sessione dentro la cartella, lì la guardia si fa da parte', { options: OPZIONI }, async ($, on) => {
  const dentro = `${CASA}/Contratti`
  const { passati } = prepara(on, { root: dentro, cwd: dentro })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'touch ~/Progetti/sito/app/x' })
  expect(passati).toEqual(['git status'])
})

test('se la persona ha detto no, la guardia resta anche lì dentro', { options: { ...OPZIONI, lavorare_dentro: false } }, async ($, on) => {
  const dentro = `${CASA}/Contratti`
  const { passati } = prepara(on, { root: dentro, cwd: dentro })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(passati).toEqual([])
})

test("all'apertura una riga dice su quali cartelle è attiva", { options: OPZIONI }, async ($, on) => {
  const { righe } = prepara(on, { root: `${CASA}/Contratti/2026` })
  await $.session.start({ cwd: PROGETTI, surface: 'desktop', isInteractive: true })
  expect(righe).toEqual([
    'attiva su 1 cartella: ~/Progetti/sito/app. Qui la guardia si fa da parte per ~/Contratti, perché hai aperto la sessione lì dentro.',
  ])
})

test("senza cartelle l'apertura dice dove aggiungerle, e niente si ferma", async ($, on) => {
  const { righe, passati } = prepara(on)
  await $.session.start({ cwd: PROGETTI, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git -C ~/Contratti status' })
  expect(righe).toEqual(['nessuna cartella da proteggere: aggiungile dal menu delle mod (/plugin), alla voce cartelle-protette.'])
  expect(passati).toEqual(['git -C ~/Contratti status'])
})
