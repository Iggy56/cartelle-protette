import { expect, test } from 'claude-code/testing'

import type { Ambiente, Cartella } from './regole'
import { assoluto, elenco, esamina, nominataDa, spegneLaGuardia, testiDi } from './regole'

// Una persona inventata: la casa, due cartelle protette, e la sessione aperta nei suoi progetti.
const CASA = '/Users/anna'
const cartella = (scritta: string): Cartella => {
  const p = assoluto(scritta, CASA, CASA)
  return { scritta, percorsi: [p], testi: testiDi([p], CASA) }
}
const CONTRATTI = cartella('~/Contratti')
const APP = cartella('~/Progetti/sito/app')

const ambiente = (extra: Partial<Ambiente> = {}): Ambiente => ({
  cwd: `${CASA}/Progetti`,
  casa: CASA,
  cartelle: [CONTRATTI, APP],
  ...extra,
})

const come = async (comando: string, extra?: Partial<Ambiente>) => {
  const tocco = await esamina(comando, ambiente(extra))
  if (tocco === undefined) return 'passa'
  return tocco.come === 'impostazioni' ? 'impostazioni' : `${tocco.come} ${tocco.cartella.scritta}`
}

test('i comandi che scrivono in una cartella protetta si fermano', async () => {
  const scrivono: [string, string][] = [
    ['git -C ~/Contratti status', '~/Contratti'],
    ['cd ~/Contratti && git status', '~/Contratti'],
    ['cd sito && git -C app status', '~/Progetti/sito/app'],
    ['cd sito/app', '~/Progetti/sito/app'],
    ['echo x > ~/Contratti/a.txt', '~/Contratti'],
    ['echo x >> sito/app/a.txt', '~/Progetti/sito/app'],
    ['echo x 2>/dev/null >sito/app/a.txt', '~/Progetti/sito/app'],
    ['cat ~/Contratti/a.txt | tee ~/Contratti/b.txt', '~/Contratti'],
    ["find ~/Contratti -name '*.tmp' -delete", '~/Contratti'],
    ['find ~/Contratti -name x -exec rm {} \\;', '~/Contratti'],
    ['rm -rf "$HOME/Contratti/vecchi"', '~/Contratti'],
    ['rm -rf "$HOME"/Contratti', '~/Contratti'],
    ['ls $(echo ~/Contratti)', '~/Contratti'],
    ['npm --prefix ~/Contratti install', '~/Contratti'],
    ['npm install --prefix=~/Contratti', '~/Contratti'],
    ['touch sito/app/x', '~/Progetti/sito/app'],
    ['touch ~/contratti/x', '~/Contratti'],
    ['touch /Users/anna/Progetti/../Contratti/x', '~/Contratti'],
    ["python3 -c \"open('/Users/anna/Contratti/x','w')\"", '~/Contratti'],
    ['mv ~/Contratti ~/Archivio', '~/Contratti'],
    ['cp nota.md ~/Contratti/', '~/Contratti'],
    ['ls \\\n  ~/Contratti; rm ~/Contratti/a', '~/Contratti'],
    ["cat > ~/Contratti/a.md <<'EOF'\nciao\nEOF", '~/Contratti'],
    ['chmod -R a+w ~/Contratti', '~/Contratti'],
  ]
  for (const [comando, cartella] of scrivono) expect([comando, await come(comando)]).toEqual([comando, `scrive ${cartella}`])
})

test('si ferma anche chi cancella o sposta la cartella che la contiene', async () => {
  for (const comando of ['rm -rf ~/Progetti/sito', 'rm -rf *', 'find . -name x -delete', 'git clean -fdx', 'chmod -R a+w .', 'mv sito ~/Archivio']) {
    expect([comando, await come(comando)]).toEqual([comando, 'contiene ~/Progetti/sito/app'])
  }
})

test('la lettura e il resto passano', async () => {
  const passano = [
    'ls -la ~/Contratti',
    "find ~/Contratti -maxdepth 1 -name '*.pdf' 2>/dev/null | head -5",
    'du -sh ~/Contratti 2>&1',
    'cat ~/Contratti/a.txt | wc -l',
    'grep -rn rinnovo ~/Contratti',
    'cat ~/Contratti/a.txt > ~/Desktop/copia.txt',
    'git status',
    'git add sito/marketing/post.md',
    'echo ciao > sito/note.md',
    'ls ~/ContrattiVecchi && touch ~/ContrattiVecchi/x',
    'mv nota.md ~/Progetti/',
    'rm nota.md',
    'git add .claude/settings.json',
    'cat ~/.claude/settings.json',
    'rm -rf ~/Progetti/vecchio',
    'ls ~/.claude/plugins',
    'cat ~/.claude/plugins/installed_plugins.json',
    'claude plugin install altra@catalogo',
  ]
  for (const comando of passano) expect([comando, await come(comando)]).toEqual([comando, 'passa'])
})

test('con la shell dentro la cartella si ferma anche un comando che non la nomina', async () => {
  const cwd = `${CASA}/Contratti`
  expect(await come('git status', { cwd })).toBe('scrive ~/Contratti')
  expect(await come('touch x', { cwd })).toBe('scrive ~/Contratti')
  expect(await come('ls -la', { cwd })).toBe('passa')
})

test('un collegamento che porta dentro la cartella conta come la cartella', async () => {
  const reale = async (p: string) => p.replace(`${CASA}/scorciatoia`, `${CASA}/Contratti`)
  expect(await come('touch ~/scorciatoia/x', { reale })).toBe('scrive ~/Contratti')
  expect(await come('ls ~/scorciatoia', { reale })).toBe('passa')
})

test('un programma che nomina la cartella si ferma prima di partire', async () => {
  const programmi: Record<string, string> = {
    [`${CASA}/Progetti/pulizia.py`]: "import os\nos.remove('/Users/anna/Contratti/a.txt')",
    [`${CASA}/Progetti/pulizia.sh`]: 'rm -rf ~/Contratti/vecchi',
    [`${CASA}/Progetti/conti.py`]: "print('ciao')",
  }
  const leggi = async (p: string) => programmi[p]
  expect(await come('python3 pulizia.py', { leggi })).toBe('programma ~/Contratti')
  expect(await come('./pulizia.sh', { leggi })).toBe('programma ~/Contratti')
  expect(await come('bash -e pulizia.sh', { leggi })).toBe('programma ~/Contratti')
  expect(await come('python3 conti.py', { leggi })).toBe('passa')
})

test('un pezzo che comincia con un percorso non è un programma, se non lo sembra', async () => {
  // Una nota che nomina la cartella, scritta in testa a un elenco o a una riga di testo: non si lancia.
  const leggi = async (p: string) => (p === `${CASA}/Progetti/sito/nota.md` ? 'vedi ~/Contratti' : undefined)
  expect(await come('F=(sito/nota.md altro.md); echo fatto', { leggi })).toBe('passa')
  expect(await come("cat <<'FINE'\nsito/nota.md è la nota\nFINE", { leggi })).toBe('passa')
})

test('le impostazioni di Claude Code non si scrivono dal terminale', async () => {
  expect(await come("echo '{}' > ~/.claude/settings.json")).toBe('impostazioni')
  expect(await come('sed -i "" s/true/false/ .claude/settings.local.json')).toBe('impostazioni')
  expect(await come("echo '{}' > ~/.claude/settings.json", { cartelle: [] })).toBe('impostazioni')
  expect(await come(`python3 -c "open('${CASA}/Progetti/.claude/settings.local.json','w')"`)).toBe('impostazioni')
  const leggi = async (p: string) => (p === `${CASA}/Progetti/spegni.py` ? "open('.claude/settings.local.json', 'w')" : undefined)
  expect(await come('python3 spegni.py', { leggi })).toBe('impostazioni')
})

test('i file della guardia installata non si toccano dal terminale', async () => {
  const mod = '~/.claude/plugins/cache/cartelle-protette/cartelle-protette/0.1.3'
  const fermati = [
    `rm -rf ${mod}`,
    'rm -rf ~/.claude/plugins/cache/cartelle-protette',
    `sed -i '' 's/deny/nulla/' ${mod}/hooks/register.ts`,
    "echo '{}' > ~/.claude/plugins/installed_plugins.json",
    'rm -rf ~/.claude/plugins/cache',
    'git -C ~/.claude/plugins/marketplaces/cartelle-protette checkout HEAD~1',
    'cd ~/.claude && rm -rf plugins',
    'rm -rf ~/.claude',
  ]
  for (const comando of fermati) expect([comando, await come(comando, { cartelle: [] })]).toEqual([comando, 'impostazioni'])
})

test('i comandi che spengono la guardia si riconoscono', () => {
  expect(spegneLaGuardia('claude plugin uninstall cartelle-protette@cartelle-protette')).toBe(true)
  expect(spegneLaGuardia('claude plugin disable cartelle-protette')).toBe(true)
  expect(spegneLaGuardia('claude plugin marketplace remove cartelle-protette')).toBe(true)
  expect(spegneLaGuardia('claude plugin configure cartelle-protette@cartelle-protette --values-stdin')).toBe(true)
  expect(spegneLaGuardia('claude plugin list')).toBe(false)
  expect(spegneLaGuardia('claude plugin validate ~/mods/cartelle-protette')).toBe(false)
  // Senza --values-stdin configure mostra soltanto le impostazioni.
  expect(spegneLaGuardia('claude plugin configure cartelle-protette@cartelle-protette')).toBe(false)
  expect(spegneLaGuardia('claude plugin configure cartelle-protette@cartelle-protette --json')).toBe(false)
})

test('un connettore che nomina la cartella si riconosce, a qualsiasi profondità', () => {
  const amb = ambiente()
  expect(nominataDa({ path: '/Users/anna/Contratti/a.txt', content: 'x' }, amb)?.scritta).toBe('~/Contratti')
  expect(nominataDa({ edits: [{ file: '~/Progetti/sito/app/x.ts' }] }, amb)?.scritta).toBe('~/Progetti/sito/app')
  expect(nominataDa({ path: '/tmp/x', content: 'parlo dei contratti' }, amb)).toBeUndefined()
})

test("l'elenco accetta una voce per riga, anche con a capo o ;", () => {
  expect(elenco(['~/A', ' ~/B/ ', ''])).toEqual(['~/A', '~/B'])
  expect(elenco('~/A\n~/B; ~/C')).toEqual(['~/A', '~/B', '~/C'])
  expect(elenco(undefined)).toEqual([])
})
